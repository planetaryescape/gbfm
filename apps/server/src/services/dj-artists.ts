import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm'
import { Effect } from 'effect'

import { audioVisibilityCondition, type AudioViewer } from '@/db/audio-visibility'
import { audioArtists, audioTable } from '@/db/audio.schema'
import { Database } from '@/db/layer'
import { musicArtistsTable } from '@/db/music-entity.schema'
import { showsTable } from '@/db/show.schema'
import { DatabaseError, NotFoundError } from '@/errors'

import type { PublicProfile, PublicProfileMetadata } from './profile.service'

const djArtistIds = (db: Database['Service']) =>
  db
    .select({ id: audioArtists.artistId })
    .from(audioArtists)
    .innerJoin(audioTable, eq(audioTable.id, audioArtists.audioId))
    .where(eq(audioTable.type, 'mix'))

/** The existing DJ profile predicate without loading its unbounded mix graph. */
export const getArtistDjProfileMetadata = Effect.fn('artist.getDjProfileMetadata')(function* (
  slug: string,
): Effect.fn.Return<PublicProfileMetadata, DatabaseError | NotFoundError, Database> {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          id: musicArtistsTable.id,
          name: musicArtistsTable.name,
          username: musicArtistsTable.slug,
          bio: musicArtistsTable.bio,
          createdAt: musicArtistsTable.createdAt,
        })
        .from(musicArtistsTable)
        .where(
          and(
            eq(musicArtistsTable.slug, slug),
            isNotNull(musicArtistsTable.publishedAt),
            inArray(musicArtistsTable.id, djArtistIds(db)),
          ),
        )
        .limit(1),
    catch: () =>
      new DatabaseError({
        message: 'Could not load DJ profile metadata',
        operation: 'select',
        table: 'music_artists',
      }),
  })

  if (!rows[0])
    return yield* new NotFoundError({ message: 'Profile not found', resource: 'profile', id: slug })

  return rows[0]
})

export const listArtistDjs = Effect.fn('artist.listDjs')(function* () {
  const db = yield* Database

  return yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          id: musicArtistsTable.id,
          name: musicArtistsTable.name,
          username: musicArtistsTable.slug,
          image: musicArtistsTable.imageUrl,
          bio: musicArtistsTable.bio,
          mixCount: count(audioTable.id),
        })
        .from(musicArtistsTable)
        .leftJoin(audioArtists, eq(audioArtists.artistId, musicArtistsTable.id))
        .leftJoin(
          audioTable,
          and(
            eq(audioTable.id, audioArtists.audioId),
            eq(audioTable.draft, false),
            eq(audioTable.type, 'mix'),
          ),
        )
        .where(
          and(
            isNotNull(musicArtistsTable.publishedAt),
            inArray(musicArtistsTable.id, djArtistIds(db)),
          ),
        )
        .groupBy(musicArtistsTable.id)
        .orderBy(asc(musicArtistsTable.name)),
    catch: () =>
      new DatabaseError({
        message: 'Could not list DJ artist profiles',
        operation: 'select',
        table: 'music_artists',
      }),
  })
})

export const getArtistDjProfile = Effect.fn('artist.getDjProfile')(function* (
  slug: string,
  viewer?: AudioViewer,
): Effect.fn.Return<PublicProfile, DatabaseError | NotFoundError, Database> {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(musicArtistsTable)
        .where(
          and(
            eq(musicArtistsTable.slug, slug),
            isNotNull(musicArtistsTable.publishedAt),
            inArray(musicArtistsTable.id, djArtistIds(db)),
          ),
        )
        .limit(1),
    catch: () =>
      new DatabaseError({
        message: 'Could not load DJ artist profile',
        operation: 'select',
        table: 'music_artists',
      }),
  })

  const artist = rows[0]

  if (!artist)
    return yield* new NotFoundError({ message: 'Profile not found', resource: 'profile', id: slug })

  const mixes = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          id: audioTable.id,
          title: audioTable.title,
          slug: audioTable.slug,
          thumbnailUrl: audioTable.thumbnailUrl,
          showThumbnailUrl: showsTable.thumbnailUrl,
          type: audioTable.type,
          showId: audioTable.showId,
          draft: audioTable.draft,
        })
        .from(audioArtists)
        .innerJoin(audioTable, eq(audioTable.id, audioArtists.audioId))
        .leftJoin(showsTable, eq(showsTable.id, audioTable.showId))
        .where(
          and(
            eq(audioArtists.artistId, artist.id),
            eq(audioTable.type, 'mix'),
            audioVisibilityCondition(db, viewer),
          ),
        )
        .orderBy(asc(audioTable.createdAt)),
    catch: () =>
      new DatabaseError({
        message: 'Could not load artist mixes',
        operation: 'select',
        table: 'audio_artists',
      }),
  })

  return {
    id: artist.id,
    name: artist.name,
    username: artist.slug,
    image: artist.imageUrl,
    bio: artist.bio,
    socialLinks: [],
    createdAt: artist.createdAt,
    content: {
      mixes: mixes.map(({ showThumbnailUrl, ...mix }) => ({
        ...mix,
        thumbnailUrl: mix.thumbnailUrl ?? showThumbnailUrl,
      })),
      shows: [],
      editorials: [],
      tweets: [],
    },
  }
})
