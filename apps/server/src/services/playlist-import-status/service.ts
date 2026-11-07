import { sql, type SQL } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Database } from '@/db/layer'
import { CommandAuthority, type CommandCheckpoint } from '@/mcp/command-authority'
import { McpToolError } from '@/mcp/contracts'

import { playlistImportWorkerFence } from './statements'

const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))

const operationId = Schema.String.check(Schema.makeFilter((value) => /^[a-f0-9]{64}$/.test(value)))

const attemptId = Schema.String.check(Schema.isUUID(4))

const targetId = Schema.NonEmptyString.check(
  Schema.isMaxLength(200),
  Schema.makeFilter((value) => !value.includes('\u0000')),
)

const identity = { operationId, expectedRevision: count }

const worker = {
  ...identity,
  attemptId,
  generation: count,
  phase: Schema.Literals(['importing', 'enriching']),
}

const databaseNow = sql`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

const terminal = sql`phase IN ('completed','partial','failed','interrupted','retired')`

const projection = sql`operation_id AS operationId,phase,revision,
  playlist_id AS playlistId,playlist_revision AS playlistRevision,
  imported_processed AS importedProcessed,import_failed AS importFailed,imported_total AS importedTotal,
  enrichment_processed AS enrichmentProcessed,enrichment_failed AS enrichmentFailed,enrichment_total AS enrichmentTotal,
  failure_code AS failureCode,terminal_at AS terminalAt,dispatch_state AS dispatchState,
  dispatch_attempts AS dispatchAttempts,next_dispatch_at AS nextDispatchAt,
  dispatched_at AS dispatchedAt,attempt_id AS attemptId,generation,lease_until AS leaseUntil,
  cursor_position AS cursorPosition,cursor_track_id AS cursorTrackId`

const rowSchema = Schema.Struct({
  operationId,
  phase: Schema.Literals([
    'importing',
    'enrichment_pending',
    'enriching',
    'completed',
    'partial',
    'failed',
    'interrupted',
    'retired',
  ]),
  revision: count,
  playlistId: Schema.NullOr(targetId),
  playlistRevision: Schema.NullOr(count),
  importedProcessed: count,
  importFailed: count,
  importedTotal: Schema.NullOr(count),
  enrichmentProcessed: count,
  enrichmentFailed: count,
  enrichmentTotal: Schema.NullOr(count),
  failureCode: Schema.NullOr(
    Schema.Literals([
      'provider_unavailable',
      'source_changed',
      'authority_denied',
      'target_changed',
      'status_unavailable',
      'interrupted',
    ]),
  ),
  terminalAt: Schema.NullOr(count),
  dispatchState: Schema.Literals(['none', 'pending', 'sent']),
  dispatchAttempts: count,
  nextDispatchAt: Schema.NullOr(count),
  dispatchedAt: Schema.NullOr(count),
  attemptId: Schema.NullOr(attemptId),
  generation: count,
  leaseUntil: Schema.NullOr(count),
  cursorPosition: Schema.NullOr(count),
  cursorTrackId: Schema.NullOr(attemptId),
})

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Import status unavailable.' })

const conflict = () => new McpToolError({ code: 'conflict', message: 'Import status changed.' })

const namespaceGuard = (checkpoint: CommandCheckpoint) => sql`actor_id=${checkpoint.actorId}
  AND client_id=${checkpoint.clientId} AND resource=${checkpoint.resource}`

/** Request-scoped specialized lifecycle, not a provider or central worker. Uses
 * P1 authority and the same Database; never creates an independent receipt.
 * Import takeover is forbidden. Enrichment takeover preserves committed cursor
 * and counters. Per-item outcome persistence must still join guarded domain DML.
 */
export const makePlaylistImportStatusService = Effect.gen(function* () {
  const db = yield* Database
  const authority = yield* CommandAuthority
  const checkpoint = () => authority.checkpoint(['catalogue:write'])

  const query = (statement: SQL) =>
    Effect.tryPromise({ try: () => db.get(statement), catch: unavailable })

  const parse = <S extends Schema.Top>(schema: S, raw: Schema.Json) =>
    Schema.decodeUnknownEffect(schema)(raw, { onExcessProperty: 'error' }).pipe(
      Effect.mapError(
        () => new McpToolError({ code: 'invalid_input', message: 'Invalid import status input.' }),
      ),
    )

  const recheck = (initial: CommandCheckpoint) =>
    checkpoint().pipe(
      Effect.flatMap((fresh) =>
        fresh.actorId === initial.actorId &&
        fresh.clientId === initial.clientId &&
        fresh.resource === initial.resource
          ? Effect.void
          : Effect.fail(
              new McpToolError({ code: 'access_denied', message: 'Import status access denied.' }),
            ),
      ),
    )

  const mutate = Effect.fn('PlaylistImportStatus.mutate')(function* (
    input: { readonly operationId: string; readonly expectedRevision: number },
    assignments: ReadonlyArray<SQL>,
    eligibility: (fresh: CommandCheckpoint) => SQL,
  ) {
    const fresh = yield* checkpoint()
    const marker = crypto.randomUUID()

    const row = yield* query(sql`UPDATE playlist_import_statuses
      SET ${sql.join([...assignments], sql`, `)},revision=revision+1,last_attempt_id=${marker},updated_at=${databaseNow}
      WHERE operation_id=${input.operationId} AND revision=${input.expectedRevision}
        AND revision<${Number.MAX_SAFE_INTEGER} AND (${namespaceGuard(fresh)})
        AND EXISTS (SELECT 1 FROM mcp_operations WHERE id=operation_id AND state IN ('complete','expired'))
        AND (${fresh.liveGuard}) AND (${eligibility(fresh)}) RETURNING ${projection}`)

    if (!row) return yield* conflict()

    const decoded = yield* Schema.decodeUnknownEffect(rowSchema)(row).pipe(
      Effect.mapError(unavailable),
    )

    yield* recheck(fresh)

    return decoded
  })

  return {
    /** Private same-namespace projection; terminal receipts expire, inflight jobs do not. */
    read: Effect.fn('PlaylistImportStatus.read')(function* (raw: Schema.Json) {
      const input = yield* parse(Schema.Struct({ operationId }), raw)
      const fresh = yield* checkpoint()

      const row = yield* query(sql`SELECT ${projection} FROM playlist_import_statuses
        WHERE operation_id=${input.operationId} AND (${namespaceGuard(fresh)}) AND (${fresh.liveGuard})
          AND (NOT (${terminal}) OR EXISTS (SELECT 1 FROM mcp_operations
            WHERE id=operation_id AND expires_at>${databaseNow}))`)

      if (!row)
        return yield* new McpToolError({ code: 'not_found', message: 'Import status not found.' })

      const decoded = yield* Schema.decodeUnknownEffect(rowSchema)(row).pipe(
        Effect.mapError(unavailable),
      )

      yield* recheck(fresh)

      return decoded
    }),
    /** Renew only the exact unexpired physical worker; never resurrect or take over imports. */
    renew: Effect.fn('PlaylistImportStatus.renew')(function* (raw: Schema.Json) {
      const input = yield* parse(Schema.Struct(worker), raw)

      return yield* mutate(input, [sql`lease_until=${databaseNow}+60000`], (fresh) =>
        playlistImportWorkerFence({ ...input, namespace: fresh }),
      )
    }),
    /** Called only after actual import outcomes are durably recorded. No invented
     * enrichment total: it remains unknown until a pinned worker snapshot exists.
     */
    enqueueEnrichment: Effect.fn('PlaylistImportStatus.enqueueEnrichment')(function* (
      raw: Schema.Json,
    ) {
      const input = yield* parse(
        Schema.Struct({
          ...worker,
          phase: Schema.Literal('importing'),
          playlistId: targetId,
          playlistRevision: count,
        }),
        raw,
      )

      return yield* mutate(
        input,
        [
          sql`playlist_id=${input.playlistId}`,
          sql`playlist_revision=${input.playlistRevision}`,
          sql`phase='enrichment_pending'`,
          sql`attempt_id=NULL`,
          sql`lease_until=NULL`,
          sql`dispatch_state='pending'`,
          sql`next_dispatch_at=${databaseNow}`,
          sql`dispatched_at=NULL`,
        ],
        (fresh) => sql`(${playlistImportWorkerFence({ ...input, namespace: fresh })})
        AND imported_total IS NOT NULL AND imported_processed=imported_total AND import_failed=0
        AND EXISTS (SELECT 1 FROM music_playlists WHERE id=${input.playlistId} AND revision=${input.playlistRevision})`,
      )
    }),
    /** A dispatcher records an attempt BEFORE send. A lost send/ack leaves pending
     * dispatch retryable; acknowledgment is not worker completion.
     */
    noteDispatchAttempt: Effect.fn('PlaylistImportStatus.noteDispatchAttempt')(function* (
      raw: Schema.Json,
    ) {
      const input = yield* parse(Schema.Struct(identity), raw)

      return yield* mutate(
        input,
        [sql`dispatch_attempts=dispatch_attempts+1`, sql`next_dispatch_at=${databaseNow}+60000`],
        () => sql`phase='enrichment_pending' AND dispatch_state='pending'
          AND next_dispatch_at<=${databaseNow} AND dispatch_attempts<${Number.MAX_SAFE_INTEGER}`,
      )
    }),
    /** Call only after successful queue send; a worker may already have won the CAS. */
    acknowledgeDispatch: Effect.fn('PlaylistImportStatus.acknowledgeDispatch')(function* (
      raw: Schema.Json,
    ) {
      const input = yield* parse(Schema.Struct(identity), raw)

      return yield* mutate(
        input,
        [sql`dispatch_state='sent'`, sql`next_dispatch_at=NULL`, sql`dispatched_at=${databaseNow}`],
        () => sql`phase='enrichment_pending' AND dispatch_state='pending' AND dispatch_attempts>0`,
      )
    }),
    /** Queue delivery can arrive before dispatcher acknowledgment. It may claim
     * pending work or replace an expired enrichment worker, never an import.
     */
    acquireEnrichment: Effect.fn('PlaylistImportStatus.acquireEnrichment')(function* (
      raw: Schema.Json,
    ) {
      const input = yield* parse(Schema.Struct({ ...identity, attemptId }), raw)

      return yield* mutate(
        input,
        [
          sql`phase='enriching'`,
          sql`attempt_id=${input.attemptId}`,
          sql`generation=generation+1`,
          sql`lease_until=${databaseNow}+60000`,
          sql`dispatch_state='sent'`,
          sql`next_dispatch_at=NULL`,
          sql`dispatched_at=coalesce(dispatched_at,${databaseNow})`,
        ],
        () => sql`(phase='enrichment_pending' OR (phase='enriching' AND lease_until<=${databaseNow}))
        AND generation<${Number.MAX_SAFE_INTEGER}
        AND EXISTS (SELECT 1 FROM music_playlists WHERE id=playlist_id AND revision=playlist_revision)`,
      )
    }),
    /** An expired synchronous import is ambiguous, not resumable or a failed item. */
    interruptExpiredImport: Effect.fn('PlaylistImportStatus.interruptExpiredImport')(function* (
      raw: Schema.Json,
    ) {
      const input = yield* parse(Schema.Struct(identity), raw)

      return yield* mutate(
        input,
        [
          sql`phase='interrupted'`,
          sql`failure_code='interrupted'`,
          sql`terminal_at=${databaseNow}`,
          sql`attempt_id=NULL`,
          sql`lease_until=NULL`,
          sql`cursor_position=NULL`,
          sql`cursor_track_id=NULL`,
        ],
        () => sql`phase='importing' AND lease_until<=${databaseNow}`,
      )
    }),
    /** Terminal-only TTL redaction; never expire an inflight lease or erase totals. */
    pruneTerminal: Effect.fn('PlaylistImportStatus.pruneTerminal')(function* (raw: Schema.Json) {
      const input = yield* parse(Schema.Struct(identity), raw)

      return yield* mutate(
        input,
        [sql`playlist_id=NULL`, sql`playlist_revision=NULL`],
        () => sql`(${terminal}) AND EXISTS (SELECT 1 FROM mcp_operations
          WHERE id=operation_id AND expires_at<=${databaseNow})`,
      )
    }),
  }
})
