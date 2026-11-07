import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { type SQL, sql } from 'drizzle-orm'
import { Effect, Result, Schema } from 'effect'

import { Database } from '@/db/layer'

export const MusicWriteIntent = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID(4)),
  expectedRevision: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ),
})

export type MusicWriteIntent = typeof MusicWriteIntent.Type

export interface MusicWriteRequest {
  readonly intent: MusicWriteIntent
  readonly context: MusicWriteContext
  readonly references: ReadonlyArray<{
    readonly entityType: 'artist' | 'album' | 'track' | 'label'
    readonly entityId: string
    readonly expectedRevision: number
  }>
}

export class MusicWriteError extends Schema.TaggedError<MusicWriteError>()('MusicWriteError', {
  code: Schema.Literals([
    'precondition_required',
    'invalid_input',
    'not_found',
    'conflict',
    'access_denied',
    'unavailable',
    'expired',
  ]),
  message: Schema.String,
}) {}

export interface MusicWriteAuthority {
  readonly actorId: string
  readonly clientId: string
  readonly resource: string
  readonly liveGuard: SQL
}

export interface MusicWriteAttempt {
  readonly attemptId: string
  readonly operationId: string
  readonly fence: SQL
  readonly prepare: (statement: SQL) => D1PreparedStatement
}

export interface MusicWritePlan {
  readonly statements: ReadonlyArray<D1PreparedStatement>
  readonly assertApplied: SQL
  readonly outcome: {
    readonly result: Schema.Json
    readonly revision: Schema.Json
    readonly access: Schema.Json
  }
}

/** Structural port implemented by the existing common receipt store, not a ledger.
 * Composition decodes its result and disclosure evidence with the codecs below.
 * Transport services and credentials never enter this module.
 */
export interface MusicWriteContext {
  readonly now: number
  readonly checkpoint: Effect.Effect<MusicWriteAuthority, MusicWriteError>
  readonly execute: (input: {
    readonly key: {
      readonly actorId: string
      readonly clientId: string
      readonly resource: string
      readonly operation: string
      readonly requestId: string
    }
    readonly normalizedInput: Schema.Json
    readonly now: number
    readonly authorize: (outcome?: typeof MusicWriteStoredOutcome.Type) => Promise<boolean>
    readonly prepare: () => Promise<
      | { readonly status: 'ready'; readonly build: (attempt: MusicWriteAttempt) => MusicWritePlan }
      | { readonly status: 'conflict' | 'not_found' | 'invalid_input' | 'unavailable' }
    >
  }) => Promise<typeof MusicWriteStoreResult.Type>
}

const Target = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track', 'label']),
  entityId: Schema.NonEmptyString,
})

const SavedAccess = Schema.Struct({ access: Target })

export const MusicWriteStoredOutcome = Schema.Struct({
  result: Schema.Json,
  revision: Schema.Json,
  access: Schema.Json,
})

const Committed = Schema.Struct({
  status: Schema.Literals(['applied', 'replayed']),
  operationId: Schema.String,
  outcome: MusicWriteStoredOutcome,
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
})

export const MusicWriteStoreResult = Schema.Union([
  Committed,
  Schema.Struct({
    status: Schema.Literals([
      'conflict',
      'not_found',
      'invalid_input',
      'unavailable',
      'access_denied',
      'expired',
    ]),
  }),
])

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

const unavailable = () =>
  new MusicWriteError({ code: 'unavailable', message: 'Music write is unavailable.' })

/** The caller's observed revision and request ID are never replaced by fresh state.
 * Read-only preparation runs after common receipt lookup. Every builder remains
 * synchronous and receives the latest checked SQL authority plus physical fence.
 */
export const executeMusicWrite = Effect.fn('musicEntity.executeWrite')(function* (
  intent: MusicWriteIntent | undefined,
  context: MusicWriteContext,
  command: {
    readonly operation: string
    readonly target: typeof Target.Type
    readonly normalizedInput: Schema.Json
    readonly prepare: Effect.Effect<
      {
        readonly build: (attempt: MusicWriteAttempt & { readonly liveGuard: SQL }) => MusicWritePlan
      },
      MusicWriteError,
      Database
    >
  },
) {
  if (!intent)
    return yield* new MusicWriteError({
      code: 'precondition_required',
      message: 'An observed revision and request ID are required.',
    })

  const observedIntent = yield* Schema.decodeUnknownEffect(MusicWriteIntent)(intent, {
    onExcessProperty: 'error',
  }).pipe(
    Effect.mapError(
      () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid music write intent.' }),
    ),
  )

  const db = yield* Database
  const runPromise = Effect.runPromiseWith(yield* Effect.context<Database>())
  const initial = yield* context.checkpoint
  let authority = initial

  const result = yield* Effect.tryPromise({
    try: () =>
      context.execute({
        key: {
          actorId: initial.actorId,
          clientId: initial.clientId,
          resource: initial.resource,
          operation: command.operation,
          requestId: observedIntent.requestId,
        },
        normalizedInput: {
          intent: observedIntent,
          target: command.target,
          command: command.normalizedInput,
        },
        now: context.now,
        authorize: async (outcome) => {
          const checked = await runPromise(Effect.result(context.checkpoint))

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

          const saved = Schema.decodeUnknownResult(SavedAccess)(outcome)

          if (Result.isFailure(saved)) return false

          const access = saved.success.access

          if (
            access.entityType !== command.target.entityType ||
            access.entityId !== command.target.entityId
          )
            return false

          return Boolean(
            await db.get(
              sql`SELECT 1 FROM ${sql.identifier(tables[access.entityType])} WHERE id=${access.entityId}`,
            ),
          )
        },
        prepare: async () => {
          const prepared = await runPromise(Effect.result(command.prepare))

          if (Result.isFailure(prepared)) {
            const code = prepared.failure.code

            return {
              status:
                code === 'not_found' || code === 'conflict' || code === 'invalid_input'
                  ? code
                  : 'unavailable',
            }
          }

          return {
            status: 'ready',
            build: (attempt) =>
              prepared.success.build({ ...attempt, liveGuard: authority.liveGuard }),
          }
        },
      }),
    catch: unavailable,
  })

  if (result.status !== 'applied' && result.status !== 'replayed')
    return yield* new MusicWriteError({ code: result.status, message: 'Music write not applied.' })

  return result
})
