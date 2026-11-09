import type { McpScope } from '@gbfm/core/editorial-mcp'
import { and, eq, sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Option, Result, Schema } from 'effect'

import { audioTable, type InsertAudio } from '@/db/audio.schema'
import { audioIdsForCreator, showIdsForCreator } from '@/db/creator-membership'
import { Database } from '@/db/layer'
import { showsTable } from '@/db/show.schema'
import { McpAuthorization } from '@/mcp/authorization'
import { CommandAuthority } from '@/mcp/command-authority'
import { EndpointIdentity, McpToolError } from '@/mcp/contracts'
import {
  CreatorCommandResult,
  CreatorRevision,
  ListCreatorDraftsInput,
  ListCreatorDraftsResult,
  UpdateCreatorMetadataInput,
} from '@/mcp/creator/contracts'
import { checkCreatorResponse, creatorResultFits, requireCreatorWire } from '@/mcp/creator/wire'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { McpOperationStore } from '@/mcp/operations/store'

import { CreatorDeleteCommands, CreatorDeleteCommandsLayer } from './delete-command'
import { buildCreatorUpdate } from './guarded-update'
import { CreatorPostCommands, CreatorPostCommandsLayer } from './post-command'

const unavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Creator command unavailable; retry only the identical request.',
  })

const invalid = () =>
  new McpToolError({
    code: 'invalid_input',
    message: 'Invalid creator command or encoded payload exceeds 256 KiB.',
  })

const bound = <A>(result: A) =>
  new TextEncoder().encode(JSON.stringify(result)).byteLength <= 256 * 1024
    ? Effect.succeed(result)
    : Effect.fail(invalid())

const DraftRow = Schema.Struct({
  kind: Schema.Literals(['mix', 'show']),
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  revision: CreatorRevision,
  updatedAt: Schema.Number,
  slug: Schema.String,
})

const Access = Schema.Struct({
  kind: Schema.Literals(['mix', 'show']),
  targetId: Schema.String,
  ownerId: Schema.String,
})

const make = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const store = yield* McpOperationStore
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const listCreatorDrafts = Effect.fn('CreatorCommand.listDrafts')(function* (
    raw: typeof ListCreatorDraftsInput.Type,
  ) {
    const actor = yield* authorization
      .requireScopes(['creator:read'])
      .pipe(
        Effect.mapError((error) => new McpToolError({ code: error.code, message: error.message })),
      )

    const authorityOption = yield* Effect.serviceOption(CommandAuthority)

    if (Option.isNone(authorityOption))
      return yield* new McpToolError({
        code: 'access_denied',
        message: 'Command authority required.',
      })
    const authority = authorityOption.value
    const checkpoint = yield* authority.checkpoint(['creator:read'])

    if (checkpoint.actorId !== actor.userId)
      return yield* new McpToolError({ code: 'access_denied', message: 'Command access denied.' })

    const input = yield* Schema.decodeUnknownEffect(ListCreatorDraftsInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    const limit = input.limit ?? 20
    const offset = input.offset ?? 0

    const rows = yield* Effect.tryPromise({
      try: () =>
        db.all(sql`SELECT * FROM (
        SELECT 'mix' AS kind,a.id,a.title,a.description,a.revision,a.updatedAt,a.slug FROM audio a
          WHERE a.draft=1 AND a.type='mix' AND EXISTS(SELECT 1 FROM audio_creators c WHERE c.audioId=a.id AND c.creatorId=${actor.userId})
        UNION ALL SELECT 'show' AS kind,s.id,s.title,s.description,s.revision,s.updatedAt,s.slug FROM shows s
          WHERE s.draft=1 AND EXISTS(SELECT 1 FROM show_creators c WHERE c.showId=s.id AND c.creatorId=${actor.userId})
      ) WHERE ${checkpoint.liveGuard} AND ${input.kind === undefined ? sql`1` : sql`kind=${input.kind}`}
      ORDER BY updatedAt DESC,kind ASC,id ASC LIMIT ${limit + 1} OFFSET ${offset}`),
      catch: unavailable,
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(DraftRow))),
      Effect.mapError(unavailable),
    )

    const drafts = rows.slice(0, limit).map((row) => {
      const reviewUrl = new URL(row.kind === 'mix' ? '/new/mix' : '/new/show', config.frontendUrl)
      reviewUrl.searchParams.set('edit', row.slug)

      return {
        kind: row.kind,
        targetId: row.id,
        title: row.title,
        description: row.description,
        revision: row.revision,
        updatedAt: new Date(row.updatedAt).toISOString(),
        reviewUrl: reviewUrl.href,
      }
    })

    return yield* Schema.decodeUnknownEffect(ListCreatorDraftsResult)({
      endpoint,
      drafts,
      pagination: { limit, offset, hasMore: rows.length > limit },
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(checkCreatorResponse))
  })

  const updateCreatorMetadata = Effect.fn('CreatorCommand.updateMetadata')(function* (
    raw: typeof UpdateCreatorMetadataInput.Type,
  ) {
    const wire = yield* requireCreatorWire

    const actor = yield* authorization
      .requireScopes(['creator:write'])
      .pipe(
        Effect.mapError((error) => new McpToolError({ code: error.code, message: error.message })),
      )

    const authorityOption = yield* Effect.serviceOption(CommandAuthority)

    if (Option.isNone(authorityOption))
      return yield* new McpToolError({
        code: 'access_denied',
        message: 'Command authority required.',
      })
    const authority = authorityOption.value
    const scopes: ReadonlyArray<McpScope> = ['creator:write']
    const initial = yield* authority.checkpoint(scopes)

    if (initial.actorId !== actor.userId)
      return yield* new McpToolError({ code: 'access_denied', message: 'Command access denied.' })

    const input = yield* Schema.decodeUnknownEffect(UpdateCreatorMetadataInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid), Effect.flatMap(bound))

    const now = yield* Clock.currentTimeMillis
    const run = Effect.runPromiseWith(yield* Effect.context())
    let checkpoint = initial
    const table = input.kind === 'mix' ? audioTable : showsTable

    const membership =
      input.kind === 'mix'
        ? audioIdsForCreator(db, actor.userId)
        : showIdsForCreator(db, actor.userId)

    const accessible = and(
      eq(table.id, input.targetId),
      membership,
      input.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
    )

    const result = yield* Effect.tryPromise({
      try: () =>
        store.execute({
          key: {
            actorId: initial.actorId,
            clientId: initial.clientId,
            resource: initial.resource,
            operation: 'update_creator_metadata',
            requestId: input.requestId,
          },
          normalizedInput: input,
          now,
          authorize: async (outcome) => {
            const checked = await run(Effect.result(authority.checkpoint(scopes)))

            if (Result.isFailure(checked)) {
              if (checked.failure.code === 'access_denied') return false
              throw checked.failure
            }

            checkpoint = checked.success

            if (
              checkpoint.actorId !== initial.actorId ||
              checkpoint.clientId !== initial.clientId ||
              checkpoint.resource !== initial.resource
            )
              return false

            if (!outcome) return true

            if (
              !Schema.is(Access)(outcome.access) ||
              outcome.access.kind !== input.kind ||
              outcome.access.targetId !== input.targetId ||
              outcome.access.ownerId !== actor.userId
            )
              return false

            return (
              (
                await db
                  .select({ id: table.id })
                  .from(table)
                  .where(and(accessible, eq(table.draft, true)))
                  .limit(1)
              ).length === 1
            )
          },
          prepare: async () => {
            const [row] = await db
              .select({
                id: table.id,
                revision: table.revision,
                draft: table.draft,
                updatedAt: table.updatedAt,
              })
              .from(table)
              .where(and(accessible, eq(table.draft, true)))
              .limit(1)

            if (!row) return { status: 'not_found' }

            if (row.revision !== input.expectedRevision || row.revision === Number.MAX_SAFE_INTEGER)
              return { status: 'conflict' }

            const next = {
              kind: input.kind,
              targetId: input.targetId,
              revision: row.revision + 1,
              state: 'unpublished' as const,
            }

            if (!creatorResultFits(wire, endpoint, next)) return { status: 'invalid_input' }

            return {
              status: 'ready',
              build: (ctx) => {
                const fields: Partial<InsertAudio> = {}

                if (input.title !== undefined) fields.title = input.title

                if (input.description !== undefined) fields.description = input.description

                const update = buildCreatorUpdate(
                  db,
                  input.kind === 'mix' ? 'audio' : 'show',
                  row,
                  actor.userId,
                  fields,
                  {
                    attemptId: ctx.attemptId,
                    now: new Date(Math.max(now, row.updatedAt.getTime() + 1)),
                    guard: and(
                      ctx.fence,
                      input.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
                    ),
                    liveGuard: checkpoint.liveGuard,
                  },
                )

                return {
                  statements: [
                    ctx.prepare(update.update.getSQL()),
                    ...update.writes.map(ctx.prepare),
                  ],
                  assertApplied: sql`${ctx.fence} AND ${update.authorized}`,
                  outcome: {
                    result: next,
                    revision: next.revision,
                    access: { kind: input.kind, targetId: input.targetId, ownerId: actor.userId },
                  },
                }
              },
            }
          },
        }),
      catch: unavailable,
    })

    if (result.status !== 'applied' && result.status !== 'replayed')
      return yield* new McpToolError({
        code: result.status,
        message: 'Creator metadata command did not return an applied outcome.',
      })

    return yield* Schema.decodeUnknownEffect(CreatorCommandResult)({
      endpoint,
      status: 'applied',
      replayed: result.status === 'replayed',
      target: result.outcome.result,
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(checkCreatorResponse))
  })

  return {
    listCreatorDrafts,
    updateCreatorMetadata,
    ...(yield* CreatorPostCommands),
    ...(yield* CreatorDeleteCommands),
  }
})

/** Request-scoped authority is resolved at invocation, never captured at layer construction. */
export class CreatorCommandService extends Context.Service<
  CreatorCommandService,
  Effect.Success<typeof make>
>()('gbfm/CreatorCommands') {}

/** Domain services consume the same Database and shared operation-store binding composed by P1. */
export const CreatorCommandServiceLayer = Layer.effect(CreatorCommandService, make).pipe(
  Layer.provide(CreatorPostCommandsLayer),
  Layer.provide(CreatorDeleteCommandsLayer),
)
