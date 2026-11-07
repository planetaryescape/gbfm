import type { McpScope } from '@gbfm/core/editorial-mcp'
import { type SQL, sql } from 'drizzle-orm'
import { Effect, Result, Schema } from 'effect'

import { Database } from '@/db/layer'

import { McpToolError } from '../contracts'
import { McpOperationStore } from '../operations/store'
import { MusicEditCommand, MusicEditId } from './commands'
import { musicEditTarget, planMusicEdit } from './planner'
import { musicEditStatements } from './statements'

const Access = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track', 'label']),
  entityId: MusicEditId,
})

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

/** Required request-scoped P1 checkpoint, not an authority provider or fallback.
 * Composition supplies CommandAuthority.checkpoint; captured McpPrincipal is not enough.
 */
export const createMusicEditExecutor = (
  checkpoint: (requiredScopes: ReadonlyArray<McpScope>) => Effect.Effect<
    {
      readonly actorId: string
      readonly clientId: string
      readonly resource: string
      readonly liveGuard: SQL
    },
    McpToolError
  >,
) => ({
  apply: Effect.fn('MusicEdit.apply')(function* (raw: Schema.Json, now: number) {
    const db = yield* Database
    const store = yield* McpOperationStore
    const runPromise = Effect.runPromiseWith(yield* Effect.context())
    const initial = yield* checkpoint(['catalogue:write'])

    const command = yield* Schema.decodeUnknownEffect(MusicEditCommand)(raw, {
      onExcessProperty: 'error',
    }).pipe(
      Effect.mapError(
        () => new McpToolError({ code: 'invalid_input', message: 'Invalid music edit.' }),
      ),
    )

    const target = musicEditTarget(command.change)
    // Read failures/current reference validation are deferred until build, AFTER
    // the common receipt lookup. A later edit or removed reference cannot block
    // replay of the original authorized result.
    const observed = yield* Effect.result(planMusicEdit(command.change))
    let authority = initial
    let buildFailure: McpToolError | undefined

    const result = yield* Effect.tryPromise({
      try: () =>
        store.execute({
          key: {
            actorId: initial.actorId,
            clientId: initial.clientId,
            resource: initial.resource,
            operation: command.change.operation,
            requestId: command.requestId,
          },
          normalizedInput: command,
          now,
          authorize: async (outcome) => {
            const checked = await runPromise(Effect.result(checkpoint(['catalogue:write'])))

            if (Result.isFailure(checked)) {
              if (checked.failure.code === 'access_denied') return false
              throw checked.failure
            }

            const fresh = checked.success

            if (
              fresh.actorId !== initial.actorId ||
              fresh.clientId !== initial.clientId ||
              fresh.resource !== initial.resource
            )
              return false
            authority = fresh

            if (!outcome) return true

            if (
              !Schema.is(Access)(outcome.access) ||
              outcome.access.entityType !== target.entityType ||
              outcome.access.entityId !== target.entityId
            )
              return false

            return Boolean(
              await db.get(
                sql`SELECT 1 FROM ${sql.identifier(tables[target.entityType])} WHERE id=${target.entityId}`,
              ),
            )
          },
          build: (ctx) => {
            // The store translates build failure to invalid_input; restore our typed
            // domain failure below, but only when build actually ran (not replay).
            if (Result.isFailure(observed)) {
              buildFailure = observed.failure
              throw observed.failure
            }

            const plan = observed.success

            const artistNameChanged =
              command.change.operation === 'update_music_metadata' &&
              command.change.entityType === 'artist' &&
              command.change.metadata.name !== undefined &&
              Schema.is(Schema.JsonObject)(plan.before) &&
              plan.before.name !== command.change.metadata.name

            const statements = musicEditStatements({
              command,
              changed: plan.changed,
              artistNameChanged,
              now,
              attemptId: ctx.attemptId,
              fence: ctx.fence,
              prepare: ctx.prepare,
              liveGuard: authority.liveGuard,
              eligibility: sql`${plan.revision === command.expectedRevision ? 1 : 0}`,
            })

            return {
              ...statements,
              outcome: {
                result: {
                  operation: command.change.operation,
                  ...target,
                  field: plan.field,
                  after: plan.after,
                  changed: plan.changed,
                },
                revision: {
                  ...target,
                  revision: command.expectedRevision + (plan.changed ? 1 : 0),
                },
                access: target,
              },
            }
          },
        }),
      catch: () =>
        new McpToolError({
          code: 'unavailable',
          message: 'Music edit is unavailable; retry the identical request.',
        }),
    })

    if (result.status === 'invalid_input' && buildFailure) return yield* buildFailure

    return result
  }),
})
