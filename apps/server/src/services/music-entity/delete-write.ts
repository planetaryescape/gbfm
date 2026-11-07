import { type SQL, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Database } from '@/db/layer'

import { type MusicParent, musicParentCas, musicParentWinner } from './guarded-statements'
import {
  executeMusicWrite,
  MusicWriteError,
  MusicWriteIntent,
  type MusicWriteRequest,
} from './write-intent'

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

interface DeleteFanout {
  readonly table: string
  readonly selected: SQL
  readonly assignments: ReadonlyArray<SQL>
}

/** Selections run against current junctions inside the atomic batch, not a
 * preflight ID list that could miss a concurrently added relationship.
 */
const deletionFanout = (target: MusicParent): ReadonlyArray<DeleteFanout> => {
  const fanout: Array<DeleteFanout> = []
  const id = target.entityId

  if (target.entityType === 'artist') {
    for (const type of ['album', 'track'] as const) {
      const junction = sql.identifier(
        type === 'album' ? 'music_album_artists' : 'music_track_artists',
      )

      const parentColumn = sql.identifier(type === 'album' ? 'albumId' : 'trackId')
      fanout.push({
        table: tables[type],
        selected: sql`EXISTS (SELECT 1 FROM ${junction} c WHERE c.${parentColumn}=p.id AND c.artistId=${id})`,
        assignments: [
          sql`artistNames=(SELECT json_group_array(name) FROM (
          SELECT a.name FROM ${junction} c JOIN music_artists a ON a.id=c.artistId
          WHERE c.${parentColumn}=p.id AND c.artistId<>${id} ORDER BY c.displayOrder,c.artistId))`,
        ],
      })
    }
  }

  if (target.entityType === 'artist' || target.entityType === 'album') {
    const junction = sql.identifier(
      target.entityType === 'artist' ? 'music_label_artists' : 'music_label_albums',
    )

    const parentColumn = sql.identifier(target.entityType === 'artist' ? 'artist_id' : 'album_id')
    fanout.push({
      table: tables.label,
      selected: sql`EXISTS (SELECT 1 FROM ${junction} c WHERE c.label_id=p.id AND c.${parentColumn}=${id})`,
      assignments: [],
    })
  }

  if (target.entityType === 'album')
    fanout.push({
      table: tables.track,
      selected: sql`p.albumId=${id}`,
      assignments: [sql`albumId=NULL`],
    })

  if (target.entityType === 'track')
    fanout.push({
      table: 'music_playlists',
      selected: sql`EXISTS (SELECT 1 FROM music_playlist_tracks c WHERE c.playlistId=p.id AND c.trackId=${id})`,
      assignments: [],
    })

  if (target.entityType === 'label') {
    for (const type of ['artist', 'album'] as const) {
      const junction = sql.identifier(
        type === 'artist' ? 'music_label_artists' : 'music_label_albums',
      )

      const parentColumn = sql.identifier(type === 'artist' ? 'artist_id' : 'album_id')
      fanout.push({
        table: tables[type],
        selected: sql`EXISTS (SELECT 1 FROM ${junction} c WHERE c.${parentColumn}=p.id AND c.label_id=${id})`,
        assignments: [],
      })
    }
  }

  return fanout
}

/** Existing hard deletion, with one winning receipt/authority batch. Restricting
 * foreign keys remain restrictions: this does not erase recording-credit facts
 * or detach authored post/release references to force a deletion through.
 */
export const deleteMusicEntity = Effect.fn('musicEntity.delete')(function* (
  target: MusicParent,
  write?: MusicWriteRequest,
) {
  if (!write)
    return yield* new MusicWriteError({
      code: 'precondition_required',
      message: 'An observed revision and request ID are required.',
    })

  const db = yield* Database
  const table = sql.identifier(tables[target.entityType])
  const fanout = deletionFanout(target)

  return yield* executeMusicWrite(write.intent, write.context, {
    operation: `delete_music_${target.entityType}`,
    target,
    disclosure: 'deleted',
    normalizedInput: null,
    prepare: Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => db.get(sql`SELECT revision FROM ${table} WHERE id=${target.entityId}`),
        catch: () =>
          new MusicWriteError({
            code: 'unavailable',
            message: 'Deletion preparation unavailable.',
          }),
      })

      if (!raw)
        return yield* new MusicWriteError({ code: 'not_found', message: 'Music entity not found.' })

      const current = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          revision: MusicWriteIntent.fields.expectedRevision,
        }),
      )(raw).pipe(
        Effect.mapError(
          () =>
            new MusicWriteError({
              code: 'unavailable',
              message: 'Music entity state unavailable.',
            }),
        ),
      )

      if (current.revision !== write.intent.expectedRevision)
        return yield* new MusicWriteError({ code: 'conflict', message: 'Music revision changed.' })

      return {
        build: (attempt) => {
          const winner = sql`(${attempt.fence}) AND (${attempt.liveGuard}) AND (${musicParentWinner(target, attempt.attemptId)})`

          const eligibility = [
            sql`1`,
            ...fanout.map(
              (parent) =>
                sql`NOT EXISTS (SELECT 1 FROM ${sql.identifier(parent.table)} p
            WHERE (${parent.selected}) AND p.revision>=${Number.MAX_SAFE_INTEGER})`,
            ),
          ]

          if (target.entityType === 'artist')
            eligibility.push(sql`NOT EXISTS (
          SELECT 1 FROM music_recording_credits WHERE artist_id=${target.entityId})`)

          return {
            statements: [
              attempt.prepare(
                musicParentCas({
                  target,
                  expectedRevision: write.intent.expectedRevision,
                  // No new root revision survives deletion; still acquire the exact
                  // observed root and stamp this physical attempt before any fanout.
                  changed: false,
                  attemptId: attempt.attemptId,
                  fence: attempt.fence,
                  liveGuard: attempt.liveGuard,
                  assignments: [],
                  eligibility: sql.join(
                    eligibility.map((predicate) => sql`(${predicate})`),
                    sql` AND `,
                  ),
                }),
              ),
              ...fanout.map((parent) =>
                attempt.prepare(sql`UPDATE ${sql.identifier(parent.table)} AS p
              SET ${sql.join(
                [
                  ...parent.assignments,
                  sql`revision=CASE WHEN revision<${Number.MAX_SAFE_INTEGER} THEN revision+1 ELSE NULL END`,
                  sql`last_operation_id=${attempt.attemptId}`,
                ],
                sql`, `,
              )} WHERE (${winner}) AND (${parent.selected})`),
              ),
              attempt.prepare(sql`DELETE FROM music_entity_links WHERE entity_type=${target.entityType}
              AND entityId=${target.entityId} AND (${winner})`),
              attempt.prepare(sql`DELETE FROM entity_labels WHERE entity_type=${target.entityType === 'label' ? 'musicLabel' : target.entityType}
              AND entity_id=${target.entityId} AND (${winner})`),
              ...(target.entityType === 'label'
                ? []
                : [
                    attempt.prepare(sql`DELETE FROM music_source_identities
              WHERE entity_type=${target.entityType} AND entity_id=${target.entityId} AND (${winner})`),
                  ]),
              // Common-store CHECK proves the physical winner BEFORE its evidence
              // disappears. This statement never writes receipts from domain SQL.
              attempt.assert(winner),
              attempt.prepare(
                sql`DELETE FROM ${table} WHERE id=${target.entityId} AND (${winner})`,
              ),
            ],
            assertApplied: sql`(${attempt.fence}) AND (${attempt.liveGuard})
            AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id=${target.entityId})`,
            outcome: { result: null, revision: null, access: { ...target, deleted: true } },
          }
        },
      }
    }),
  })
})
