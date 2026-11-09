import { type McpScope, PostId } from '@gbfm/core/editorial-mcp'
import { and, eq, exists, sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Match, Option, Result, Schema } from 'effect'

import { audioTable } from '@/db/audio.schema'
import { audioIdsForCreator, showIdsForCreator } from '@/db/creator-membership'
import { buildGuardedPostUpdate } from '@/db/guarded-post-update'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { showsTable } from '@/db/show.schema'
import { McpAuthorization } from '@/mcp/authorization'
import { CommandAuthority, type CommandCheckpoint } from '@/mcp/command-authority'
import { EndpointIdentity, McpToolError } from '@/mcp/contracts'
import {
  CreateMicroPostInput,
  CreatorCommandResult,
  PublishEditorialInput,
  ReplyToMicroPostInput,
  UnpublishContentInput,
} from '@/mcp/creator/contracts'
import { checkCreatorResponse, creatorResultFits, requireCreatorWire } from '@/mcp/creator/wire'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { editorialSnapshotGuard } from '@/mcp/editorial-music/snapshot'
import {
  McpOperationStore,
  type OperationPreparation,
  type JsonValue,
} from '@/mcp/operations/store'
import { publicMicroAncestorPredicate } from '@/services/public-micro-ancestry'

import { buildCreatorUpdate } from './guarded-update'
import { prepareCreatorMicro, prepareCreatorPostTransition } from './prepare-post'

const unavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Post command unavailable; retry only the identical request.',
  })

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid or oversized creator command.' })

const Access = Schema.Struct({
  targetId: PostId,
  ownerId: Schema.String,
  kind: Schema.Literals(['post', 'micro', 'mix', 'show']),
})

const make = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const store = yield* McpOperationStore
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const execute = Effect.fn('CreatorCommand.executePost')(function* (options: {
    readonly operation:
      | 'create_micro_post'
      | 'reply_to_micro_post'
      | 'publish_editorial'
      | 'unpublish_content'
    readonly input:
      | typeof CreateMicroPostInput.Type
      | typeof ReplyToMicroPostInput.Type
      | typeof PublishEditorialInput.Type
      | typeof UnpublishContentInput.Type
    readonly scopes: ReadonlyArray<McpScope>
  }) {
    const wire = yield* requireCreatorWire

    const actor = yield* authorization
      .requireScopes(options.scopes)
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
    const initial = yield* authority.checkpoint(options.scopes)

    if (initial.actorId !== actor.userId)
      return yield* new McpToolError({ code: 'access_denied', message: 'Command access denied.' })

    if (new TextEncoder().encode(JSON.stringify(options.input)).byteLength > 262144)
      return yield* invalid()
    const now = yield* Clock.currentTimeMillis
    const run = Effect.runPromiseWith(yield* Effect.context())
    let checkpoint: CommandCheckpoint = initial

    const result = yield* Effect.tryPromise({
      try: () =>
        store.execute({
          key: {
            actorId: initial.actorId,
            clientId: initial.clientId,
            resource: initial.resource,
            operation: options.operation,
            requestId: options.input.requestId,
          },
          normalizedInput: options.input,
          now,
          authorize: async (outcome) => {
            const checked = await run(Effect.result(authority.checkpoint(options.scopes)))

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

            if (!Schema.is(Access)(outcome.access) || outcome.access.ownerId !== actor.userId)
              return false

            if (options.operation === 'publish_editorial') {
              if (!('postId' in options.input) || outcome.access.targetId !== options.input.postId)
                return false
            }

            if (options.operation === 'unpublish_content') {
              if (
                !('target' in options.input) ||
                outcome.access.targetId !== options.input.target.targetId ||
                outcome.access.kind !== options.input.target.kind
              )
                return false

              if (outcome.access.kind === 'mix' || outcome.access.kind === 'show') {
                const table = outcome.access.kind === 'mix' ? audioTable : showsTable

                const [existing] = await db
                  .select({ id: table.id })
                  .from(table)
                  .where(eq(table.id, outcome.access.targetId))
                  .limit(1)

                if (!existing) return true

                const membership =
                  outcome.access.kind === 'mix'
                    ? audioIdsForCreator(db, actor.userId)
                    : showIdsForCreator(db, actor.userId)

                return (
                  (
                    await db
                      .select({ id: table.id })
                      .from(table)
                      .where(
                        and(
                          eq(table.id, outcome.access.targetId),
                          membership,
                          outcome.access.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
                        ),
                      )
                      .limit(1)
                  ).length === 1
                )
              }
            }

            const [post] = await db
              .select({ id: postsTable.id })
              .from(postsTable)
              .where(eq(postsTable.id, outcome.access.targetId))
              .limit(1)

            // Lifecycle acknowledgement may outlive its row; creation replay still needs current target access.
            if (!post)
              return (
                options.operation !== 'create_micro_post' &&
                options.operation !== 'reply_to_micro_post'
              )

            return (
              (
                await db
                  .select({ id: postCreators.postId })
                  .from(postCreators)
                  .where(
                    and(eq(postCreators.postId, post.id), eq(postCreators.creatorId, actor.userId)),
                  )
                  .limit(1)
              ).length === 1
            )
          },
          prepare: async (): Promise<OperationPreparation> => {
            if (
              options.operation === 'create_micro_post' ||
              options.operation === 'reply_to_micro_post'
            ) {
              const input = Schema.decodeUnknownSync(
                options.operation === 'reply_to_micro_post'
                  ? ReplyToMicroPostInput
                  : CreateMicroPostInput,
                { onExcessProperty: 'error' },
              )(options.input)

              const prepared = await run(
                Effect.result(
                  prepareCreatorMicro({ input, actorId: actor.userId, now: new Date(now) }).pipe(
                    Effect.provideService(EditorialMcpConfig, config),
                    Effect.provideService(Database, db),
                  ),
                ),
              )

              if (Result.isFailure(prepared))
                return {
                  status: Match.value(prepared.failure.code).pipe(
                    Match.when('not_found', () => 'not_found' as const),
                    Match.when('invalid_input', () => 'invalid_input' as const),
                    Match.orElse(() => 'unavailable' as const),
                  ),
                }
              const { data, id, version } = prepared.success

              if (
                !creatorResultFits(wire, endpoint, {
                  kind: 'micro',
                  targetId: id,
                  version,
                  state: 'published',
                })
              )
                return { status: 'invalid_input' }

              return {
                status: 'ready',
                build: (ctx) => {
                  const ancestry =
                    data.parentPostId && data.rootPostId
                      ? publicMicroAncestorPredicate({
                          postId: data.parentPostId,
                          rootId: data.rootPostId,
                          depth: (data.depth ?? 0) - 1,
                        })
                      : sql`1`

                  const guard = and(ctx.fence, checkpoint.liveGuard, ancestry)

                  const winner = exists(
                    db
                      .select({ id: postsTable.id })
                      .from(postsTable)
                      .where(
                        and(eq(postsTable.id, id), eq(postsTable.lastOperationId, ctx.attemptId)),
                      ),
                  )

                  const authorized = and(ctx.fence, checkpoint.liveGuard, ancestry, winner)

                  const insert = sql`INSERT INTO posts(id,slug,title,content,type,draft,createdAt,updatedAt,parent_post_id,root_post_id,depth,last_operation_id,music_references_managed)
                SELECT ${id},${data.slug},${data.title ?? null},${data.content ?? null},'micro',0,${now},${now},${data.parentPostId ?? null},${data.rootPostId ?? null},${data.depth ?? 0},${ctx.attemptId},0 WHERE ${guard}`

                  const creator = sql`INSERT INTO post_creators(postId,creatorId) SELECT ${id},${actor.userId} WHERE ${authorized}`

                  return {
                    statements: [ctx.prepare(insert), ctx.prepare(creator)],
                    assertApplied: sql`${authorized} AND EXISTS(SELECT 1 FROM post_creators WHERE postId=${id} AND creatorId=${actor.userId})`,
                    outcome: {
                      result: { kind: 'micro', targetId: id, version, state: 'published' },
                      revision: version,
                      access: { kind: 'micro', targetId: id, ownerId: actor.userId },
                    },
                  }
                },
              }
            }

            const unpublish =
              options.operation === 'unpublish_content'
                ? Schema.decodeUnknownSync(UnpublishContentInput, { onExcessProperty: 'error' })(
                    options.input,
                  )
                : undefined

            if (
              unpublish &&
              (unpublish.target.kind === 'mix' || unpublish.target.kind === 'show')
            ) {
              const target = unpublish.target
              const table = target.kind === 'mix' ? audioTable : showsTable

              const membership =
                target.kind === 'mix'
                  ? audioIdsForCreator(db, actor.userId)
                  : showIdsForCreator(db, actor.userId)

              const [row] = await db
                .select({
                  id: table.id,
                  revision: table.revision,
                  draft: table.draft,
                  updatedAt: table.updatedAt,
                })
                .from(table)
                .where(
                  and(
                    eq(table.id, target.targetId),
                    membership,
                    target.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
                  ),
                )
                .limit(1)

              if (!row) return { status: 'not_found' }

              if (
                row.draft ||
                row.revision !== target.expectedRevision ||
                row.revision === Number.MAX_SAFE_INTEGER
              )
                return { status: 'conflict' }

              if (
                !creatorResultFits(wire, endpoint, {
                  kind: target.kind,
                  targetId: row.id,
                  revision: row.revision + 1,
                  state: 'unpublished',
                })
              )
                return { status: 'invalid_input' }

              return {
                status: 'ready',
                build: (ctx) => {
                  const save = buildCreatorUpdate(
                    db,
                    target.kind === 'mix' ? 'audio' : 'show',
                    row,
                    actor.userId,
                    { draft: true },
                    {
                      attemptId: ctx.attemptId,
                      now: new Date(Math.max(now, row.updatedAt.getTime() + 1)),
                      guard: ctx.fence,
                      liveGuard: checkpoint.liveGuard,
                    },
                  )

                  return {
                    statements: [
                      ctx.prepare(save.update.getSQL()),
                      ...save.writes.map(ctx.prepare),
                    ],
                    assertApplied: sql`${ctx.fence} AND ${save.authorized}`,
                    outcome: {
                      result: {
                        kind: target.kind,
                        targetId: row.id,
                        revision: row.revision + 1,
                        state: 'unpublished',
                      },
                      revision: row.revision + 1,
                      access: { kind: target.kind, targetId: row.id, ownerId: actor.userId },
                    },
                  }
                },
              }
            }

            const target = unpublish?.target

            const input =
              target && 'expectedVersion' in target
                ? { postId: target.targetId, expectedVersion: target.expectedVersion }
                : Schema.decodeUnknownSync(PublishEditorialInput, { onExcessProperty: 'error' })(
                    options.input,
                  )

            const transition = unpublish ? 'unpublish' : 'publish'

            const prepared = await run(
              Effect.result(
                prepareCreatorPostTransition({
                  postId: input.postId,
                  expectedVersion: input.expectedVersion,
                  actorId: actor.userId,
                  transition,
                  now: new Date(now),
                }).pipe(
                  Effect.provideService(Database, db),
                  Effect.provideService(EditorialMcpConfig, config),
                ),
              ),
            )

            if (Result.isFailure(prepared)) {
              const code = prepared.failure.code

              return {
                status:
                  code === 'not_found' || code === 'conflict' || code === 'invalid_input'
                    ? code
                    : 'unavailable',
              }
            }

            const { snapshot, patch, version } = prepared.success

            if (
              target &&
              snapshot.type !== target.kind &&
              !(target.kind === 'post' && snapshot.type === null)
            )
              return { status: 'not_found' }
            const kind = snapshot.type === 'micro' ? 'micro' : 'post'

            if (
              !creatorResultFits(wire, endpoint, {
                kind,
                targetId: snapshot.id,
                version,
                state: unpublish ? 'unpublished' : 'published',
              })
            )
              return { status: 'invalid_input' }

            return {
              status: 'ready',
              build: (ctx) => {
                const save = buildGuardedPostUpdate(
                  db,
                  snapshot,
                  actor.userId,
                  patch,
                  undefined,
                  [],
                  {
                    guard: and(ctx.fence, editorialSnapshotGuard(snapshot)),
                    liveGuard: checkpoint.liveGuard,
                    now: patch.updatedAt,
                    allowAdmin: false,
                    attemptId: ctx.attemptId,
                  },
                )

                const result: JsonValue = {
                  kind,
                  targetId: snapshot.id,
                  version,
                  state: unpublish ? 'unpublished' : 'published',
                }

                return {
                  statements: [
                    ctx.prepare(save.update.getSQL()),
                    ...save.writes.map((w) => ctx.prepare(w.getSQL())),
                  ],
                  assertApplied: sql`${ctx.fence} AND ${save.authorized}`,
                  outcome: {
                    result,
                    revision: version,
                    access: { kind, targetId: snapshot.id, ownerId: actor.userId },
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
        message: 'Post command did not return an applied outcome.',
      })

    return yield* Schema.decodeUnknownEffect(CreatorCommandResult)({
      endpoint,
      status: 'applied',
      replayed: result.status === 'replayed',
      target: result.outcome.result,
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(checkCreatorResponse))
  })

  return {
    replyToMicroPost: (raw: typeof ReplyToMicroPostInput.Type) =>
      Schema.decodeUnknownEffect(ReplyToMicroPostInput, { onExcessProperty: 'error' })(raw).pipe(
        Effect.mapError(invalid),
        Effect.flatMap((input) =>
          execute({ operation: 'reply_to_micro_post', input, scopes: ['micros:publish'] }),
        ),
      ),
    createMicroPost: (raw: typeof CreateMicroPostInput.Type) =>
      Schema.decodeUnknownEffect(CreateMicroPostInput, { onExcessProperty: 'error' })(raw).pipe(
        Effect.mapError(invalid),
        Effect.flatMap((input) =>
          execute({ operation: 'create_micro_post', input, scopes: ['micros:publish'] }),
        ),
      ),
    publishEditorial: (raw: typeof PublishEditorialInput.Type) =>
      Schema.decodeUnknownEffect(PublishEditorialInput, { onExcessProperty: 'error' })(raw).pipe(
        Effect.mapError(invalid),
        Effect.flatMap((input) =>
          execute({
            operation: 'publish_editorial',
            input,
            scopes: ['posts:read', 'drafts:write', 'content:publish'],
          }),
        ),
      ),
    unpublishContent: (raw: typeof UnpublishContentInput.Type) =>
      Schema.decodeUnknownEffect(UnpublishContentInput, { onExcessProperty: 'error' })(raw).pipe(
        Effect.mapError(invalid),
        Effect.flatMap((input) => {
          const scopes: ReadonlyArray<McpScope> = Match.value(input.target.kind).pipe(
            Match.when('post', () => ['posts:read', 'drafts:write', 'content:publish'] as const),
            Match.when('micro', () => ['micros:publish', 'content:publish'] as const),
            Match.whenOr('mix', 'show', () => ['creator:write', 'content:publish'] as const),
            Match.exhaustive,
          )

          return execute({ operation: 'unpublish_content', input, scopes })
        }),
      ),
  }
})

export class CreatorPostCommands extends Context.Service<
  CreatorPostCommands,
  Effect.Success<typeof make>
>()('gbfm/CreatorPostCommands') {}

export const CreatorPostCommandsLayer = Layer.effect(CreatorPostCommands, make)
