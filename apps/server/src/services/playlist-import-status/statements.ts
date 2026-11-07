import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { sql, type SQL } from 'drizzle-orm'

import type { CommandCheckpoint } from '@/mcp/command-authority'
import type { OperationContext } from '@/mcp/operations/store'

const databaseNow = sql`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

/** SQL-time worker ownership, not authority by itself. AND with fresh liveGuard,
 * the operation fence and any target revision/physical winner before persistence.
 * No caller clock can extend an expired lease. Namespace comes from trusted auth.
 */
export const playlistImportWorkerFence = (input: {
  readonly operationId: string
  readonly namespace: Pick<CommandCheckpoint, 'actorId' | 'clientId' | 'resource'>
  readonly attemptId: string
  readonly generation: number
  readonly phase: 'importing' | 'enriching'
}): SQL => sql`EXISTS (SELECT 1 FROM playlist_import_statuses worker
  WHERE worker.operation_id=${input.operationId}
    AND worker.actor_id=${input.namespace.actorId}
    AND worker.client_id=${input.namespace.clientId}
    AND worker.resource=${input.namespace.resource}
    AND worker.phase=${input.phase}
    AND worker.attempt_id=${input.attemptId}
    AND worker.generation=${input.generation}
    AND worker.lease_until>${databaseNow})`

/** Coupled retirement only: the delete owner executes these statements AFTER its
 * parent CAS and BEFORE parent DELETE in the same common-store D1 batch. The
 * supplied parentWinner must identify this physical ctx.attemptId. Final receipt
 * assertion remains the delete owner's responsibility. This never executes SQL.
 *
 * Retire all matching jobs, even across namespaces: deletion invalidates every
 * worker. Preserve safe counters/generation/dispatch attempts; erase resumable
 * target/cursor/lease/outbox data. Do NOT filter exhausted revisions: schema0025
 * must reject the entire coupled batch rather than leave an orphaned worker.
 */
export const playlistImportRetirementStatements = (input: {
  readonly playlistId: string
  readonly ctx: OperationContext
  readonly parentWinner: SQL
  readonly liveGuard: SQL
  readonly now: number
}): ReadonlyArray<D1PreparedStatement> => [
  input.ctx.prepare(sql`UPDATE playlist_import_statuses
    SET phase='retired', terminal_at=${input.now}, updated_at=${input.now},
      revision=revision+1, last_attempt_id=${input.ctx.attemptId},
      playlist_id=NULL, playlist_revision=NULL,
      cursor_position=NULL, cursor_track_id=NULL,
      attempt_id=NULL, lease_until=NULL,
      dispatch_state='none', next_dispatch_at=NULL, dispatched_at=NULL
    WHERE playlist_id=${input.playlistId}
      AND (${input.ctx.fence}) AND (${input.liveGuard}) AND (${input.parentWinner})`),
]
