/* oxlint-disable anti-slop-effect/no-manual-tag-comparison -- Rich-content references and catalog entities are schema-owned unions without generated matchers. */
import {
  type MusicSnapshot,
  SafeUrl as SafeUrlSchema,
  type SafeUrl,
} from '@gbfm/rich-content/schema'
import type { EmbedReference } from '@gbfm/rich-content/source'
import { asc, eq } from 'drizzle-orm'
import { Context, Data, Effect, Layer, Option, Schema } from 'effect'

import { Database, type DatabaseClient } from '@/db/layer'
import { musicTracksTable } from '@/db/music-entity.schema'
import { getAlbumByIdEffect } from '@/services/music-entity/album.service'
import { getLinksForEntityEffect } from '@/services/music-entity/link.service'
import { getPlaylistTracksEffect } from '@/services/music-entity/playlist-tracks.service'
import { getPublicPlaylistEffect } from '@/services/music-entity/playlist.service'
import { getTrackByIdEffect } from '@/services/music-entity/track.service'

import { parseMusicSource } from './canonical-music-identity/music-source'
import {
  CanonicalMusicIdentityRepository,
  type EntityReference,
} from './canonical-music-identity/repository'

type MusicReference = Extract<EmbedReference, { readonly _tag: 'MusicUrl' | 'MusicCatalog' }>

type MusicSnapshotValue = typeof MusicSnapshot.Type

class RichContentCatalogError extends Data.TaggedError('RichContentCatalogError')<{
  readonly cause: unknown
}> {}

/** Resolves an authored music reference into an inert catalog snapshot for a render document. */
export interface RichContentMusicResolver {
  readonly resolve: (reference: MusicReference) => Effect.Effect<MusicSnapshotValue | null>
}

/** Effect service used by the rich-content renderer to read GBFM catalog entities. */
export const RichContentMusicResolver = Context.Service<RichContentMusicResolver>(
  'RichContentMusicResolver',
)

const decodeSafeUrl = Schema.decodeUnknownOption(SafeUrlSchema)

const safeUrl = (value: string | null | undefined): SafeUrl | null => {
  if (!value) return null

  return Option.getOrNull(decodeSafeUrl(value))
}

const resolvedReference = (
  repository: CanonicalMusicIdentityRepository,
  reference: MusicReference,
) => {
  if (reference._tag === 'MusicCatalog')
    return Effect.succeed({ entityType: reference.entityType, entityId: reference.entityId })

  return parseMusicSource(reference.url, reference.entityType).pipe(
    Effect.flatMap((source) => repository.lookup(source)),
    Effect.map((identity) =>
      identity?.state === 'resolved' &&
      identity.entityType === reference.entityType &&
      identity.entityId
        ? { entityType: reference.entityType, entityId: identity.entityId }
        : null,
    ),
  )
}

const albumTracks = (db: DatabaseClient, albumId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .select({
          title: musicTracksTable.title,
          artists: musicTracksTable.artistNames,
        })
        .from(musicTracksTable)
        .where(eq(musicTracksTable.albumId, albumId))
        .orderBy(asc(musicTracksTable.trackNumber), asc(musicTracksTable.title)),
    catch: (cause) => new RichContentCatalogError({ cause }),
  }).pipe(
    Effect.map((tracks) =>
      tracks.map((track) => ({
        title: track.title,
        artists: track.artists ?? [],
        url: null,
      })),
    ),
  )

const playlistTracks = (db: DatabaseClient, playlistId: string) =>
  getPlaylistTracksEffect(playlistId).pipe(
    Effect.provideService(Database, db),
    Effect.map((rows) =>
      rows.map(({ links, track }) => ({
        title: track.title,
        artists: track.artistNames ?? [],
        url: safeUrl(links.find((link) => link.platform === 'spotify')?.url),
      })),
    ),
  )

const loadSnapshot = (
  db: DatabaseClient,
  reference: MusicReference,
  entity: EntityReference,
): Effect.Effect<MusicSnapshotValue, RichContentCatalogError | Error> =>
  Effect.gen(function* () {
    const provideDb = Effect.provideService(Database, db)

    const links = yield* provideDb(
      getLinksForEntityEffect(entity.entityType, entity.entityId, 'verified'),
    )

    const safeLinks = links.flatMap((link) => {
      const url = safeUrl(link.url)

      return url === null ? [] : [{ platform: link.platform, url }]
    })

    const authoredUrl = reference._tag === 'MusicUrl' ? reference.url : null

    const canonicalUrl =
      authoredUrl ??
      safeLinks.find((link) => link.platform === 'spotify')?.url ??
      safeLinks[0]?.url ??
      '/'

    if (entity.entityType === 'track') {
      const track = yield* provideDb(getTrackByIdEffect(entity.entityId))

      return {
        entityType: 'track',
        entityId: track.id,
        title: track.title,
        artists: track.artistNames ?? [],
        description: null,
        imageUrl: safeUrl(track.coverImageUrl),
        canonicalUrl,
        links: safeLinks,
        tracks: [],
      }
    }

    if (entity.entityType === 'album') {
      const album = yield* provideDb(getAlbumByIdEffect(entity.entityId))
      const tracks = reference.showTracks ? yield* albumTracks(db, album.id) : []

      return {
        entityType: 'album',
        entityId: album.id,
        title: album.title,
        artists: album.artistNames ?? [],
        description: null,
        imageUrl: safeUrl(album.coverImageUrl),
        canonicalUrl,
        links: safeLinks,
        tracks,
      }
    }

    const playlist = yield* provideDb(getPublicPlaylistEffect(entity.entityId))
    const tracks = reference.showTracks ? yield* playlistTracks(db, playlist.id) : []

    return {
      entityType: 'playlist',
      entityId: playlist.id,
      title: playlist.title,
      artists: [],
      description: playlist.description,
      imageUrl: safeUrl(playlist.coverImageUrl),
      canonicalUrl,
      links: safeLinks,
      tracks,
    }
  })

const resolve = (
  db: DatabaseClient,
  repository: CanonicalMusicIdentityRepository,
  reference: MusicReference,
): Effect.Effect<MusicSnapshotValue | null> =>
  Effect.gen(function* () {
    const entity = yield* resolvedReference(repository, reference)

    if (entity === null) return null

    return yield* loadSnapshot(db, reference, entity)
  }).pipe(
    Effect.catch(() =>
      Effect.logWarning('[rich-content] Music reference unavailable', {
        entityType: reference.entityType,
        referenceType: reference._tag,
      }).pipe(Effect.as(null)),
    ),
    Effect.withSpan('richContent.resolveMusic', {
      attributes: {
        'music.entityType': reference.entityType,
        'music.referenceType': reference._tag,
      },
    }),
  )

/** Live catalog resolver. Public reads only query existing identities and never scrape or write. */
export const RichContentMusicResolverLayer = Layer.effect(
  RichContentMusicResolver,
  Effect.gen(function* () {
    const db = yield* Database
    const repository = new CanonicalMusicIdentityRepository(db)

    return RichContentMusicResolver.of({
      resolve: (reference) => resolve(db, repository, reference),
    })
  }),
)
