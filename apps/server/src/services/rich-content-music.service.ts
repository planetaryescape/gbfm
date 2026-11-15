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
import { musicAlbumsTable, musicTracksTable } from '@/db/music-entity.schema'
import { getLinksForEntityEffect } from '@/services/music-entity/link.service'
import { getPlaylistTracksEffect } from '@/services/music-entity/playlist-tracks.service'
import { getPublicPlaylistEffect } from '@/services/music-entity/playlist.service'
import { requireOne } from '@/services/music-entity/shared'

import { parseMusicSource } from './canonical-music-identity/music-source'
import { CanonicalMusicIdentityRepository } from './canonical-music-identity/repository'

type MusicReference = Extract<EmbedReference, { readonly _tag: 'MusicUrl' | 'MusicCatalog' }>

type SnapshotEntity = {
  readonly entityType: MusicReference['entityType']
  readonly entityId: string
}

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

const snapshotDetails = (db: DatabaseClient, reference: MusicReference, entity: SnapshotEntity) =>
  Effect.gen(function* () {
    if (entity.entityType === 'playlist') {
      const playlist = yield* getPublicPlaylistEffect(entity.entityId).pipe(
        Effect.provideService(Database, db),
      )

      const tracks = reference.showTracks ? yield* playlistTracks(db, entity.entityId) : []

      return {
        title: playlist.title,
        artists: [],
        description: playlist.description,
        imageUrl: safeUrl(playlist.coverImageUrl),
        tracks,
      }
    }

    const table = entity.entityType === 'album' ? musicAlbumsTable : musicTracksTable

    const [record, tracks] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            db
              .select({
                id: table.id,
                title: table.title,
                artists: table.artistNames,
                coverImageUrl: table.coverImageUrl,
              })
              .from(table)
              .where(eq(table.id, entity.entityId))
              .limit(1),
          catch: (cause) => new RichContentCatalogError({ cause }),
        }).pipe(Effect.flatMap((rows) => requireOne(rows, entity.entityType, entity.entityId))),
        entity.entityType === 'album' && reference.showTracks
          ? albumTracks(db, entity.entityId)
          : Effect.succeed([]),
      ],
      { concurrency: 2 },
    )

    return {
      title: record.title,
      artists: record.artists ?? [],
      description: null,
      imageUrl: safeUrl(record.coverImageUrl),
      tracks,
    }
  })

const loadSnapshot = (
  db: DatabaseClient,
  reference: MusicReference,
  entity: SnapshotEntity,
): Effect.Effect<MusicSnapshotValue, RichContentCatalogError | Error> =>
  Effect.gen(function* () {
    const [links, details] = yield* Effect.all(
      [
        getLinksForEntityEffect(entity.entityType, entity.entityId, 'verified').pipe(
          Effect.provideService(Database, db),
        ),
        snapshotDetails(db, reference, entity),
      ],
      { concurrency: 2 },
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

    return {
      entityType: entity.entityType,
      entityId: entity.entityId,
      ...details,
      canonicalUrl,
      links: safeLinks,
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

    return yield* loadSnapshot(db, reference, {
      entityType: entity.entityType,
      entityId: entity.entityId,
    })
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
