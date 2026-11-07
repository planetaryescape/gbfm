import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'

import { canonicalJson, operationIdentity, prepareOperationStatement } from './persistence'

/** JSON-only normalized command and bounded receipt data; omission differs from null. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

/** Trusted composition supplies actor/client/audience; only requestId comes from the wire. */
export interface OperationKey {
  readonly actorId: string
  readonly clientId: string
  readonly resource: string
  readonly operation: string
  readonly requestId: string
}

/** Original committed projection, not a later read. No credentials or provider payloads. */
export interface OperationOutcome {
  readonly result: JsonValue
  readonly revision: JsonValue
  readonly access: JsonValue
}

/** Statement builders are synchronous, side-effect-free and must not execute SQL/network work. */
export interface OperationContext {
  readonly attemptId: string
  readonly operationId: string
  /** Every mutation includes this predicate; coupled DML ALSO checks the domain winning marker. */
  readonly fence: SQL
  readonly prepare: (statement: SQL) => D1PreparedStatement
}

/** Domain services own live SQL authority, expected revisions and physical winning markers. */
export interface AtomicOperationPlan {
  readonly statements: ReadonlyArray<D1PreparedStatement>
  /** Must prove the domain CAS/lease marker equals this physical attempt, not just desired state. */
  readonly assertApplied: SQL
  readonly outcome: OperationOutcome
}

/** Authorization is fresh both before lookup and before disclosure; receipts never confer authority. */
export interface ExecuteOperation {
  readonly key: OperationKey
  readonly normalizedInput: JsonValue
  readonly now: number
  /** Called without outcome before lookup, then with saved outcome before disclosure.
   * Recheck persisted grant, role, scopes, owner, actual type and visibility/existence.
   * False means denied; rejection means unavailable, never authority to continue.
   */
  readonly authorize: (outcome?: OperationOutcome) => Promise<boolean>
  readonly build: (context: OperationContext) => AtomicOperationPlan
}

/** Unavailable means commit may have happened: retry only the identical key/input. */
export type OperationResult =
  | {
      readonly status: 'applied' | 'replayed'
      readonly operationId: string
      readonly outcome: OperationOutcome
      readonly createdAt: number
      readonly expiresAt: number
    }
  | { readonly status: 'conflict' | 'expired' | 'access_denied' | 'invalid_input' | 'unavailable' }

/** Fixed adapter diagnostics only: never include errors, SQL, keys, IDs or receipt data. */
export interface OperationDiagnostic {
  readonly operation:
    | 'receipt.lookup'
    | 'receipt.decode'
    | 'receipt.batch'
    | 'receipt.authorize'
    | 'receipt.prune'
  readonly dependency: 'database' | 'codec' | 'authorization'
  readonly code: 'storage_failed' | 'decode_failed' | 'authorization_failed'
}

const reportUnavailable = (diagnostic: OperationDiagnostic) =>
  Effect.runSync(Effect.logError('mcp.operation.unavailable', diagnostic))

const windowMs = 86_400_000

const encoder = new TextEncoder()

const outcomeSchema = Schema.Struct({
  result: Schema.Json,
  revision: Schema.Json,
  access: Schema.Json,
})

const decodeOutcome = Schema.decodeUnknownSync(outcomeSchema)

const decodeRow = Schema.decodeUnknownSync(
  Schema.Struct({
    input_hash: Schema.String,
    state: Schema.Literals(['pending', 'complete', 'expired']),
    outcome: Schema.NullOr(Schema.String),
    created_at: Schema.Number,
    expires_at: Schema.Number,
    attempt_id: Schema.NullOr(Schema.String),
  }),
)

/** One shared D1 adapter, not a dispatcher or a transaction spanning provider calls. */
export const createMcpOperationStore = (
  database: D1Database,
  report: (diagnostic: OperationDiagnostic) => void = reportUnavailable,
) => {
  const diagnostic = (event: OperationDiagnostic) => {
    // A broken reporter must not turn a committed command into an exception.
    try {
      report(event)
    } catch {
      /* Reporting cannot change the persistence contract. */
    }
  }

  const prepare = (statement: SQL) => prepareOperationStatement(database, statement)

  const redact = sql`actor_id = NULL, client_id = NULL, attempt_id = NULL, outcome = NULL, state = 'expired'`

  return {
    /** Run from the existing maintenance owner at least daily; never delete key/input tombstones. */
    async pruneExpired(
      now: number,
    ): Promise<{ readonly status: 'pruned' | 'invalid_input' | 'unavailable' }> {
      if (!Number.isSafeInteger(now) || now < 0) return { status: 'invalid_input' }

      try {
        await prepare(
          sql`UPDATE mcp_operations SET ${redact} WHERE expires_at <= ${now} AND state <> 'expired'`,
        ).run()

        return { status: 'pruned' }
      } catch {
        diagnostic({ operation: 'receipt.prune', dependency: 'database', code: 'storage_failed' })

        return { status: 'unavailable' }
      }
    },

    /** Atomic local phase only. All coupled domain writes and receipt commit or roll back together. */
    async execute(input: ExecuteOperation): Promise<OperationResult> {
      const { key, now } = input

      if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + windowMs))
        return { status: 'invalid_input' }

      let operationId: string
      let inputHash: string

      try {
        const identity = await operationIdentity(key, input.normalizedInput)
        operationId = identity.operationId
        inputHash = identity.inputHash
      } catch {
        return { status: 'invalid_input' }
      }

      let failure: OperationDiagnostic = {
        operation: 'receipt.authorize',
        dependency: 'authorization',
        code: 'authorization_failed',
      }

      const read = async (attemptId?: string): Promise<OperationResult | undefined> => {
        failure = { operation: 'receipt.lookup', dependency: 'database', code: 'storage_failed' }

        const raw = await prepare(
          sql`SELECT input_hash, state, outcome, created_at, expires_at, attempt_id FROM mcp_operations WHERE id = ${operationId}`,
        ).first()

        if (!raw) return undefined
        failure = { operation: 'receipt.decode', dependency: 'codec', code: 'decode_failed' }
        const row = decodeRow(raw)

        if (
          !Number.isSafeInteger(row.created_at) ||
          row.created_at < 0 ||
          row.expires_at !== row.created_at + windowMs
        ) {
          diagnostic(failure)

          return { status: 'unavailable' }
        }

        if (row.expires_at <= now || row.state === 'expired') {
          failure = { operation: 'receipt.prune', dependency: 'database', code: 'storage_failed' }
          await prepare(sql`UPDATE mcp_operations SET ${redact} WHERE id = ${operationId}`).run()

          return { status: 'expired' }
        }

        if (row.input_hash !== inputHash) return { status: 'conflict' }

        if (row.state !== 'complete' || row.outcome === null) {
          diagnostic(failure)

          return { status: 'unavailable' }
        }

        const outcome = decodeOutcome(JSON.parse(row.outcome))

        failure = {
          operation: 'receipt.authorize',
          dependency: 'authorization',
          code: 'authorization_failed',
        }

        if (!(await input.authorize(outcome))) return { status: 'access_denied' }

        return {
          status: row.attempt_id === attemptId ? 'applied' : 'replayed',
          operationId,
          outcome,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }
      }

      try {
        if (!(await input.authorize())) return { status: 'access_denied' }
        const previous = await read()

        if (previous) return previous
        const attemptId = crypto.randomUUID()
        const fence = sql`EXISTS (SELECT 1 FROM mcp_operations WHERE id = ${operationId} AND attempt_id = ${attemptId} AND state = 'pending' AND input_hash = ${inputHash})`
        let plan: AtomicOperationPlan
        let outcome: string

        try {
          plan = input.build({ attemptId, operationId, fence, prepare })
          outcome = canonicalJson({
            result: plan.outcome.result,
            revision: plan.outcome.revision,
            access: plan.outcome.access,
          })
          decodeOutcome(JSON.parse(outcome))

          if (encoder.encode(outcome).length > 65536) return { status: 'invalid_input' }
        } catch {
          return { status: 'invalid_input' }
        }

        failure = { operation: 'receipt.batch', dependency: 'database', code: 'storage_failed' }

        const claim =
          prepare(sql`INSERT INTO mcp_operations (id, actor_id, client_id, input_hash, attempt_id, state, outcome, created_at, expires_at)
          VALUES (${operationId}, ${key.actorId}, ${key.clientId}, ${inputHash}, ${attemptId}, 'pending', NULL, ${now}, ${now + windowMs}) ON CONFLICT(id) DO NOTHING`)

        // A zero-row CAS is not a SQL exception. Force the named CHECK to abort the
        // entire batch if the physical winner is absent, even after coupled writes.
        const finalize = prepare(sql`UPDATE mcp_operations SET state = 'complete',
          outcome = CASE WHEN (${plan.assertApplied}) THEN ${outcome} ELSE NULL END
          WHERE id = ${operationId} AND attempt_id = ${attemptId} AND state = 'pending'`)

        try {
          await database.batch([claim, ...plan.statements, finalize])
        } catch (cause) {
          if (
            cause instanceof Error &&
            cause.message.includes('CHECK constraint failed: mcp_operation_winner')
          )
            return { status: 'conflict' }

          diagnostic({ operation: 'receipt.batch', dependency: 'database', code: 'storage_failed' })

          // A lost response may follow a committed batch; persisted receipt wins.
          return (await read()) ?? { status: 'unavailable' }
        }

        return (await read(attemptId)) ?? { status: 'unavailable' }
      } catch {
        diagnostic(failure)

        return { status: 'unavailable' }
      }
    },
  }
}

/** Inject this service into domain layers; raw D1 remains at the composition boundary. */
export class McpOperationStore extends Context.Service<
  McpOperationStore,
  ReturnType<typeof createMcpOperationStore>
>()('gbfm/mcp/OperationStore') {}

/** P1 composes alongside DatabaseLayer using the SAME env.DB; no service reaches into Drizzle internals. */
export const McpOperationStoreLayer = (database: D1Database) =>
  Layer.sync(McpOperationStore, () => createMcpOperationStore(database))
