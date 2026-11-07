import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { type SQL, sql } from 'drizzle-orm'

import { musicArtistAliasesTable } from '@/db/music-credit.schema'
import { musicFactNameKey } from '@/services/music-entity/name-key'

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

export interface MusicParent {
  readonly entityType: keyof typeof tables
  readonly entityId: string
}

export const musicParentGuard = (target: MusicParent, expectedRevision: number): SQL =>
  sql`EXISTS (SELECT 1 FROM ${sql.identifier(tables[target.entityType])}
    WHERE id=${target.entityId} AND revision=${expectedRevision})`

export const musicParentWinner = (target: MusicParent, attemptId: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${sql.identifier(tables[target.entityType])}
    WHERE id=${target.entityId} AND last_operation_id=${attemptId})`

/** Shared root CAS for M1 edits and M2 facts. Build only inside the common store
 * after replay lookup. Eligibility includes the caller's fresh version-token
 * comparison and domain predicates; authority and physical receipt fence stay
 * explicit. Coupled statements must still check musicParentWinner + both guards.
 */
export const musicParentCas = (input: {
  readonly target: MusicParent
  readonly expectedRevision: number
  readonly changed: boolean
  readonly attemptId: string
  readonly fence: SQL
  readonly liveGuard: SQL
  readonly eligibility: SQL
  readonly assignments: ReadonlyArray<SQL>
}): SQL => sql`UPDATE ${sql.identifier(tables[input.target.entityType])}
  SET ${sql.join(
    [
      ...input.assignments,
      sql`revision=revision+${input.changed ? 1 : 0}`,
      sql`last_operation_id=${input.attemptId}`,
    ],
    sql`, `,
  )}
  WHERE id=${input.target.entityId} AND revision=${input.expectedRevision}
  AND (${input.fence}) AND (${input.liveGuard}) AND (${input.eligibility})
  ${input.changed ? sql`AND revision<${Number.MAX_SAFE_INTEGER}` : sql``}`

// A primary-name change never silently removes an alias to resolve a collision.
export const artistPrimaryNameAvailable = (artistId: string, name: string): SQL => sql`
  NOT EXISTS (SELECT 1 FROM ${musicArtistAliasesTable}
    WHERE ${musicArtistAliasesTable.artistId}=${artistId}
    AND ${musicArtistAliasesTable.nameKey}=${musicFactNameKey(name)})`

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
  const winner = sql`(${input.fence}) AND EXISTS (
    SELECT 1 FROM music_artists WHERE id = ${input.artistId}
    AND last_operation_id = ${input.attemptId})`

  return [
    input.prepare(sql`UPDATE music_albums SET
      artistNames = (SELECT json_group_array(name) FROM (
        SELECT a.name FROM music_album_artists c JOIN music_artists a ON a.id = c.artistId
        WHERE c.albumId = music_albums.id ORDER BY c.displayOrder, c.artistId)),
      revision = CASE WHEN revision<${Number.MAX_SAFE_INTEGER} THEN revision+1 ELSE NULL END,
      last_operation_id = ${input.attemptId}
      WHERE (${winner}) AND EXISTS (
        SELECT 1 FROM music_album_artists c
        WHERE c.albumId = music_albums.id AND c.artistId = ${input.artistId})`),
    input.prepare(sql`UPDATE music_tracks SET
      artistNames = (SELECT json_group_array(name) FROM (
        SELECT a.name FROM music_track_artists c JOIN music_artists a ON a.id = c.artistId
        WHERE c.trackId = music_tracks.id ORDER BY c.displayOrder, c.artistId)),
      revision = CASE WHEN revision<${Number.MAX_SAFE_INTEGER} THEN revision+1 ELSE NULL END,
      last_operation_id = ${input.attemptId}
      WHERE (${winner}) AND EXISTS (
        SELECT 1 FROM music_track_artists c
        WHERE c.trackId = music_tracks.id AND c.artistId = ${input.artistId})`),
  ]
}
