import { sql, type SQL } from 'drizzle-orm'

import type {
  musicArtistAliasesTable,
  musicRecordingCreditsTable,
} from '../../db/music-credit.schema'
import type { OperationContext } from '../operations/store'
import type { SetRecordingCreditsInput } from './contract'

/** Coupled credit writes run only after the caller's live-authorized parent CAS wins.
 * The caller supplies the physical parent winner predicate, not a request-key marker.
 * Rows contain exact preallocated IDs/timestamps used by response-budget preflight.
 */
export const recordingCreditStatements = (
  context: OperationContext,
  winner: SQL,
  target: typeof SetRecordingCreditsInput.Type.target,
  rows: ReadonlyArray<typeof musicRecordingCreditsTable.$inferSelect>,
) => {
  const guard = sql`(${context.fence}) AND (${winner})`
  const column = sql.identifier(target.type === 'track' ? 'track_id' : 'album_id')

  const statements = [
    context.prepare(
      sql`DELETE FROM music_recording_credits WHERE ${column}=${target.id} AND ${guard}`,
    ),
  ]

  for (const row of rows) {
    statements.push(
      context.prepare(sql`INSERT INTO music_recording_credits (
      id,track_id,album_id,artist_id,credited_name,credited_name_key,role,instrument,instrument_key,
      participant_key,display_order,source_label,source_url,evidence_note,asserted_by_id,asserted_at,created_at
    ) SELECT ${row.id},${target.type === 'track' ? target.id : null},${target.type === 'album' ? target.id : null},
      ${row.artistId},${row.creditedName},${row.creditedNameKey},${row.role},${row.instrument},${row.instrumentKey},
      ${row.participantKey},${row.displayOrder},${row.sourceLabel},${row.sourceUrl},${row.evidenceNote},
      ${row.assertedById},${row.assertedAt.getTime()},${row.createdAt.getTime()} WHERE ${guard}`),
    )
  }

  return statements
}

/** Replace only one artist's alternate names inside the same winning operation batch.
 * Primary-name collision checks and artist CAS belong to the caller's guarded root.
 */
export const artistAliasStatements = (
  context: OperationContext,
  winner: SQL,
  artistId: string,
  rows: ReadonlyArray<typeof musicArtistAliasesTable.$inferSelect>,
) => {
  const guard = sql`(${context.fence}) AND (${winner})`

  const statements = [
    context.prepare(sql`DELETE FROM music_artist_aliases WHERE artist_id=${artistId} AND ${guard}`),
  ]

  for (const row of rows) {
    statements.push(
      context.prepare(sql`INSERT INTO music_artist_aliases (
      id,artist_id,name,name_key,source_label,source_url,evidence_note,asserted_by_id,asserted_at,created_at
    ) SELECT ${row.id},${artistId},${row.name},${row.nameKey},${row.sourceLabel},${row.sourceUrl},
      ${row.evidenceNote},${row.assertedById},${row.assertedAt.getTime()},${row.createdAt.getTime()} WHERE ${guard}`),
    )
  }

  return statements
}
