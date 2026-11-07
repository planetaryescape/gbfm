import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database } from '@/db/layer'
import { musicTrackArtistsTable, musicTracksTable } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { toSlug } from '@/services/to-slug'

import { insertMusicEntity } from './create-statements'
import { deleteMusicEntity } from './delete-write'
import { requireOne } from './shared'
import type { MusicWriteRequest } from './write-intent'

export interface CreateTrackInput {
  title: string
  artistNames?: Array<string> | null
  artistIds?: Array<string>
  coverImageUrl?: string | null
  albumId?: string | null
  trackNumber?: number | null
  slug: string
  publishedAt?: Date | null
  createdById?: string | null
}

export const createTrackEffect = Effect.fn('musicEntity.createTrack')(function* (
  data: CreateTrackInput,
) {
  const db = yield* Database
  const id = crypto.randomUUID()

  const rows = yield* Effect.tryPromise({
    try: async () => {
      await insertMusicEntity(db, { entityType: 'track', data }, id)

      const rows = await db
        .select()
        .from(musicTracksTable)
        .where(eq(musicTracksTable.id, id))
        .limit(1)

      const track = rows[0]

      if (!track) throw new Error('Insert returned no rows')

      return track
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to create track: ${getErrorMessage(e)}`,
        operation: 'insert',
        table: 'music_tracks',
      }),
  })

  return rows
})

export const getTracksEffect = Effect.gen(function* () {
  const db = yield* Database

  return yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(musicTracksTable)
        .orderBy(desc(musicTracksTable.createdAt), asc(musicTracksTable.id)),
    catch: (e) =>
      new DatabaseError({
        message: `Failed to list tracks: ${getErrorMessage(e)}`,
        operation: 'select',
        table: 'music_tracks',
      }),
  })
}).pipe(Effect.withSpan('musicEntity.getTracks'))

export const getTrackByIdEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(musicTracksTable).where(eq(musicTracksTable.id, id)).limit(1),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to get track: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_tracks',
        }),
    })

    return yield* requireOne(rows, 'MusicTrack', id)
  }).pipe(Effect.withSpan('musicEntity.getTrackById', { attributes: { id } }))

export const updateTrackEffect = (id: string, data: Partial<CreateTrackInput>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { artistIds, ...trackData } = data

    if (trackData.title && !trackData.slug) {
      trackData.slug = toSlug(trackData.title)
    }

    const rows = yield* Effect.tryPromise({
      try: async () => {
        await db.batch([
          db
            .update(musicTracksTable)
            .set({ ...trackData, updatedAt: new Date() })
            .where(eq(musicTracksTable.id, id)),
          ...(artistIds?.length
            ? [
                db
                  .insert(musicTrackArtistsTable)
                  .values(
                    artistIds.map((artistId, displayOrder) => ({
                      trackId: id,
                      artistId,
                      displayOrder,
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [musicTrackArtistsTable.trackId, musicTrackArtistsTable.artistId],
                    set: { displayOrder: sql`excluded.displayOrder` },
                  }),
              ]
            : []),
        ])

        const rows = await db
          .select()
          .from(musicTracksTable)
          .where(eq(musicTracksTable.id, id))
          .limit(1)

        const track = rows[0]

        if (!track) throw new Error('Track not found')

        return track
      },
      catch: (e) =>
        new DatabaseError({
          message: `Failed to update track: ${getErrorMessage(e)}`,
          operation: 'update',
          table: 'music_tracks',
        }),
    })

    return rows
  }).pipe(Effect.withSpan('musicEntity.updateTrack', { attributes: { id } }))

export const deleteTrackEffect = (id: string, write?: MusicWriteRequest) =>
  deleteMusicEntity({ entityType: 'track', entityId: id }, write)

export const addArtistToTrackEffect = (
  trackId: string,
  artistId: string,
  opts?: { role?: string; displayOrder?: number },
) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(musicTrackArtistsTable)
          .values({
            trackId,
            artistId,
            role: opts?.role,
            displayOrder: opts?.displayOrder ?? 0,
          })
          .onConflictDoUpdate({
            target: [musicTrackArtistsTable.trackId, musicTrackArtistsTable.artistId],
            set: { role: opts?.role, displayOrder: opts?.displayOrder ?? 0 },
          }),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to add artist to track: ${getErrorMessage(e)}`,
          operation: 'insert',
          table: 'music_track_artists',
        }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.addArtistToTrack', {
      attributes: { trackId, artistId },
    }),
  )

export const removeArtistFromTrackEffect = (trackId: string, artistId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.tryPromise({
      try: () =>
        db
          .delete(musicTrackArtistsTable)
          .where(
            and(
              eq(musicTrackArtistsTable.trackId, trackId),
              eq(musicTrackArtistsTable.artistId, artistId),
            ),
          ),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to remove artist from track: ${getErrorMessage(e)}`,
          operation: 'delete',
          table: 'music_track_artists',
        }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.removeArtistFromTrack', {
      attributes: { trackId, artistId },
    }),
  )
