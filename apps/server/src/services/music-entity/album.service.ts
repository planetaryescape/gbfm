import { asc, desc, eq, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { projectEntityLabels, projectEntityLabelsForRows, replaceEntityLabels } from '@/db/labels'
import { Database } from '@/db/layer'
import { musicAlbumArtistsTable, musicAlbumsTable } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { omitUndefined } from '@/lib/omit-undefined'

import { insertMusicEntity } from './create-statements'
import { deleteMusicEntity } from './delete-write'
import { MusicMetadataRow, writeMusicMetadata } from './metadata-write'
import { writeMusicRelationship } from './relationship-write'
import { requireOne } from './shared'
import { MusicWriteError, type MusicWriteRequest } from './write-intent'

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

const AlbumWriteRow = Schema.Struct({
  ...MusicMetadataRow.fields,
  title: Schema.String,
  artistNames: Schema.NullOr(Schema.Array(Schema.String)),
  releaseDate: Schema.NullOr(Schema.DateFromString),
  coverImageUrl: Schema.NullOr(Schema.String),
  genres: Schema.NullOr(Schema.Array(Schema.String)),
  albumType: Schema.NullOr(Schema.String),
})

const AlbumWritePatch = Schema.Struct({
  title: Schema.optionalKey(AlbumWriteRow.fields.title),
  artistNames: Schema.optionalKey(AlbumWriteRow.fields.artistNames),
  releaseDate: Schema.optionalKey(AlbumWriteRow.fields.releaseDate),
  coverImageUrl: Schema.optionalKey(AlbumWriteRow.fields.coverImageUrl),
  genres: Schema.optionalKey(AlbumWriteRow.fields.genres),
  albumType: Schema.optionalKey(AlbumWriteRow.fields.albumType),
  slug: Schema.optionalKey(AlbumWriteRow.fields.slug),
  publishedAt: Schema.optionalKey(AlbumWriteRow.fields.publishedAt),
  createdById: Schema.optionalKey(AlbumWriteRow.fields.createdById),
})

export const updateAlbumEffect = (
  id: string,
  data: Partial<CreateAlbumInput>,
  write?: MusicWriteRequest,
) =>
  Effect.gen(function* () {
    const patch = yield* Schema.encodeEffect(AlbumWritePatch)(omitUndefined(data)).pipe(
      Effect.mapError(
        () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid album edit.' }),
      ),
    )

    const saved = yield* writeMusicMetadata({
      target: { entityType: 'album', entityId: id },
      write,
      patch,
      row: AlbumWriteRow,
      load: getAlbumByIdEffect(id),
      relationships: { artistIds: data.artistIds, artistNames: data.artistNames },
    })

    return {
      ...saved,
      artistNames: saved.artistNames?.slice() ?? null,
      genres: saved.genres?.slice() ?? null,
    }
  }).pipe(Effect.withSpan('musicEntity.updateAlbum', { attributes: { id } }))

export const deleteAlbumEffect = (id: string, write?: MusicWriteRequest) =>
  deleteMusicEntity({ entityType: 'album', entityId: id }, write)

export const addArtistToAlbumEffect = (
  albumId: string,
  artistId: string,
  opts?: { role?: string; displayOrder?: number },
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'album', entityId: albumId },
    { kind: 'credit', action: 'set', artistId, ...opts },
    write,
  )

export const removeArtistFromAlbumEffect = (
  albumId: string,
  artistId: string,
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'album', entityId: albumId },
    { kind: 'credit', action: 'remove', artistId },
    write,
  )
