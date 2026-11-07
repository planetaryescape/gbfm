import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { type SQL, sql } from 'drizzle-orm'

// Include in the artist CAS eligibility, before changing its name or revision.
export const artistNameFanoutCapacity = (artistId: string): SQL => sql`
  NOT EXISTS (SELECT 1 FROM music_albums p JOIN music_album_artists c ON c.albumId=p.id
    WHERE c.artistId=${artistId} AND p.revision>=${Number.MAX_SAFE_INTEGER})
  AND NOT EXISTS (SELECT 1 FROM music_tracks p JOIN music_track_artists c ON c.trackId=p.id
    WHERE c.artistId=${artistId} AND p.revision>=${Number.MAX_SAFE_INTEGER})`

/** Append after the guarded artist rename and before the common receipt outcome.
 * The artist CAS must set last_operation_id to this physical attempt, not the
 * reusable scoped operation digest. No private alias facts are removed: M2 alias
 * observations bind to the artist revision already advanced by that CAS.
 */
export const artistNameFanoutStatements = (input: {
  readonly prepare: (statement: SQL) => D1PreparedStatement
  readonly artistId: string
  readonly attemptId: string
  readonly fence: SQL
}): ReadonlyArray<D1PreparedStatement> => {
  const winner = sql`${input.fence} AND EXISTS (
    SELECT 1 FROM music_artists WHERE id = ${input.artistId}
    AND last_operation_id = ${input.attemptId})`

  return [
    input.prepare(sql`UPDATE music_albums SET
      artistNames = (SELECT json_group_array(name) FROM (
        SELECT a.name FROM music_album_artists c JOIN music_artists a ON a.id = c.artistId
        WHERE c.albumId = music_albums.id ORDER BY c.displayOrder, c.artistId)),
      revision = CASE WHEN revision<${Number.MAX_SAFE_INTEGER} THEN revision+1 ELSE NULL END,
      last_operation_id = ${input.attemptId}
      WHERE ${winner} AND EXISTS (
        SELECT 1 FROM music_album_artists c
        WHERE c.albumId = music_albums.id AND c.artistId = ${input.artistId})`),
    input.prepare(sql`UPDATE music_tracks SET
      artistNames = (SELECT json_group_array(name) FROM (
        SELECT a.name FROM music_track_artists c JOIN music_artists a ON a.id = c.artistId
        WHERE c.trackId = music_tracks.id ORDER BY c.displayOrder, c.artistId)),
      revision = CASE WHEN revision<${Number.MAX_SAFE_INTEGER} THEN revision+1 ELSE NULL END,
      last_operation_id = ${input.attemptId}
      WHERE ${winner} AND EXISTS (
        SELECT 1 FROM music_track_artists c
        WHERE c.trackId = music_tracks.id AND c.artistId = ${input.artistId})`),
  ]
}
