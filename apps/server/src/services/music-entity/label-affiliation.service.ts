import { and, asc, desc, eq, lte, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { projectEntityLabelsForRows } from '@/db/labels'
import { Database } from '@/db/layer'
import {
  musicAlbumsTable,
  musicArtistsTable,
  musicLabelAlbumsTable,
  musicLabelArtistsTable,
  musicLabelsTable,
} from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'

import { writeMusicRelationship } from './relationship-write'
import type { MusicWriteRequest } from './write-intent'

/** Lists all artists affiliated with a label for administrative management. */
export const getArtistsForLabelEffect = (labelId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ artist: musicArtistsTable })
          .from(musicLabelArtistsTable)
          .innerJoin(musicArtistsTable, eq(musicLabelArtistsTable.artistId, musicArtistsTable.id))
          .where(eq(musicLabelArtistsTable.labelId, labelId))
          .orderBy(asc(musicArtistsTable.name))

        const projected = await projectEntityLabelsForRows(
          db,
          'artist',
          rows.map(({ artist }) => artist),
        )

        return projected.map(({ tags: _tags, genres, ...artist }) => ({ ...artist, genres }))
      },
      catch: (cause) =>
        new DatabaseError({
          message: `Failed to list label artists: ${getErrorMessage(cause)}`,
          operation: 'select',
          table: 'music_label_artists',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getArtistsForLabel', { attributes: { labelId } }))

/** Lists published artists affiliated with a label for public rendering. */
export const getPublishedArtistsForLabelEffect = (labelId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ artist: musicArtistsTable })
          .from(musicLabelArtistsTable)
          .innerJoin(musicArtistsTable, eq(musicLabelArtistsTable.artistId, musicArtistsTable.id))
          .where(
            and(
              eq(musicLabelArtistsTable.labelId, labelId),
              lte(musicArtistsTable.publishedAt, new Date()),
            ),
          )
          .orderBy(asc(musicArtistsTable.name))

        const projected = await projectEntityLabelsForRows(
          db,
          'artist',
          rows.map(({ artist }) => artist),
        )

        return projected.map(({ tags: _tags, genres, ...artist }) => ({ ...artist, genres }))
      },
      catch: (cause) =>
        new DatabaseError({
          message: `Failed to list published label artists: ${getErrorMessage(cause)}`,
          operation: 'select',
          table: 'music_label_artists',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getPublishedArtistsForLabel', { attributes: { labelId } }))

/** Lists all albums affiliated with a label for administrative management. */
export const getAlbumsForLabelEffect = (labelId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ album: musicAlbumsTable })
          .from(musicLabelAlbumsTable)
          .innerJoin(musicAlbumsTable, eq(musicLabelAlbumsTable.albumId, musicAlbumsTable.id))
          .where(eq(musicLabelAlbumsTable.labelId, labelId))
          .orderBy(
            sql`${musicAlbumsTable.releaseDate} IS NULL`,
            desc(musicAlbumsTable.releaseDate),
            asc(musicAlbumsTable.title),
          )

        const projected = await projectEntityLabelsForRows(
          db,
          'album',
          rows.map(({ album }) => album),
        )

        return projected.map(({ tags: _tags, genres, ...album }) => ({ ...album, genres }))
      },
      catch: (cause) =>
        new DatabaseError({
          message: `Failed to list label albums: ${getErrorMessage(cause)}`,
          operation: 'select',
          table: 'music_label_albums',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getAlbumsForLabel', { attributes: { labelId } }))

/** Lists published albums affiliated with a label for public rendering. */
export const getPublishedAlbumsForLabelEffect = (labelId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ album: musicAlbumsTable })
          .from(musicLabelAlbumsTable)
          .innerJoin(musicAlbumsTable, eq(musicLabelAlbumsTable.albumId, musicAlbumsTable.id))
          .where(
            and(
              eq(musicLabelAlbumsTable.labelId, labelId),
              lte(musicAlbumsTable.publishedAt, new Date()),
            ),
          )
          .orderBy(
            sql`${musicAlbumsTable.releaseDate} IS NULL`,
            desc(musicAlbumsTable.releaseDate),
            asc(musicAlbumsTable.title),
          )

        const projected = await projectEntityLabelsForRows(
          db,
          'album',
          rows.map(({ album }) => album),
        )

        return projected.map(({ tags: _tags, genres, ...album }) => ({ ...album, genres }))
      },
      catch: (cause) =>
        new DatabaseError({
          message: `Failed to list published label albums: ${getErrorMessage(cause)}`,
          operation: 'select',
          table: 'music_label_albums',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getPublishedAlbumsForLabel', { attributes: { labelId } }))

/** Lists every label affiliated with an artist. */
export const getLabelsForArtistEffect = (artistId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ label: musicLabelsTable })
          .from(musicLabelArtistsTable)
          .innerJoin(musicLabelsTable, eq(musicLabelArtistsTable.labelId, musicLabelsTable.id))
          .where(eq(musicLabelArtistsTable.artistId, artistId))
          .orderBy(asc(musicLabelsTable.name))

        return projectEntityLabelsForRows(
          db,
          'musicLabel',
          rows.map(({ label }) => label),
        )
      },
      catch: (cause) =>
        new DatabaseError({
          message: `Failed to list artist labels: ${getErrorMessage(cause)}`,
          operation: 'select',
          table: 'music_label_artists',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getLabelsForArtist', { attributes: { artistId } }))

/** Lists every label affiliated with an album. */
export const getLabelsForAlbumEffect = (albumId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ label: musicLabelsTable })
          .from(musicLabelAlbumsTable)
          .innerJoin(musicLabelsTable, eq(musicLabelAlbumsTable.labelId, musicLabelsTable.id))
          .where(eq(musicLabelAlbumsTable.albumId, albumId))
          .orderBy(asc(musicLabelsTable.name))

        return projectEntityLabelsForRows(
          db,
          'musicLabel',
          rows.map(({ label }) => label),
        )
      },
      catch: (cause) =>
        new DatabaseError({
          message: `Failed to list album labels: ${getErrorMessage(cause)}`,
          operation: 'select',
          table: 'music_label_albums',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getLabelsForAlbum', { attributes: { albumId } }))

/** Creates an idempotent factual affiliation between a label and an artist. */
export const affiliateArtistWithLabelEffect = (
  labelId: string,
  artistId: string,
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'artist', entityId: artistId },
    { kind: 'affiliation', action: 'set', labelId },
    write,
  )

/** Removes a factual affiliation between a label and an artist. */
export const unaffiliateArtistFromLabelEffect = (
  labelId: string,
  artistId: string,
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'artist', entityId: artistId },
    { kind: 'affiliation', action: 'remove', labelId },
    write,
  )

/** Creates an idempotent factual affiliation between a label and an album. */
export const affiliateAlbumWithLabelEffect = (
  labelId: string,
  albumId: string,
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'album', entityId: albumId },
    { kind: 'affiliation', action: 'set', labelId },
    write,
  )

/** Removes a factual affiliation between a label and an album. */
export const unaffiliateAlbumFromLabelEffect = (
  labelId: string,
  albumId: string,
  write?: MusicWriteRequest,
) =>
  writeMusicRelationship(
    { entityType: 'album', entityId: albumId },
    { kind: 'affiliation', action: 'remove', labelId },
    write,
  )
