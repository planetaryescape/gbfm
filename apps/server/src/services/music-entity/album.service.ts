import { asc, desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { projectEntityLabels, projectEntityLabelsForRows, replaceEntityLabels } from '@/db/labels'
import { Database } from '@/db/layer'
import { musicAlbumArtistsTable, musicAlbumsTable } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { toSlug } from '@/services/to-slug'

import { insertMusicEntity } from './create-statements'
import {
  deleteEntityLabels,
  deleteIdentitiesForEntity,
  deleteLinksForEntity,
  requireOne,
} from './shared'

export interface CreateAlbumInput {
  title: string
  artistNames?: Array<string> | null
  artistIds?: Array<string>
  releaseDate?: Date | null
  coverImageUrl?: string | null
  genres?: Array<string> | null
  albumType?: string | null
  slug: string
  publishedAt?: Date | null
  createdById?: string | null
}

export const createAlbumEffect = Effect.fn('musicEntity.createAlbum')(function* (
  data: CreateAlbumInput,
) {
  const db = yield* Database
  const id = crypto.randomUUID()

  const rows = yield* Effect.tryPromise({
    try: async () => {
      await insertMusicEntity(db, { entityType: 'album', data }, id)

      const rows = await db
        .select()
        .from(musicAlbumsTable)
        .where(eq(musicAlbumsTable.id, id))
        .limit(1)

      const album = rows[0]

      if (!album) throw new Error('Insert returned no rows')

      return album
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to create album: ${getErrorMessage(e)}`,
        operation: 'insert',
        table: 'music_albums',
      }),
  })

  const { genres: projectedGenres } = yield* Effect.tryPromise({
    try: () => projectEntityLabels(db, 'album', rows),
    catch: (e) =>
      new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
  })

  return { ...rows, genres: projectedGenres }
})

export const getAlbumsEffect = Effect.gen(function* () {
  const db = yield* Database

  return yield* Effect.tryPromise({
    try: async () => {
      const albums = await db
        .select()
        .from(musicAlbumsTable)
        .orderBy(desc(musicAlbumsTable.createdAt), asc(musicAlbumsTable.id))

      const projected = await projectEntityLabelsForRows(db, 'album', albums)

      return projected.map(({ tags: _tags, genres, ...album }) => ({ ...album, genres }))
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to list albums: ${getErrorMessage(e)}`,
        operation: 'select',
        table: 'music_albums',
      }),
  })
}).pipe(Effect.withSpan('musicEntity.getAlbums'))

export const getAlbumByIdEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(musicAlbumsTable).where(eq(musicAlbumsTable.id, id)).limit(1),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to get album: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_albums',
        }),
    })

    const album = yield* requireOne(rows, 'MusicAlbum', id)

    const { genres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'album', album),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...album, genres }
  }).pipe(Effect.withSpan('musicEntity.getAlbumById', { attributes: { id } }))

export const updateAlbumEffect = (id: string, data: Partial<CreateAlbumInput>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { artistIds, genres, ...albumData } = data

    if (albumData.title && !albumData.slug) {
      albumData.slug = toSlug(albumData.title)
    }

    const rows = yield* Effect.tryPromise({
      try: async () => {
        await db.batch([
          db
            .update(musicAlbumsTable)
            .set({ ...albumData, updatedAt: new Date() })
            .where(eq(musicAlbumsTable.id, id)),
          ...(artistIds?.length
            ? [
                db
                  .insert(musicAlbumArtistsTable)
                  .values(
                    artistIds.map((artistId, displayOrder) => ({
                      albumId: id,
                      artistId,
                      displayOrder,
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [musicAlbumArtistsTable.albumId, musicAlbumArtistsTable.artistId],
                    set: { displayOrder: sql`excluded.displayOrder` },
                  }),
              ]
            : []),
        ])

        const rows = await db
          .select()
          .from(musicAlbumsTable)
          .where(eq(musicAlbumsTable.id, id))
          .limit(1)

        const album = rows[0]

        if (!album) throw new Error('Album not found')

        if (genres !== undefined) await replaceEntityLabels(db, 'album', album.id, { genres })

        return album
      },
      catch: (e) =>
        new DatabaseError({
          message: `Failed to update album: ${getErrorMessage(e)}`,
          operation: 'update',
          table: 'music_albums',
        }),
    })

    const { genres: projectedGenres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'album', rows),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...rows, genres: projectedGenres }
  }).pipe(Effect.withSpan('musicEntity.updateAlbum', { attributes: { id } }))

export const deleteAlbumEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        (async () => {
          const [, , , rows] = await db.batch([
            deleteIdentitiesForEntity(db, 'album', id),
            deleteLinksForEntity(db, 'album', id),
            deleteEntityLabels(db, 'album', id),
            db
              .delete(musicAlbumsTable)
              .where(eq(musicAlbumsTable.id, id))
              .returning({ id: musicAlbumsTable.id }),
          ])

          return rows
        })(),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to delete album: ${getErrorMessage(e)}`,
          operation: 'delete',
          table: 'music_albums',
        }),
    })

    yield* requireOne(rows, 'MusicAlbum', id)
  }).pipe(Effect.withSpan('musicEntity.deleteAlbum', { attributes: { id } }))

export const addArtistToAlbumEffect = (
  albumId: string,
  artistId: string,
  opts?: { role?: string; displayOrder?: number },
) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(musicAlbumArtistsTable)
          .values({
            albumId,
            artistId,
            role: opts?.role,
            displayOrder: opts?.displayOrder ?? 0,
          })
          .onConflictDoUpdate({
            target: [musicAlbumArtistsTable.albumId, musicAlbumArtistsTable.artistId],
            set: { role: opts?.role, displayOrder: opts?.displayOrder ?? 0 },
          }),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to add artist to album: ${getErrorMessage(e)}`,
          operation: 'insert',
          table: 'music_album_artists',
        }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.addArtistToAlbum', {
      attributes: { albumId, artistId },
    }),
  )

export const removeArtistFromAlbumEffect = (albumId: string, artistId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.tryPromise({
      try: () =>
        db
          .delete(musicAlbumArtistsTable)
          .where(
            eq(musicAlbumArtistsTable.albumId, albumId) &&
              eq(musicAlbumArtistsTable.artistId, artistId),
          ),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to remove artist from album: ${getErrorMessage(e)}`,
          operation: 'delete',
          table: 'music_album_artists',
        }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.removeArtistFromAlbum', {
      attributes: { albumId, artistId },
    }),
  )
