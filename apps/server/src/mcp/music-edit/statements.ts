import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { type SQL, sql } from 'drizzle-orm'

import {
  musicParentCas,
  musicParentGuard,
  musicParentWinner,
} from '@/services/music-entity/guarded-statements'

export {
  type MusicParent,
  musicParentCas,
  musicParentGuard,
  musicParentWinner,
} from '@/services/music-entity/guarded-statements'

import {
  artistNameFanoutCapacity,
  artistNameFanoutStatements,
  artistPrimaryNameAvailable,
} from './artist-fanout'
import type { MusicEditCommand } from './commands'
import { musicEditTarget } from './planner'

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

/** Domain statements for the single shared operations executor. This function
 * does not execute or store receipts. Inputs are a decoded exact command and its
 * observed plan; eligibility includes live authority and alias collision guards.
 * Every coupled statement needs both the receipt fence and the winning artist/
 * parent attempt marker, never changes() or a reusable request-key marker.
 */
export const musicEditStatements = (input: {
  readonly command: MusicEditCommand
  readonly changed: boolean
  readonly artistNameChanged: boolean
  readonly eligibility: SQL
  readonly liveGuard: SQL
  readonly now: number
  readonly attemptId: string
  readonly fence: SQL
  readonly prepare: (statement: SQL) => D1PreparedStatement
}) => {
  const { command, prepare, attemptId, fence } = input
  const change = command.change
  const target = musicEditTarget(change)
  const table = sql.identifier(tables[target.entityType])

  const referenceGuards = command.references.map((reference) =>
    musicParentGuard(reference, reference.expectedRevision),
  )

  const capacityGuards: Array<SQL> = []

  if (
    input.changed &&
    (change.operation === 'set_label_affiliation' ||
      change.operation === 'remove_label_affiliation')
  ) {
    capacityGuards.push(sql`EXISTS (SELECT 1 FROM music_labels
      WHERE id=${change.labelId} AND revision<${Number.MAX_SAFE_INTEGER})`)
  }

  if (input.artistNameChanged) capacityGuards.push(artistNameFanoutCapacity(target.entityId))

  if (
    change.operation === 'update_music_metadata' &&
    change.entityType === 'artist' &&
    change.metadata.name !== undefined
  ) {
    capacityGuards.push(artistPrimaryNameAvailable(target.entityId, change.metadata.name))
  }

  const assignments: Array<SQL> = []

  if (input.changed) {
    assignments.push(
      sql`${sql.identifier(target.entityType === 'label' ? 'updated_at' : 'updatedAt')}=${input.now}`,
    )
  }

  switch (change.operation) {
    case 'update_music_metadata':
      for (const [key, value] of Object.entries(change.metadata)) {
        assignments.push(
          sql`${sql.identifier(key)}=${key === 'releaseDate' && value !== null ? new Date(String(value)).getTime() : value}`,
        )
      }

      break
    case 'set_album_type':
      assignments.push(sql`albumType=${change.albumType}`)
      break
    case 'set_track_album':
      assignments.push(sql`albumId=${change.albumId}`)
      break
  }

  const winner = sql`(${fence}) AND (${input.liveGuard}) AND (${musicParentWinner(target, attemptId)})`

  const statements = [
    prepare(
      musicParentCas({
        target,
        expectedRevision: command.expectedRevision,
        changed: input.changed,
        attemptId,
        fence,
        liveGuard: input.liveGuard,
        assignments,
        eligibility: sql`(${input.eligibility})
      ${capacityGuards.length ? sql`AND ${sql.join(capacityGuards, sql` AND `)}` : sql``}
      ${referenceGuards.length ? sql`AND ${sql.join(referenceGuards, sql` AND `)}` : sql``}`,
      }),
    ),
  ]

  switch (change.operation) {
    case 'set_music_genres': {
      const entityType = target.entityType === 'label' ? 'musicLabel' : target.entityType

      if (!input.changed) break
      statements.push(
        prepare(sql`DELETE FROM entity_labels WHERE entity_type=${entityType}
          AND entity_id=${target.entityId} AND label_id IN (SELECT id FROM labels WHERE kind='genre')
          AND ${winner}`),
      )

      for (const [position, name] of change.genres.entries()) {
        statements.push(
          prepare(sql`INSERT INTO labels (id,kind,name)
            SELECT lower(hex(randomblob(16))),'genre',${name} WHERE ${winner}
            ON CONFLICT(kind,name) DO NOTHING`),
          prepare(sql`INSERT INTO entity_labels (entity_type,entity_id,position,label_id)
            SELECT ${entityType},${target.entityId},${position},id FROM labels
            WHERE kind='genre' AND name=${name} AND ${winner}`),
        )
      }

      break
    }

    case 'set_artist_credit':
    case 'remove_artist_credit': {
      if (!input.changed) break

      const creditTable = sql.identifier(
        change.entityType === 'album' ? 'music_album_artists' : 'music_track_artists',
      )

      const parentColumn = sql.identifier(change.entityType === 'album' ? 'albumId' : 'trackId')

      if (change.operation === 'remove_artist_credit') {
        statements.push(
          prepare(sql`DELETE FROM ${creditTable} WHERE ${parentColumn}=${target.entityId}
            AND artistId=${change.artistId} AND ${winner}`),
        )
      } else {
        statements.push(
          prepare(sql`INSERT INTO ${creditTable} (${parentColumn},artistId,role,displayOrder)
            SELECT ${target.entityId},${change.artistId},${change.role},${change.displayOrder}
            WHERE ${winner} ON CONFLICT(${parentColumn},artistId) DO UPDATE
            SET role=excluded.role,displayOrder=excluded.displayOrder WHERE ${winner}`),
        )
      }

      statements.push(
        prepare(sql`UPDATE ${table} SET artistNames=(SELECT json_group_array(name) FROM (
          SELECT a.name FROM ${creditTable} c JOIN music_artists a ON a.id=c.artistId
          WHERE c.${parentColumn}=${target.entityId} ORDER BY c.displayOrder,c.artistId))
          WHERE id=${target.entityId} AND ${winner}`),
      )
      break
    }

    case 'set_label_affiliation':
    case 'remove_label_affiliation': {
      if (!input.changed) break

      const junction = sql.identifier(
        change.entityType === 'artist' ? 'music_label_artists' : 'music_label_albums',
      )

      const parent = sql.identifier(change.entityType === 'artist' ? 'artist_id' : 'album_id')
      statements.push(
        prepare(
          change.operation === 'set_label_affiliation'
            ? sql`INSERT INTO ${junction} (label_id,${parent})
              SELECT ${change.labelId},${target.entityId} WHERE ${winner} ON CONFLICT DO NOTHING`
            : sql`DELETE FROM ${junction} WHERE label_id=${change.labelId}
              AND ${parent}=${target.entityId} AND ${winner}`,
        ),
        prepare(sql`UPDATE music_labels SET revision=revision+1,last_operation_id=${attemptId},
          updated_at=${input.now} WHERE id=${change.labelId} AND ${winner}`),
      )
      break
    }
  }

  if (input.artistNameChanged) {
    statements.push(
      ...artistNameFanoutStatements({
        prepare,
        artistId: target.entityId,
        attemptId,
        fence: sql`(${fence}) AND (${input.liveGuard})`,
      }),
    )
  }

  return { statements, assertApplied: winner }
}
