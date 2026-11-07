import { asc, desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { projectEntityLabels, projectEntityLabelsForRows, replaceEntityLabels } from '@/db/labels'
import { Database } from '@/db/layer'
import { musicArtistsTable, type SelectMusicArtist } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { omitUndefined } from '@/lib/omit-undefined'
import { toSlug } from '@/services/to-slug'

import { insertMusicEntity } from './create-statements'
import {
  deleteEntityLabels,
  deleteIdentitiesForEntity,
  deleteLinksForEntity,
  requireInserted,
  requireOne,
} from './shared'

export interface CreateArtistInput {
  name: string
  bio?: string | null
  imageUrl?: string | null
  genres?: Array<string> | null
  slug: string
  publishedAt?: Date | null
  createdById?: string | null
}

export const createArtistEffect = Effect.fn('musicEntity.createArtist')(function* (
  data: CreateArtistInput,
) {
  const db = yield* Database
  const id = crypto.randomUUID()

  const rows = yield* Effect.tryPromise({
    try: async () => {
      await insertMusicEntity(db, { entityType: 'artist', data }, id)

      return db.select().from(musicArtistsTable).where(eq(musicArtistsTable.id, id)).limit(1)
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to create artist: ${getErrorMessage(e)}`,
        operation: 'insert',
        table: 'music_artists',
      }),
  })

  const artist = yield* requireInserted(rows, 'music_artists')

  const { genres: projectedGenres } = yield* Effect.tryPromise({
    try: () => projectEntityLabels(db, 'artist', artist),
    catch: (e) =>
      new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
  })

  return { ...artist, genres: projectedGenres }
})

export const getArtistsEffect = Effect.gen(function* () {
  const db = yield* Database

  return yield* Effect.tryPromise({
    try: async () => {
      const artists = await db
        .select()
        .from(musicArtistsTable)
        .orderBy(desc(musicArtistsTable.createdAt), asc(musicArtistsTable.id))

      const projected = await projectEntityLabelsForRows(db, 'artist', artists)

      return projected.map(({ tags: _tags, genres, ...artist }) => ({ ...artist, genres }))
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to list artists: ${getErrorMessage(e)}`,
        operation: 'select',
        table: 'music_artists',
      }),
  })
}).pipe(Effect.withSpan('musicEntity.getArtists'))

export const getArtistByIdEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(musicArtistsTable).where(eq(musicArtistsTable.id, id)).limit(1),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to get artist: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_artists',
        }),
    })

    const artist = yield* requireOne(rows, 'MusicArtist', id)

    const { genres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'artist', artist),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...artist, genres }
  }).pipe(Effect.withSpan('musicEntity.getArtistById', { attributes: { id } }))

export const updateArtistEffect = (id: string, data: Partial<CreateArtistInput>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { genres, ...updateData } = data

    if (updateData.name && !updateData.slug) {
      updateData.slug = toSlug(updateData.name)
    }

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicArtistsTable)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(musicArtistsTable.id, id))
          .returning(),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to update artist: ${getErrorMessage(e)}`,
          operation: 'update',
          table: 'music_artists',
        }),
    })

    const artist = yield* requireOne(rows, 'MusicArtist', id)

    if (genres !== undefined) {
      yield* Effect.tryPromise({
        try: () => replaceEntityLabels(db, 'artist', artist.id, { genres }),
        catch: (e) =>
          new DatabaseError({ message: getErrorMessage(e), operation: 'update', table: 'labels' }),
      })
    }

    const { genres: projectedGenres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'artist', artist),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...artist, genres: projectedGenres }
  }).pipe(Effect.withSpan('musicEntity.updateArtist', { attributes: { id } }))

export const deleteArtistEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        (async () => {
          const [, , , rows] = await db.batch([
            deleteIdentitiesForEntity(db, 'artist', id),
            deleteLinksForEntity(db, 'artist', id),
            deleteEntityLabels(db, 'artist', id),
            db
              .delete(musicArtistsTable)
              .where(eq(musicArtistsTable.id, id))
              .returning({ id: musicArtistsTable.id }),
          ])

          return rows
        })(),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to delete artist: ${getErrorMessage(e)}`,
          operation: 'delete',
          table: 'music_artists',
        }),
    })

    yield* requireOne(rows, 'MusicArtist', id)
  }).pipe(Effect.withSpan('musicEntity.deleteArtist', { attributes: { id } }))

const findArtistByNameCI = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(musicArtistsTable)
          .where(sql`lower(${musicArtistsTable.name}) = lower(${name})`)
          .limit(1),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to find artist: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_artists',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.findArtistByNameCI'))

export const findOrCreateArtist = Effect.fn('musicEntity.findOrCreateArtist')(function* (
  name: string,
  opts?: { imageUrl?: string | null },
) {
  const db = yield* Database
  const rows = yield* findArtistByNameCI(name)
  const existing = rows[0]

  if (existing) {
    if (opts?.imageUrl && existing.imageUrl !== opts.imageUrl) {
      yield* Effect.logInfo(
        `[MusicEntity] Artist "${existing.name}" exists with different imageUrl (existing: ${existing.imageUrl}, scraped: ${opts.imageUrl}) — skipping update`,
      )
    }

    const { genres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'artist', existing),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...existing, genres }
  }

  return yield* createArtistEffect(
    omitUndefined({
      name,
      slug: toSlug(name),
      imageUrl: opts?.imageUrl,
    }),
  )
})

export const findOrCreateArtistsByName = Effect.fn('musicEntity.findOrCreateArtistsByName')(
  function* (names: Array<string>) {
    const artists: Array<SelectMusicArtist> = []

    for (const name of names) {
      artists.push(yield* findOrCreateArtist(name))
    }

    return artists
  },
)
