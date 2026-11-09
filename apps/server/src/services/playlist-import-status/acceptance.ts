import { sql } from 'drizzle-orm'

import type { CommandCheckpoint } from '@/mcp/command-authority'
import type { OperationContext } from '@/mcp/operations/store'

/** Attach specialized importing state to the SAME pending receipt. The caller's
 * final assertion must prove this status's physical marker. Acceptance is not a
 * created playlist, provider success or queue delivery. No source data is stored.
 * Call only after the owning orchestration has admitted its provider operation.
 */
export const playlistImportAcceptanceStatement = (input: {
  readonly ctx: OperationContext
  readonly authority: CommandCheckpoint
}) => {
  const { ctx, authority } = input
  const now = sql`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

  return ctx.prepare(sql`INSERT INTO playlist_import_statuses
    (operation_id,actor_id,client_id,resource,phase,created_at,updated_at,
      last_attempt_id,attempt_id,generation,lease_until)
    SELECT ${ctx.operationId},${authority.actorId},${authority.clientId},${authority.resource},
      'importing',${now},${now},${ctx.attemptId},${ctx.attemptId},1,${now}+60000
    WHERE (${ctx.fence}) AND (${authority.liveGuard})
      AND EXISTS (SELECT 1 FROM mcp_operations WHERE id=${ctx.operationId}
        AND actor_id=${authority.actorId} AND client_id=${authority.clientId})`)
}
