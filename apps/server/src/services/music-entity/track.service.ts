import { asc, desc, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Database } from '@/db/layer'
import { musicTracksTable } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { omitUndefined } from '@/lib/omit-undefined'

import { insertMusicEntity } from './create-statements'
import { deleteMusicEntity } from './delete-write'
import { MusicMetadataRow, writeMusicMetadata } from './metadata-write'
import { writeMusicRelationship } from './relationship-write'
import { requireOne } from './shared'
import { MusicWriteError, type MusicWriteRequest } from './write-intent'

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

const TrackWriteRow = Schema.Struct({
  ...MusicMetadataRow.fields,
  title: Schema.String,
  artistNames: Schema.NullOr(Schema.Array(Schema.String)),
  coverImageUrl: Schema.NullOr(Schema.String),
  albumId: Schema.NullOr(Schema.String),
  trackNumber: Schema.NullOr(Schema.Number),
})

const TrackWritePatch = Schema.Struct({
  title: Schema.optionalKey(TrackWriteRow.fields.title),
  artistNames: Schema.optionalKey(TrackWriteRow.fields.artistNames),
  coverImageUrl: Schema.optionalKey(TrackWriteRow.fields.coverImageUrl),
  albumId: Schema.optionalKey(TrackWriteRow.fields.albumId),
  trackNumber: Schema.optionalKey(TrackWriteRow.fields.trackNumber),
  slug: Schema.optionalKey(TrackWriteRow.fields.slug),
  publishedAt: Schema.optionalKey(TrackWriteRow.fields.publishedAt),
  createdById: Schema.optionalKey(TrackWriteRow.fields.createdById),
})

export const updateTrackEffect = (
  id: string,
  data: Partial<CreateTrackInput>,
  write?: MusicWriteRequest,
) =>
  Effect.gen(function* () {
    const patch = yield* Schema.encodeEffect(TrackWritePatch)(omitUndefined(data)).pipe(
      Effect.mapError(
        () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid track edit.' }),
      ),
    )

    const saved = yield* writeMusicMetadata({
      target: { entityType: 'track', entityId: id },
      write,
      patch,
      row: TrackWriteRow,
      load: getTrackByIdEffect(id),
      relationships: {
        artistIds: data.artistIds,
        artistNames: data.artistNames,
        albumId: data.albumId,
      },
    })

    return { ...saved, artistNames: saved.artistNames?.slice() ?? null }
  }).pipe(Effect.withSpan('musicEntity.updateTrack', { attributes: { id } }))

export const deleteTrackEffect = (id: string, write?: MusicWriteRequest) =>
  deleteMusicEntity({ entityType: 'track', entityId: id }, write)

export const addArtistToTrackEffect = (
  trackId: string,
  artistId: string,
  opts?: { role?: string; displayOrder?: number },
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'track', entityId: trackId },
    { kind: 'credit', action: 'set', artistId, ...opts },
    write,
  )

export const removeArtistFromTrackEffect = (
  trackId: string,
  artistId: string,
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'track', entityId: trackId },
    { kind: 'credit', action: 'remove', artistId },
    write,
  )
