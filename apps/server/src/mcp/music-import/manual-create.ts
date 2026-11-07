import type { McpResourceUrl } from '@gbfm/core/editorial-mcp'
import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Result, Schema } from 'effect'

import { Database } from '@/db/layer'
import { validateCanonicalContent } from '@/lib/mdx'
import { McpToolError } from '@/mcp/contracts'
import { McpOperationStore } from '@/mcp/operations/store'
import { musicCreateStatements, type MusicCreate } from '@/services/music-entity/create-statements'

import { MusicImportExecutionAuthority } from './execution-authority'

const reference = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track', 'label']),
  entityId: Schema.String.check(Schema.isUUID(4)),
})

const makeWriter = Effect.gen(function* () {
  const authority = yield* MusicImportExecutionAuthority
  const operations = yield* McpOperationStore
  const db = yield* Database

  const execute = Effect.fn('MusicManualCreate.execute')(function* (
    raw: Schema.Json,
    resource: McpResourceUrl,
    intent: { readonly liveGuard: SQL; readonly now: number },
  ) {
    const services = yield* Effect.context()
    const prepared = yield* authority.check(raw, resource)
    const { command, receiptScope } = prepared

    if (command.operation === 'import_music_url') {
      return yield* new McpToolError({
        code: 'invalid_input',
        message: 'Expected a manual create command.',
      })
    }

    const actor = { createdById: receiptScope.actorId }
    let create: MusicCreate

    switch (command.operation) {
      case 'create_artist':
        create = {
          entityType: 'artist',
          data: { ...command.input, ...actor, genres: command.input.genres?.slice() ?? null },
        }
        break
      case 'create_album': {
        const { artistIds, ...data } = command.input
        create = {
          entityType: 'album',
          data: {
            ...data,
            ...actor,
            artistNames: command.input.artistNames?.slice() ?? null,
            genres: command.input.genres?.slice() ?? null,
            releaseDate:
              command.input.releaseDate === undefined || command.input.releaseDate === null
                ? null
                : new Date(command.input.releaseDate),
          },
        }

        if (artistIds !== undefined) create.data.artistIds = artistIds.slice()
        break
      }

      case 'create_track': {
        const { artistIds, ...data } = command.input
        create = {
          entityType: 'track',
          data: {
            ...data,
            ...actor,
            artistNames: command.input.artistNames?.slice() ?? null,
          },
        }

        if (artistIds !== undefined) create.data.artistIds = artistIds.slice()
        break
      }

      case 'create_label':
        yield* validateCanonicalContent(command.input.content).pipe(
          Effect.mapError(
            () => new McpToolError({ code: 'invalid_input', message: 'Invalid label content.' }),
          ),
        )
        create = {
          entityType: 'label',
          data: {
            ...command.input,
            ...actor,
            genres: command.input.genres?.slice() ?? null,
            tags: command.input.tags?.slice() ?? null,
          },
          attribution: 'audit_only',
        }
        break
    }

    const id = crypto.randomUUID()
    const { requestId: _requestId, ...normalizedInput } = command.input

    return yield* Effect.tryPromise({
      try: () =>
        operations.execute({
          key: receiptScope,
          normalizedInput,
          now: intent.now,
          authorize: async (outcome) => {
            const allowed = await Effect.runPromiseWith(services)(
              authority.check(raw, resource).pipe(Effect.result),
            )

            if (Result.isFailure(allowed)) {
              if (allowed.failure.code === 'unavailable')
                throw new Error('Music authority unavailable')

              return false
            }

            if (!outcome) return true
            const target = Schema.decodeUnknownOption(reference)(outcome.access)

            if (Option.isNone(target) || target.value.entityType !== create.entityType) return false

            const table = sql.identifier(
              {
                artist: 'music_artists',
                album: 'music_albums',
                track: 'music_tracks',
                label: 'music_labels',
              }[target.value.entityType],
            )

            return Boolean(
              await db.get(
                sql`SELECT 1 FROM ${table} WHERE id = ${target.value.entityId} AND ${intent.liveGuard}`,
              ),
            )
          },
          build: (context) => ({
            ...musicCreateStatements(
              { ...context, fence: sql`(${context.fence}) AND (${intent.liveGuard})` },
              create,
              id,
              intent.now,
            ),
            outcome: {
              result: {
                status: 'created',
                reference: { entityType: create.entityType, entityId: id },
              },
              revision: 0,
              access: { entityType: create.entityType, entityId: id },
            },
          }),
        }),
      catch: () =>
        new McpToolError({
          code: 'unavailable',
          message: 'Music creation unavailable; retry the same request.',
        }),
    })
  })

  return { execute }
})

export class MusicManualCreate extends Context.Service<
  MusicManualCreate,
  Effect.Success<typeof makeWriter>
>()('gbfm/mcp/MusicManualCreate') {}

export const MusicManualCreateLayer = Layer.effect(MusicManualCreate, makeWriter)
