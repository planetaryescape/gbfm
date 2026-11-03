import { OtelTracer, Resource } from '@effect/opentelemetry'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { and, eq } from 'drizzle-orm'
import { Effect, Exit, Layer, Result } from 'effect'
import { beforeAll, describe, expect, test } from 'vitest'

import { Database } from '@/db/layer'
import {
  musicAlbumArtistsTable,
  musicAlbumsTable,
  musicArtistsTable,
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicPlaylistsTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicSourceIdentityConflictsTable,
  musicTrackArtistsTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { S3Error } from '@/errors'
import { ConfigService, createConfig } from '@/services/config.service'
import { deleteAlbumEffect } from '@/services/music-entity/album.service'
import { deleteArtistEffect } from '@/services/music-entity/artist.service'
import { deletePlaylistEffect } from '@/services/music-entity/playlist.service'
import { deleteTrackEffect } from '@/services/music-entity/track.service'
import {
  MusicLinkScraperService,
  MusicScraperError,
  type MusicScrapeInput,
  type ScrapeResult,
} from '@/services/music-link-scraper.service'
import { S3Service, type S3Service as S3ServiceType } from '@/services/s3.service'
import { db } from '@/test/d1'
import { withTestLayer } from '@/test/effect'
import { makeTestS3Service } from '@/test/s3'

import { MusicCoverImageFetcher, type MusicCoverImageFetch } from './artwork-delivery'
import type { MusicIdentityError } from './errors'
import {
  CanonicalMusicIdentity,
  CanonicalMusicIdentityLayer,
  CanonicalMusicIdentityLeaseTiming,
  type CanonicalMusicIdentityLeaseTimingConfig,
  type CanonicalMusicIdentityService,
  type ProviderMusicSnapshot,
  type RefreshMusicEntity,
} from './index'
import { parseMusicSource } from './music-source'
import { CanonicalMusicIdentityRepository } from './repository'

const externalId = () => crypto.randomUUID().replaceAll('-', '')

beforeAll(async () => {
  await db
    .insert(musicEntityTypesTable)
    .values([
      { id: 'artist', displayName: 'Artist' },
      { id: 'album', displayName: 'Album' },
      { id: 'track', displayName: 'Track' },
      { id: 'playlist', displayName: 'Playlist' },
    ])
    .onConflictDoNothing()
  await db
    .insert(musicPlatformsTable)
    .values([
      { id: 'spotify', displayName: 'Spotify' },
      { id: 'deezer', displayName: 'Deezer' },
      { id: 'youtube', displayName: 'YouTube' },
      { id: 'other', displayName: 'Other' },
    ])
    .onConflictDoNothing()
})

type ArtworkTestDependencies = {
  readonly s3: S3ServiceType
  readonly fetcher: MusicCoverImageFetch
}

const serviceEffect = <A>(
  scraper: MusicLinkScraperService,
  use: (service: CanonicalMusicIdentityService) => Effect.Effect<A, MusicIdentityError>,
  leaseTiming?: CanonicalMusicIdentityLeaseTimingConfig,
  artwork?: ArtworkTestDependencies,
) => {
  const baseDependencies = Layer.mergeAll(
    Layer.succeed(Database, db),
    Layer.succeed(MusicLinkScraperService, scraper),
    Layer.succeed(ConfigService, createConfig()),
    Layer.succeed(S3Service, artwork?.s3 ?? makeTestS3Service()),
    Layer.succeed(MusicCoverImageFetcher, artwork?.fetcher ?? fetch),
  )

  const dependencies = leaseTiming
    ? Layer.merge(baseDependencies, Layer.succeed(CanonicalMusicIdentityLeaseTiming, leaseTiming))
    : baseDependencies

  const layer = CanonicalMusicIdentityLayer.pipe(Layer.provide(dependencies))

  return withTestLayer(Effect.flatMap(CanonicalMusicIdentity, use), layer)
}

const serviceWith = <A>(
  scraper: MusicLinkScraperService,
  use: (service: CanonicalMusicIdentityService) => Effect.Effect<A, MusicIdentityError>,
  artwork?: ArtworkTestDependencies,
) => Effect.runPromise(serviceEffect(scraper, use, undefined, artwork))

const serviceExitWith = <A>(
  scraper: MusicLinkScraperService,
  use: (service: CanonicalMusicIdentityService) => Effect.Effect<A, MusicIdentityError>,
  artwork?: ArtworkTestDependencies,
) => Effect.runPromiseExit(serviceEffect(scraper, use, undefined, artwork))

const recordingScraper = (scrape: (input: MusicScrapeInput) => Effect.Effect<ScrapeResult>) => {
  const calls: Array<MusicScrapeInput> = []

  const service: MusicLinkScraperService = {
    scrape: (input) => {
      calls.push(input)

      return scrape(input)
    },
    discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
  }

  return { calls, service }
}

const snapshot = (
  sourceUrl: string,
  title = 'Imported Track',
  links?: ProviderMusicSnapshot['links'],
): ProviderMusicSnapshot => ({
  entityType: 'track',
  sourceUrl,
  title,
  artistNames: ['Artist'],
  links,
})

describe('CanonicalMusicIdentity', () => {
  test('interruption leaves its unresolved lease for expiry rather than releasing it', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const source = await Effect.runPromise(parseMusicSource(sourceUrl, 'track'))
    const started = Promise.withResolvers<void>()
    const controller = new AbortController()

    const recorder = recordingScraper(() =>
      Effect.sync(() => started.resolve()).pipe(Effect.andThen(Effect.never)),
    )

    const resolution = Effect.runPromiseExit(
      serviceEffect(recorder.service, (service) =>
        service.resolveSource({
          url: sourceUrl,
          origin: 'manual',
          artworkDelivery: 'preserve',
        }),
      ),
      { signal: controller.signal },
    )

    await started.promise
    controller.abort()
    expect(Exit.hasInterrupts(await resolution)).toBe(true)

    const [identity] = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))

    expect(identity).toMatchObject({ state: 'resolving', entityId: null })
    expect(identity?.ownerToken).toBeTypeOf('string')
    const expiresAt = identity?.leaseExpiresAt

    if (!expiresAt) throw new Error('Missing interrupted lease')
    const repository = new CanonicalMusicIdentityRepository(db)
    expect(
      await Effect.runPromise(
        repository.claim(source, 'replacement', new Date(expiresAt.getTime() + 1), 30_000),
      ),
    ).toMatchObject({ result: 'reclaimed' })
  })

  test('persists and returns required artwork after upload', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const artworkUrl = 'https://i.scdn.co/image/strict-success'
    const uploads: Array<string> = []
    const fetches: Array<string> = []

    const scraper = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: {
          title: 'Strict artwork track',
          artistName: 'Artist',
          type: 'song',
          thumbnailUrl: artworkUrl,
        },
      }),
    )

    const artwork = {
      s3: makeTestS3Service((key) => {
        uploads.push(key)

        return Effect.succeed(key)
      }),
      fetcher: (input: string | URL | Request) => {
        fetches.push(new Request(input).url)

        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/jpeg' },
          }),
        )
      },
    }

    const result = await serviceWith(
      scraper.service,
      (service) =>
        service.resolveSource({
          url: sourceUrl,
          expectedType: 'track',
          origin: 'editorial',
          artworkDelivery: 'required',
        }),
      artwork,
    )

    if (result.entityType !== 'track') throw new Error('Expected a track result')

    const stored = await db
      .select()
      .from(musicTracksTable)
      .where(eq(musicTracksTable.id, result.entity.id))
      .limit(1)

    const expectedUrl = `https://cdn.goosebumps.fm/user-content/music/track/${result.entity.id}/cover`

    expect(fetches).toEqual([artworkUrl])
    expect(uploads).toEqual([`music/track/${result.entity.id}/cover`])
    expect(result.entity.coverImageUrl).toBe(expectedUrl)
    expect(stored[0]?.coverImageUrl).toBe(expectedUrl)
  })

  test('keeps canonical identity after required artwork failure and repairs it on retry', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    const artworkUrl = 'https://i.scdn.co/image/strict-retry'
    let uploadAttempts = 0

    const scraper = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: {
          title: 'Strict retry track',
          artistName: 'Artist',
          type: 'song',
          thumbnailUrl: artworkUrl,
        },
      }),
    )

    const artwork = {
      s3: makeTestS3Service((key) => {
        uploadAttempts += 1

        return uploadAttempts === 1
          ? Effect.fail(new S3Error({ message: 'Unavailable', operation: 'uploadFile', key }))
          : Effect.succeed(key)
      }),
      fetcher: () =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
    }

    const first = await serviceExitWith(
      scraper.service,
      (service) =>
        service.resolveSource({
          url: sourceUrl,
          expectedType: 'track',
          origin: 'editorial',
          artworkDelivery: 'required',
        }),
      artwork,
    )

    const firstError = Result.getOrThrow(Exit.findError(first))
    expect(firstError._tag).toBe('MusicIdentityArtworkDeliveryFailed')
    expect(firstError).toMatchObject({
      operation: 'upload',
    })

    const identityRows = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))
      .limit(1)

    const entityId = identityRows[0]?.entityId
    expect(entityId).toBeTruthy()

    if (!entityId) throw new Error('Expected persisted canonical identity')

    const failedArtworkRows = await db
      .select()
      .from(musicTracksTable)
      .where(eq(musicTracksTable.id, entityId))
      .limit(1)

    expect(failedArtworkRows[0]?.coverImageUrl).toBe(artworkUrl)

    const retried = await serviceWith(
      scraper.service,
      (service) =>
        service.resolveSource({
          url: sourceUrl,
          expectedType: 'track',
          origin: 'editorial',
          artworkDelivery: 'required',
        }),
      artwork,
    )

    if (retried.entityType !== 'track') throw new Error('Expected a track result')

    expect(retried.entity.id).toBe(entityId)
    expect(retried.entity.coverImageUrl).toBe(
      `https://cdn.goosebumps.fm/user-content/music/track/${entityId}/cover`,
    )
    expect(scraper.calls).toHaveLength(1)
    expect(uploadAttempts).toBe(2)
  })

  test('returns persisted playlist unchanged when best-effort artwork upload fails', async () => {
    const sourceUrl = `https://open.spotify.com/playlist/${externalId()}`
    const artworkUrl = 'https://i.scdn.co/image/best-effort'

    const artwork = {
      s3: makeTestS3Service((key) =>
        Effect.fail(new S3Error({ message: 'Unavailable', operation: 'uploadFile', key })),
      ),
      fetcher: () =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
    }

    const recorder = recordingScraper(() => Effect.die('Provider must not be called'))

    const result = await serviceWith(
      recorder.service,
      (service) =>
        service.importProviderEntity({
          snapshot: {
            entityType: 'playlist',
            sourceUrl,
            title: 'Best effort playlist',
            imageUrl: artworkUrl,
          },
          origin: 'spotify_import',
          artworkDelivery: 'best_effort',
        }),
      artwork,
    )

    if (result.entityType !== 'playlist') throw new Error('Expected a playlist result')

    const stored = await db
      .select()
      .from(musicPlaylistsTable)
      .where(eq(musicPlaylistsTable.id, result.entity.id))
      .limit(1)

    expect(result.entity.coverImageUrl).toBe(artworkUrl)
    expect(stored[0]?.coverImageUrl).toBe(artworkUrl)
  })

  test('returns indexed source and alias hits without provider calls', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}?si=first`
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: snapshot(sourceUrl),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const canonical = yield* service.resolveSource({
          url: `https://open.spotify.com/track/${id}`,
          expectedType: 'track',
          origin: 'editorial',
          artworkDelivery: 'preserve',
        })

        const secondAlias = yield* service.resolveSource({
          url: `https://open.spotify.com/track/${id}?utm_source=share`,
          expectedType: 'track',
          origin: 'tweet',
          artworkDelivery: 'preserve',
        })

        return { imported, canonical, secondAlias }
      }),
    )

    expect(recorder.calls).toHaveLength(0)
    expect(result.canonical.entity.id).toBe(result.imported.entity.id)
    expect(result.secondAlias.entity.id).toBe(result.imported.entity.id)
  })

  test('renews the D1 lease while provider work exceeds its initial duration', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    const title = `Heartbeat Track ${id}`
    const leaseTiming = { leaseMs: 90, waitAttempts: 100, waitMs: 5 }
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()

    const recorder = recordingScraper(() =>
      Effect.promise(async () => {
        started.resolve()
        await gate.promise

        return {
          links: [],
          entityMeta: { title, artistName: 'Artist', type: 'song' },
        }
      }),
    )

    const resolve = serviceEffect(
      recorder.service,
      (service) =>
        service.resolveSource({
          url: sourceUrl,
          expectedType: 'track',
          origin: 'editorial',
          artworkDelivery: 'preserve',
        }),
      leaseTiming,
    )

    const first = Effect.runPromise(resolve)
    await started.promise

    const initialIdentity = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))
      .limit(1)

    const initialLeaseExpiresAt = initialIdentity[0]?.leaseExpiresAt?.getTime() ?? Date.now()
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.max(1, initialLeaseExpiresAt - Date.now() + 30)),
    )

    try {
      // A timer firing does not mean the asynchronous D1 renewal has committed.
      await expect
        .poll(
          async () => {
            const [identity] = await db
              .select()
              .from(musicSourceIdentitiesTable)
              .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))
              .limit(1)

            return identity?.leaseExpiresAt?.getTime()
          },
          { timeout: 2_000, interval: 20 },
        )
        .toBeGreaterThan(initialLeaseExpiresAt)

      const second = Effect.runPromise(resolve)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, leaseTiming.waitMs * 3))
      gate.resolve()
      const [firstResult, secondResult] = await Promise.all([first, second])

      const entities = await db
        .select()
        .from(musicTracksTable)
        .where(eq(musicTracksTable.title, title))

      expect(recorder.calls).toHaveLength(1)
      expect(entities).toHaveLength(1)
      expect(secondResult.entity.id).toBe(firstResult.entity.id)
    } finally {
      gate.resolve()
      await first
    }
  })

  test('fails resolution when its heartbeat detects lost claim ownership', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    const leaseTiming = { leaseMs: 90, waitAttempts: 100, waitMs: 5 }
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()

    const recorder = recordingScraper(() =>
      Effect.promise(async () => {
        started.resolve()
        await gate.promise

        return {
          links: [],
          entityMeta: { title: 'Lost Heartbeat', artistName: 'Artist', type: 'song' },
        }
      }),
    )

    const resolution = Effect.runPromiseExit(
      serviceEffect(
        recorder.service,
        (service) =>
          service.resolveSource({
            url: sourceUrl,
            expectedType: 'track',
            origin: 'editorial',
            artworkDelivery: 'preserve',
          }),
        leaseTiming,
      ),
    )

    await started.promise
    await db
      .update(musicSourceIdentitiesTable)
      .set({ ownerToken: crypto.randomUUID() })
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))
    const exit = await resolution
    gate.resolve()

    const entities = await db
      .select()
      .from(musicTracksTable)
      .where(eq(musicTracksTable.title, 'Lost Heartbeat'))

    const error = Result.getOrThrow(Exit.findError(exit))
    expect(error._tag).toBe('MusicIdentityBusy')
    expect(error).toMatchObject({
      retryAfterMs: leaseTiming.leaseMs,
    })
    expect(entities).toHaveLength(0)
  })

  test('returns a typed busy error for a live lease without scraping', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: `spotify:track:${id}`,
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: id,
      canonicalUrl: sourceUrl,
      state: 'resolving',
      ownerToken: crypto.randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const exit = await serviceExitWith(recorder.service, (service) =>
      service.resolveSource({
        url: sourceUrl,
        expectedType: 'track',
        origin: 'editorial',
        artworkDelivery: 'preserve',
      }),
    )

    expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityBusy')
    expect(recorder.calls).toHaveLength(0)
  }, 15_000)

  test('prevents a lost lease owner from creating entity or link rows', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    const source = await Effect.runPromise(parseMusicSource(sourceUrl, 'track'))
    const repository = new CanonicalMusicIdentityRepository(db)
    const ownerToken = crypto.randomUUID()
    const replacementToken = crypto.randomUUID()
    const now = new Date()
    await Effect.runPromise(repository.claim(source, ownerToken, now, 30_000))
    await db
      .update(musicSourceIdentitiesTable)
      .set({ ownerToken: replacementToken })
      .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))
    const entityId = crypto.randomUUID()

    const committed = await Effect.runPromise(
      repository.commit({
        ownedSources: [source],
        allSources: [source],
        reference: { entityType: 'track', entityId },
        entity: {
          entityType: 'track',
          entityId,
          title: 'Fenced Track',
          artistNames: [],
          artists: [],
        },
        slug: entityId,
        links: [{ platform: 'spotify', url: sourceUrl, scrapedAt: now }],
        ownerToken,
        scrapedAt: now,
        now,
      }),
    )

    const entities = await db
      .select()
      .from(musicTracksTable)
      .where(eq(musicTracksTable.id, entityId))

    const links = await db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.entityId, entityId))

    expect(committed).toBe(false)
    expect(entities).toHaveLength(0)
    expect(links).toHaveLength(0)
  })

  test('reclaims an expired source lease', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: `spotify:track:${id}`,
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: id,
      canonicalUrl: sourceUrl,
      state: 'resolving',
      ownerToken: crypto.randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 1),
    })

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: { title: 'Reclaimed Track', artistName: 'Artist', type: 'song' },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      service.resolveSource({
        url: sourceUrl,
        expectedType: 'track',
        origin: 'reply',
        artworkDelivery: 'preserve',
      }),
    )

    const identities = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))

    expect(recorder.calls).toHaveLength(1)
    expect(identities[0]).toMatchObject({
      state: 'resolved',
      entityId: result.entity.id,
      ownerToken: null,
    })
  })

  test('reuses an incumbent found through a discovered provider link', async () => {
    const spotifyId = externalId()
    const deezerId = String(Date.now())
    const spotifyUrl = `https://open.spotify.com/track/${spotifyId}`
    const deezerUrl = `https://www.deezer.com/track/${deezerId}`

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [{ platform: 'spotify', url: spotifyUrl, scrapedAt: new Date() }],
        entityMeta: { title: 'Cross Platform', artistName: 'Artist', type: 'song' },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const incumbent = yield* service.importProviderEntity({
          snapshot: snapshot(spotifyUrl),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const discovered = yield* service.resolveSource({
          url: deezerUrl,
          expectedType: 'track',
          origin: 'bluesky',
          artworkDelivery: 'preserve',
        })

        return { incumbent, discovered }
      }),
    )

    expect(recorder.calls).toHaveLength(1)
    expect(result.discovered.entity.id).toBe(result.incumbent.entity.id)
  })

  test('records conflicting discovered identities and does not merge them', async () => {
    const spotifyId = externalId()
    const deezerId = String(Date.now() + 1)
    const youtubeId = externalId()
    const spotifyUrl = `https://open.spotify.com/track/${spotifyId}`
    const deezerUrl = `https://www.deezer.com/track/${deezerId}`
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [
          { platform: 'spotify', url: spotifyUrl, scrapedAt: new Date() },
          { platform: 'deezer', url: deezerUrl, scrapedAt: new Date() },
        ],
        entityMeta: { title: 'Collision', artistName: 'Artist', type: 'song' },
      }),
    )

    const exit = await serviceExitWith(recorder.service, (service) =>
      Effect.gen(function* () {
        yield* service.importProviderEntity({
          snapshot: snapshot(spotifyUrl, 'Spotify Entity'),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })
        yield* service.importProviderEntity({
          snapshot: snapshot(deezerUrl, 'Deezer Entity'),
          origin: 'playlist_enrichment',
          artworkDelivery: 'preserve',
        })

        return yield* service.resolveSource({
          url: youtubeUrl,
          expectedType: 'track',
          origin: 'tweet',
          artworkDelivery: 'preserve',
        })
      }),
    )

    const conflicts = await db.select().from(musicSourceIdentityConflictsTable)
    const error = Result.getOrThrow(Exit.findError(exit))

    expect(error._tag).toBe('MusicIdentityConflict')
    expect(conflicts.some((conflict) => conflict.reason === 'discovered_sources_disagree')).toBe(
      true,
    )
  })

  test('releases its source claim after provider failure', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`

    const scraper: MusicLinkScraperService = {
      scrape: () =>
        Effect.fail(
          new MusicScraperError({
            message: 'Unavailable',
            provider: 'spotify',
          }),
        ),
      discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
    }

    const exit = await serviceExitWith(scraper, (service) =>
      service.resolveSource({
        url: sourceUrl,
        expectedType: 'track',
        origin: 'editorial',
        artworkDelivery: 'preserve',
      }),
    )

    const identities = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))

    expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityProviderUnavailable')
    expect(identities).toHaveLength(0)
  })

  test('rejects manual attachment when another entity owns the identity', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    const candidateId = crypto.randomUUID()
    await db.insert(musicTracksTable).values({
      id: candidateId,
      title: 'Candidate',
      slug: candidateId,
    })
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const exit = await serviceExitWith(recorder.service, (service) =>
      Effect.gen(function* () {
        yield* service.importProviderEntity({
          snapshot: snapshot(sourceUrl),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        return yield* service.attachLink({
          entityType: 'track',
          entityId: candidateId,
          platform: 'spotify',
          url: sourceUrl,
          origin: 'manual',
        })
      }),
    )

    const candidateLinks = await db
      .select()
      .from(musicEntityLinksTable)
      .where(
        and(
          eq(musicEntityLinksTable.entityType, 'track'),
          eq(musicEntityLinksTable.entityId, candidateId),
        ),
      )

    expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityConflict')
    expect(candidateLinks).toHaveLength(0)
  })

  test('imports trusted snapshots without calling a provider', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const result = await serviceWith(recorder.service, (service) =>
      service.importProviderEntity({
        snapshot: snapshot(sourceUrl),
        origin: 'playlist_enrichment',
        artworkDelivery: 'preserve',
      }),
    )

    expect(result.created).toBe(true)
    expect(result.entity.id).toBeTruthy()
    expect(recorder.calls).toHaveLength(0)
  })

  test('lazy provider imports return canonical hits before loading and load misses once', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const recorder = recordingScraper(() => Effect.die('scraper must not be called'))
    let loads = 0

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const first = yield* service.importProviderEntityLazy({
          entityType: 'track',
          sourceUrl,
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
          loadSnapshot: Effect.sync(() => {
            loads += 1

            return snapshot(sourceUrl, 'Lazy track')
          }),
        })

        const second = yield* service.importProviderEntityLazy({
          entityType: 'track',
          sourceUrl,
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
          loadSnapshot: Effect.sync(() => {
            loads += 1

            return snapshot(sourceUrl, 'Should not load')
          }),
        })

        return { first, second }
      }),
    )

    expect(loads).toBe(1)
    expect(result.second.entity.id).toBe(result.first.entity.id)
  })

  test('validates a manual link platform against the parsed source platform', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const entityId = crypto.randomUUID()
    await db
      .insert(musicTracksTable)
      .values({ id: entityId, title: 'Manual target', slug: entityId })
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const exit = await serviceExitWith(recorder.service, (service) =>
      service.attachLink({
        entityType: 'track',
        entityId,
        platform: 'deezer',
        url: sourceUrl,
        origin: 'manual',
      }),
    )

    const error = Result.getOrThrow(Exit.findError(exit))
    expect(error._tag).toBe('MusicSourceInvalid')
    expect(error).toMatchObject({
      reason: 'platform_mismatch',
    })
    expect(
      await db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, entityId)),
    ).toHaveLength(0)
  })

  test('rejecting or deleting exact-source links releases canonical identities and aliases', async () => {
    const rejectedUrl = `https://open.spotify.com/track/${externalId()}`
    const deletedUrl = `https://open.spotify.com/track/${externalId()}`
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const rejected = yield* service.importProviderEntity({
          snapshot: snapshot(rejectedUrl, 'Rejected source'),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const deleted = yield* service.importProviderEntity({
          snapshot: snapshot(deletedUrl, 'Deleted source'),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const rejectedLink = rejected.links.find((link) => link.platform === 'spotify')
        const deletedLink = deleted.links.find((link) => link.platform === 'spotify')

        if (!rejectedLink || !deletedLink) return yield* Effect.die('Expected source links')

        const updated = yield* service.releaseLink({
          entityType: 'track',
          entityId: rejected.entity.id,
          linkId: rejectedLink.id,
          action: 'reject',
        })

        yield* service.releaseLink({
          entityType: 'track',
          entityId: deleted.entity.id,
          linkId: deletedLink.id,
          action: 'delete',
        })

        return { rejected, deleted, updated }
      }),
    )

    const sourceKeys = new Set([
      (await Effect.runPromise(parseMusicSource(rejectedUrl, 'track'))).sourceKey,
      (await Effect.runPromise(parseMusicSource(deletedUrl, 'track'))).sourceKey,
    ])

    const identities = await db.select().from(musicSourceIdentitiesTable)
    const aliases = await db.select().from(musicSourceAliasesTable)
    expect(result.updated?.status).toBe('rejected')
    expect(identities.some((identity) => sourceKeys.has(identity.sourceKey))).toBe(false)
    expect(aliases.some((alias) => sourceKeys.has(alias.sourceKey))).toBe(false)
    expect(
      await db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, result.deleted.entity.id)),
    ).toHaveLength(0)
  })

  test('reattaching a rejected source restores its canonical identity', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: snapshot(sourceUrl, 'Reverified source'),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const link = imported.links.find((candidate) => candidate.platform === 'spotify')

        if (!link) return yield* Effect.die('Expected source link')
        yield* service.releaseLink({
          entityType: 'track',
          entityId: imported.entity.id,
          linkId: link.id,
          action: 'reject',
        })

        const reattached = yield* service.attachLink({
          entityType: 'track',
          entityId: imported.entity.id,
          platform: 'spotify',
          url: sourceUrl,
          origin: 'manual',
        })

        return { imported, reattached }
      }),
    )

    const source = await Effect.runPromise(parseMusicSource(sourceUrl, 'track'))

    const identities = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))

    expect(result.reattached.status).toBe('verified')
    expect(identities).toHaveLength(1)
    expect(identities[0]?.entityId).toBe(result.imported.entity.id)
  })

  test('automatic enrichment retries missing links and skips completed enrichment', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const deezerUrl = `https://www.deezer.com/track/${Date.now() + 500}`
    let calls = 0

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Automatic enrichment must not refresh provider metadata'),
      discoverCrossPlatformLinks: () => {
        calls += 1

        return calls === 1
          ? Effect.fail(
              new MusicScraperError({
                message: 'temporary outage',
                provider: 'odesli',
                statusCode: 503,
              }),
            )
          : Effect.succeed({
              links: [{ platform: 'deezer', url: deezerUrl, scrapedAt: new Date() }],
            })
      },
    }

    const result = await serviceWith(scraper, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: snapshot(sourceUrl),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const input: RefreshMusicEntity = {
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: 'playlist_enrichment',
          origin: 'playlist_enrichment',
          artworkDelivery: 'preserve',
        }

        yield* service.enrichEntity(input).pipe(Effect.catch(() => Effect.void))
        yield* service.enrichEntity(input)

        return yield* service.enrichEntity(input)
      }),
    )

    expect(calls).toBe(2)
    expect(result.links.some((link) => link.platform === 'deezer')).toBe(true)
  })

  test('automatic enrichment selects the earliest exact source without replacing canonical metadata', async () => {
    const spotifyUrl = `https://open.spotify.com/track/${externalId()}`
    const deezerUrl = `https://www.deezer.com/track/${Date.now() + 600}`
    const youtubeUrl = `https://www.youtube.com/watch?v=${externalId()}`
    let receivedInput: MusicScrapeInput | undefined

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Automatic enrichment must not refresh provider metadata'),
      discoverCrossPlatformLinks: (input) => {
        receivedInput = input

        return Effect.succeed({
          links: [{ platform: 'youtube', url: youtubeUrl, scrapedAt: new Date() }],
          entityMeta: {
            title: 'Discovered Title',
            artistName: 'Discovered Artist',
            type: 'song',
          },
        })
      },
    }

    const result = await serviceWith(scraper, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: {
            ...snapshot(spotifyUrl, 'Canonical Title', [
              {
                platform: 'deezer',
                url: deezerUrl,
                scrapedAt: new Date('2020-01-01T00:00:00.000Z'),
                metadata: { discoveredBy: 'deezer', confidence: 'exact_source' },
              },
            ]),
            artistNames: ['Canonical Artist'],
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const enriched = yield* service.enrichEntity({
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: 'playlist_enrichment',
          origin: 'playlist_enrichment',
          artworkDelivery: 'preserve',
        })

        return { imported, enriched }
      }),
    )

    expect(receivedInput).toEqual({
      entityType: 'track',
      url: deezerUrl,
      trackTitle: 'Canonical Title',
      artistName: 'Canonical Artist',
    })
    expect(result.enriched.entity.id).toBe(result.imported.entity.id)
    expect('title' in result.enriched.entity ? result.enriched.entity.title : '').toBe(
      'Canonical Title',
    )
    expect(
      'artistNames' in result.enriched.entity ? result.enriched.entity.artistNames : [],
    ).toEqual(['Canonical Artist'])
    expect(result.enriched.links.some((link) => link.platform === 'youtube')).toBe(true)
  })

  test('administrator refresh selects the earliest exact source and replaces canonical metadata', async () => {
    const spotifyUrl = `https://open.spotify.com/track/${externalId()}`
    const deezerUrl = `https://www.deezer.com/track/${Date.now() + 700}`

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: { title: 'Refreshed Title', artistName: 'Refreshed Artist', type: 'song' },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: {
            ...snapshot(spotifyUrl, 'Canonical Title', [
              {
                platform: 'deezer',
                url: deezerUrl,
                scrapedAt: new Date('2020-01-01T00:00:00.000Z'),
                metadata: { discoveredBy: 'deezer', confidence: 'exact_source' },
              },
            ]),
            artistNames: ['Canonical Artist'],
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const refreshed = yield* service.refreshEntity({
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: 'admin',
          origin: 'manual',
          artworkDelivery: 'preserve',
        })

        return { imported, refreshed }
      }),
    )

    expect(recorder.calls).toEqual([{ entityType: 'track', url: deezerUrl }])
    expect(result.refreshed.entity.id).toBe(result.imported.entity.id)
    expect('title' in result.refreshed.entity ? result.refreshed.entity.title : '').toBe(
      'Refreshed Title',
    )
    expect(
      'artistNames' in result.refreshed.entity ? result.refreshed.entity.artistNames : [],
    ).toEqual(['Refreshed Artist'])
  })

  test('refresh keeps stored artwork until a fetched replacement can be promoted', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const storedArtwork = 'https://cdn.example.com/user-content/music/track/cover'
    const providerArtwork = 'https://i.scdn.co/image/replacement'

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: { title: 'Refreshed', type: 'song', thumbnailUrl: providerArtwork },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: { ...snapshot(sourceUrl), imageUrl: storedArtwork },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        return yield* service.refreshEntity({
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: 'admin',
          origin: 'manual',
          artworkDelivery: 'preserve',
        })
      }),
    )

    expect('coverImageUrl' in result.entity && result.entity.coverImageUrl).toBe(storedArtwork)
  })

  test('infers artist and playlist types when the caller does not specify one', async () => {
    const cases = [
      {
        entityType: 'artist' as const,
        sourceUrl: `https://open.spotify.com/artist/${externalId()}`,
        title: 'Inferred Artist',
      },
      {
        entityType: 'playlist' as const,
        sourceUrl: `https://open.spotify.com/playlist/${externalId()}`,
        title: 'Inferred Playlist',
      },
    ]

    const recorder = recordingScraper((input) => {
      const current = cases.find((candidate) => candidate.sourceUrl === input.url)

      if (!current) return Effect.die('Unexpected source')

      return Effect.succeed({
        links: [],
        entityMeta: { title: current.title, type: current.entityType },
      })
    })

    const results = await serviceWith(recorder.service, (service) =>
      Effect.forEach(cases, (candidate) =>
        service.resolveSource({
          url: candidate.sourceUrl,
          origin: 'bluesky',
          artworkDelivery: 'preserve',
        }),
      ),
    )

    expect(results.map((result) => result.entityType)).toEqual(['artist', 'playlist'])
  })

  test('keeps existing data intact when refresh provider resolution fails', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`

    const scraper: MusicLinkScraperService = {
      scrape: () =>
        Effect.fail(
          new MusicScraperError({
            message: 'Refresh unavailable',
            provider: 'spotify',
          }),
        ),
      discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
    }

    const exit = await serviceExitWith(scraper, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: snapshot(sourceUrl, 'Original Title'),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        return yield* service.refreshEntity({
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: crypto.randomUUID(),
          origin: 'manual',
          artworkDelivery: 'preserve',
        })
      }),
    )

    const identities = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${id}`))

    const identity = identities[0]

    const entities = identity?.entityId
      ? await db.select().from(musicTracksTable).where(eq(musicTracksTable.id, identity.entityId))
      : []

    expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityProviderUnavailable')
    expect(entities[0]?.title).toBe('Original Title')
  })

  test('adopts canonical legacy link variants without scraping', async () => {
    const spotifyId = externalId()
    const youtubeId = externalId()
    const deezerId = String(Date.now() + 50)

    const variants = [
      {
        platform: 'spotify' as const,
        stored: `https://open.spotify.com/intl-en/track/${spotifyId}?si=legacy`,
        requested: `https://open.spotify.com/track/${spotifyId}`,
      },
      {
        platform: 'youtube' as const,
        stored: `https://youtu.be/${youtubeId}?feature=shared`,
        requested: `https://www.youtube.com/watch?v=${youtubeId}`,
      },
      {
        platform: 'deezer' as const,
        stored: `https://www.deezer.com/us/track/${deezerId}`,
        requested: `https://www.deezer.com/track/${deezerId}`,
      },
    ]

    for (const variant of variants) {
      const entityId = crypto.randomUUID()
      await db.insert(musicTracksTable).values({
        id: entityId,
        title: `Legacy ${variant.platform}`,
        slug: entityId,
      })
      await db.insert(musicEntityLinksTable).values({
        entityType: 'track',
        entityId,
        platform: variant.platform,
        url: variant.stored,
      })
    }

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: { title: 'Refreshed legacy track', type: 'song' },
      }),
    )

    const results = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.forEach(variants, (variant) =>
          service.resolveSource({
            url: variant.requested,
            expectedType: 'track',
            origin: 'editorial',
            artworkDelivery: 'preserve',
          }),
        )

        expect(recorder.calls).toHaveLength(0)
        yield* Effect.forEach(resolved, (result) =>
          service.refreshEntity({
            entityType: 'track',
            entityId: result.entity.id,
            actorId: 'legacy-refresh',
            origin: 'manual',
            artworkDelivery: 'preserve',
          }),
        )

        return resolved
      }),
    )

    expect(recorder.calls).toHaveLength(3)
    expect(results).toHaveLength(3)

    for (const variant of variants) {
      const parsed = await Effect.runPromise(parseMusicSource(variant.requested, 'track'))

      const identities = await db
        .select()
        .from(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, parsed.sourceKey))

      expect(identities[0]).toMatchObject({ state: 'resolved' })
    }
  })

  test('resolves crossing source claims by deterministic source-key priority', async () => {
    const spotifyUrl = `https://open.spotify.com/track/${externalId()}`
    const deezerUrl = `https://www.deezer.com/track/${String(Date.now() + 60)}`
    const bothStarted = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    let starts = 0

    const recorder = recordingScraper(() =>
      Effect.promise(async () => {
        starts += 1

        if (starts === 2) bothStarted.resolve()
        await gate.promise

        return {
          links: [
            { platform: 'spotify', url: spotifyUrl, scrapedAt: new Date() },
            { platform: 'deezer', url: deezerUrl, scrapedAt: new Date() },
          ],
          entityMeta: { title: 'Crossing Claims', artistName: 'Shared Artist', type: 'song' },
        }
      }),
    )

    const spotify = serviceWith(recorder.service, (service) =>
      service.resolveSource({
        url: spotifyUrl,
        expectedType: 'track',
        origin: 'editorial',
        artworkDelivery: 'preserve',
      }),
    )

    const deezer = serviceWith(recorder.service, (service) =>
      service.resolveSource({
        url: deezerUrl,
        expectedType: 'track',
        origin: 'tweet',
        artworkDelivery: 'preserve',
      }),
    )

    await bothStarted.promise
    gate.resolve()

    const [spotifyResult, deezerResult] = await Promise.all([spotify, deezer])

    expect(recorder.calls).toHaveLength(2)
    expect(spotifyResult.entity.id).toBe(deezerResult.entity.id)
  })

  test('does not duplicate the retry-zero claim after a discovered source is busy', async () => {
    const exporter = new InMemorySpanExporter()

    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    provider.register()

    const tracingLive = OtelTracer.layerGlobal.pipe(
      Layer.provide(Resource.layer({ serviceName: 'music-identity-claim-test' })),
    )

    const spotifyUrl = `https://open.spotify.com/track/${externalId()}`
    const deezerUrl = `https://www.deezer.com/track/${String(Date.now() + 65)}`
    const deezerSource = await Effect.runPromise(parseMusicSource(deezerUrl, 'track'))
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: deezerSource.sourceKey,
      platform: deezerSource.platform,
      sourceEntityType: deezerSource.sourceEntityType,
      externalId: deezerSource.externalId,
      canonicalUrl: deezerSource.canonicalUrl,
      state: 'resolving',
      ownerToken: crypto.randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [
          { platform: 'spotify', url: spotifyUrl, scrapedAt: new Date() },
          { platform: 'deezer', url: deezerUrl, scrapedAt: new Date() },
        ],
        entityMeta: { title: 'Busy Discovery', artistName: 'Artist', type: 'song' },
      }),
    )

    try {
      const exit = await Effect.runPromiseExit(
        withTestLayer(
          serviceEffect(
            recorder.service,
            (service) =>
              service.resolveSource({
                url: spotifyUrl,
                expectedType: 'track',
                origin: 'editorial',
                artworkDelivery: 'preserve',
              }),
            { leaseMs: 30_000, waitAttempts: 0, waitMs: 1 },
          ),
          tracingLive,
        ),
      )

      await provider.forceFlush()

      expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityBusy')

      const claims = exporter
        .getFinishedSpans()
        .filter((span) => span.name === 'musicIdentity.claim')

      expect(claims).toHaveLength(2)
      expect(claims.map((span) => span.attributes.retryCount)).toEqual([0, 0])
    } finally {
      await provider.shutdown()
      trace.disable()
    }
  })

  test('fences every write when a secondary source claim is lost', async () => {
    const spotifyUrl = `https://open.spotify.com/track/${externalId()}`
    const deezerUrl = `https://www.deezer.com/track/${String(Date.now() + 70)}`
    const spotifySource = await Effect.runPromise(parseMusicSource(spotifyUrl, 'track'))
    const deezerSource = await Effect.runPromise(parseMusicSource(deezerUrl, 'track'))
    const repository = new CanonicalMusicIdentityRepository(db)
    const ownerToken = crypto.randomUUID()
    const now = new Date()
    await Effect.runPromise(repository.claim(spotifySource, ownerToken, now, 30_000))
    await Effect.runPromise(repository.claim(deezerSource, ownerToken, now, 30_000))
    await db
      .update(musicSourceIdentitiesTable)
      .set({ ownerToken: crypto.randomUUID() })
      .where(eq(musicSourceIdentitiesTable.sourceKey, deezerSource.sourceKey))
    const entityId = crypto.randomUUID()

    const committed = await Effect.runPromise(
      repository.commit({
        ownedSources: [spotifySource, deezerSource],
        allSources: [spotifySource, deezerSource],
        reference: { entityType: 'track', entityId },
        entity: {
          entityType: 'track',
          entityId,
          title: 'Secondary Fence',
          artistNames: [],
          artists: [],
        },
        slug: entityId,
        links: [{ platform: 'spotify', url: spotifyUrl, scrapedAt: now }],
        ownerToken,
        scrapedAt: now,
        now,
      }),
    )

    const entities = await db
      .select()
      .from(musicTracksTable)
      .where(eq(musicTracksTable.id, entityId))

    const links = await db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.entityId, entityId))

    const aliases = await db
      .select()
      .from(musicSourceAliasesTable)
      .where(eq(musicSourceAliasesTable.sourceKey, spotifySource.sourceKey))

    expect(committed).toBe(false)
    expect(entities).toHaveLength(0)
    expect(links).toHaveLength(0)
    expect(aliases).toHaveLength(0)
  })

  test('preserves artist reuse, relation order, denormalized names, and public slugs', async () => {
    const albumUrl = `https://open.spotify.com/album/${externalId()}`
    const trackUrl = `https://open.spotify.com/track/${externalId()}`
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const album = yield* service.importProviderEntity({
          snapshot: {
            entityType: 'album',
            sourceUrl: albumUrl,
            title: 'Shared Title',
            artistNames: ['First Artist', 'Second Artist'],
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const track = yield* service.importProviderEntity({
          snapshot: {
            entityType: 'track',
            sourceUrl: trackUrl,
            title: 'Shared Title',
            artistNames: ['first artist', 'Second Artist'],
          },
          origin: 'playlist_enrichment',
          artworkDelivery: 'preserve',
        })

        return { album, track }
      }),
    )

    const artists = await db.select().from(musicArtistsTable)

    const albumRelations = await db
      .select()
      .from(musicAlbumArtistsTable)
      .where(eq(musicAlbumArtistsTable.albumId, result.album.entity.id))
      .orderBy(musicAlbumArtistsTable.displayOrder)

    const trackRelations = await db
      .select()
      .from(musicTrackArtistsTable)
      .where(eq(musicTrackArtistsTable.trackId, result.track.entity.id))
      .orderBy(musicTrackArtistsTable.displayOrder)

    const albums = await db
      .select()
      .from(musicAlbumsTable)
      .where(eq(musicAlbumsTable.id, result.album.entity.id))

    const tracks = await db
      .select()
      .from(musicTracksTable)
      .where(eq(musicTracksTable.id, result.track.entity.id))

    const relatedArtistIds = new Set(
      [...albumRelations, ...trackRelations].map((row) => row.artistId),
    )

    expect([...relatedArtistIds]).toHaveLength(2)
    expect(artists.filter((artist) => relatedArtistIds.has(artist.id))).toHaveLength(2)
    expect(albumRelations.map((row) => row.displayOrder)).toEqual([0, 1])
    expect(trackRelations.map((row) => row.displayOrder)).toEqual([0, 1])
    expect(albums[0]?.artistNames).toEqual(['First Artist', 'Second Artist'])
    expect(tracks[0]?.artistNames).toEqual(['First Artist', 'Second Artist'])
    expect(albums[0]?.slug).toMatch(/^shared-title-[a-f0-9]{8}$/)
    expect(tracks[0]?.slug).toMatch(/^shared-title-[a-f0-9]{8}$/)
  })

  test('preserves snapshot playlist and Spotify import fields', async () => {
    const playlistUrl = `https://open.spotify.com/playlist/${externalId()}`
    const trackUrl = `https://open.spotify.com/track/${externalId()}`
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const playlist = yield* service.importProviderEntity({
          snapshot: {
            entityType: 'playlist',
            sourceUrl: playlistUrl,
            title: 'Imported Playlist',
            description: 'Playlist description',
            sourceMetadata: { spotifyPlaylistId: 'playlist-id' },
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const track = yield* service.importProviderEntity({
          snapshot: {
            entityType: 'track',
            sourceUrl: trackUrl,
            title: 'Imported Track Fields',
            artistNames: ['Artist'],
            trackNumber: 7,
            sourceMetadata: {
              spotifyTrackId: 'track-id',
              durationMs: 1234,
              previewUrl: 'https://example.com/preview.mp3',
              albumName: 'Album',
              albumSpotifyId: 'album-id',
            },
          },
          origin: 'playlist_enrichment',
          artworkDelivery: 'preserve',
        })

        return { playlist, track }
      }),
    )

    expect(
      'description' in result.playlist.entity ? result.playlist.entity.description : null,
    ).toBe('Playlist description')
    expect('trackNumber' in result.track.entity ? result.track.entity.trackNumber : null).toBe(7)
    expect(result.playlist.links[0]?.metadata).toMatchObject({ spotifyPlaylistId: 'playlist-id' })
    expect(result.track.links[0]?.metadata).toMatchObject({
      spotifyTrackId: 'track-id',
      durationMs: 1234,
      albumSpotifyId: 'album-id',
    })
  })

  test('stores the parsed source as canonical exact_source despite provider metadata', async () => {
    const id = externalId()
    const requested = `https://open.spotify.com/intl-en/track/${id}?si=request`

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [
          {
            platform: 'spotify',
            url: `https://open.spotify.com/track/${id}?utm_source=provider`,
            scrapedAt: new Date(),
          },
        ],
        entityMeta: { title: 'Canonical Source', artistName: 'Artist', type: 'song' },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      service.resolveSource({
        url: requested,
        expectedType: 'track',
        origin: 'editorial',
        artworkDelivery: 'preserve',
      }),
    )

    const source = result.links.find((link) => link.platform === 'spotify')

    expect(source?.url).toBe(`https://open.spotify.com/track/${id}`)
    expect(source?.metadata).toMatchObject({ confidence: 'exact_source' })
  })

  test('playlist refresh preserves manually curated non-source links', async () => {
    const sourceUrl = `https://open.spotify.com/playlist/${externalId()}`

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [
          { platform: 'spotify', url: `${sourceUrl}?si=refresh`, scrapedAt: new Date() },
          {
            platform: 'youtube',
            url: `https://www.youtube.com/playlist?list=${externalId()}`,
            scrapedAt: new Date(),
          },
        ],
        entityMeta: { title: 'Refreshed Playlist', type: 'playlist' },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: { entityType: 'playlist', sourceUrl, title: 'Playlist' },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        yield* Effect.tryPromise(() =>
          db.insert(musicEntityLinksTable).values({
            entityType: 'playlist',
            entityId: imported.entity.id,
            platform: 'other',
            url: 'https://example.com/curated-playlist',
            status: 'verified',
            metadata: { discoveredBy: 'manual' },
          }),
        ).pipe(Effect.orDie)

        return yield* service.refreshEntity({
          entityType: 'playlist',
          entityId: imported.entity.id,
          actorId: crypto.randomUUID(),
          origin: 'manual',
          artworkDelivery: 'preserve',
        })
      }),
    )

    expect(result.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'spotify', url: sourceUrl }),
        expect.objectContaining({ platform: 'other', url: 'https://example.com/curated-playlist' }),
      ]),
    )
  })

  test('returns a typed collision for an alias mapped to another parsed source key', async () => {
    const requestedUrl = `https://open.spotify.com/track/${externalId()}`
    const incumbentUrl = `https://open.spotify.com/track/${externalId()}`
    const requested = await Effect.runPromise(parseMusicSource(requestedUrl, 'track'))
    const incumbent = await Effect.runPromise(parseMusicSource(incumbentUrl, 'track'))
    const entityId = crypto.randomUUID()
    const now = new Date()
    await db.insert(musicTracksTable).values({ id: entityId, title: 'Alias Owner', slug: entityId })
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: incumbent.sourceKey,
      platform: incumbent.platform,
      sourceEntityType: incumbent.sourceEntityType,
      externalId: incumbent.externalId,
      canonicalUrl: incumbent.canonicalUrl,
      state: 'resolved',
      entityType: 'track',
      entityId,
      resolvedAt: now,
    })
    await db.insert(musicSourceAliasesTable).values({
      normalizedUrl: requested.normalizedUrl,
      sourceKey: incumbent.sourceKey,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const exit = await serviceExitWith(recorder.service, (service) =>
      service.resolveSource({
        url: requestedUrl,
        expectedType: 'track',
        origin: 'editorial',
        artworkDelivery: 'preserve',
      }),
    )

    const aliases = await db
      .select()
      .from(musicSourceAliasesTable)
      .where(eq(musicSourceAliasesTable.normalizedUrl, requested.normalizedUrl))

    const error = Result.getOrThrow(Exit.findError(exit))
    expect(error._tag).toBe('MusicIdentityAliasCollision')
    expect(error).toMatchObject({
      expectedSourceKey: requested.sourceKey,
      storedSourceKey: incumbent.sourceKey,
    })
    expect(aliases[0]?.sourceKey).toBe(incumbent.sourceKey)
    expect(recorder.calls).toHaveLength(0)
  })

  test('preserves provider rejection versus outage classification', async () => {
    const cases = [
      { statusCode: 400, tag: 'MusicIdentityProviderRejected', reason: 'invalid_request' },
      { statusCode: 404, tag: 'MusicIdentityProviderRejected', reason: 'not_found' },
      { statusCode: 503, tag: 'MusicIdentityProviderUnavailable', reason: undefined },
    ] as const

    for (const item of cases) {
      const scraper: MusicLinkScraperService = {
        scrape: () =>
          Effect.fail(
            new MusicScraperError({
              message: 'Provider response',
              provider: 'spotify',
              statusCode: item.statusCode,
            }),
          ),
        discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
      }

      const exit = await serviceExitWith(scraper, (service) =>
        service.resolveSource({
          url: `https://open.spotify.com/track/${externalId()}`,
          expectedType: 'track',
          origin: 'editorial',
          artworkDelivery: 'preserve',
        }),
      )

      const error = Result.getOrThrow(Exit.findError(exit))
      expect(error._tag).toBe(item.tag)
      expect('reason' in error ? error.reason : undefined).toBe(item.reason)
    }
  })

  test('delete during attach cannot create a link, alias, or completed identity', async () => {
    const id = externalId()
    const sourceUrl = `https://open.spotify.com/track/${id}`
    const source = await Effect.runPromise(parseMusicSource(sourceUrl, 'track'))
    const entityId = crypto.randomUUID()
    await db
      .insert(musicTracksTable)
      .values({ id: entityId, title: 'Attach Target', slug: entityId })
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: source.sourceKey,
      platform: source.platform,
      sourceEntityType: source.sourceEntityType,
      externalId: source.externalId,
      canonicalUrl: source.canonicalUrl,
      state: 'resolving',
      ownerToken: crypto.randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const recorder = recordingScraper(() => Effect.die('provider must not be called'))

    const attaching = serviceExitWith(recorder.service, (service) =>
      service.attachLink({
        entityType: 'track',
        entityId,
        platform: 'spotify',
        url: sourceUrl,
        origin: 'manual',
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    await db.batch([
      db.delete(musicTracksTable).where(eq(musicTracksTable.id, entityId)),
      db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey)),
    ])
    const exit = await attaching

    const links = await db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.entityId, entityId))

    const aliases = await db
      .select()
      .from(musicSourceAliasesTable)
      .where(eq(musicSourceAliasesTable.normalizedUrl, source.normalizedUrl))

    const identities = await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))

    expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityEntityNotFound')
    expect(links).toHaveLength(0)
    expect(aliases).toHaveLength(0)
    expect(identities.every((identity) => identity.state !== 'resolved')).toBe(true)
  })

  test('delete during refresh cannot recreate links or update a missing target', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()

    const recorder = recordingScraper(() =>
      Effect.promise(async () => {
        started.resolve()
        await gate.promise

        return {
          links: [
            {
              platform: 'deezer',
              url: `https://www.deezer.com/track/${String(Date.now() + 80)}`,
              scrapedAt: new Date(),
            },
          ],
          entityMeta: { title: 'Deleted Refresh', artistName: 'Artist', type: 'song' },
        }
      }),
    )

    const imported = await serviceWith(recorder.service, (service) =>
      service.importProviderEntity({
        snapshot: snapshot(sourceUrl, 'Delete During Refresh'),
        origin: 'spotify_import',
        artworkDelivery: 'preserve',
      }),
    )

    const refresh = serviceExitWith(recorder.service, (service) =>
      service.refreshEntity({
        entityType: 'track',
        entityId: imported.entity.id,
        actorId: crypto.randomUUID(),
        origin: 'manual',
        artworkDelivery: 'preserve',
      }),
    )

    await started.promise
    await db.delete(musicTracksTable).where(eq(musicTracksTable.id, imported.entity.id))
    gate.resolve()
    const exit = await refresh

    const newLinks = await db
      .select()
      .from(musicEntityLinksTable)
      .where(
        and(
          eq(musicEntityLinksTable.entityId, imported.entity.id),
          eq(musicEntityLinksTable.platform, 'deezer'),
        ),
      )

    expect(Result.getOrThrow(Exit.findError(exit))._tag).toBe('MusicIdentityEntityNotFound')
    expect(newLinks).toHaveLength(0)
  })

  test('entity deletion removes canonical identities and aliases for every music entity type', async () => {
    const sources = {
      artist: `https://open.spotify.com/artist/${externalId()}`,
      album: `https://open.spotify.com/album/${externalId()}`,
      track: `https://open.spotify.com/track/${externalId()}`,
      playlist: `https://open.spotify.com/playlist/${externalId()}`,
    }

    const recorder = recordingScraper(() => Effect.succeed({ links: [] }))

    const imported = await serviceWith(recorder.service, (service) =>
      Effect.all({
        artist: service.importProviderEntity({
          snapshot: { entityType: 'artist', sourceUrl: sources.artist, title: 'Delete Artist' },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        }),
        album: service.importProviderEntity({
          snapshot: { entityType: 'album', sourceUrl: sources.album, title: 'Delete Album' },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        }),
        track: service.importProviderEntity({
          snapshot: { entityType: 'track', sourceUrl: sources.track, title: 'Delete Track' },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        }),
        playlist: service.importProviderEntity({
          snapshot: {
            entityType: 'playlist',
            sourceUrl: sources.playlist,
            title: 'Delete Playlist',
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        }),
      }),
    )

    const provideDb = Effect.provideService(Database, db)

    await Effect.runPromise(
      Effect.all([
        deleteArtistEffect(imported.artist.entity.id),
        deleteAlbumEffect(imported.album.entity.id),
        deleteTrackEffect(imported.track.entity.id),
        deletePlaylistEffect(imported.playlist.entity.id),
      ]).pipe(provideDb),
    )

    const deletedEntityIds = new Set(Object.values(imported).map((result) => result.entity.id))

    const deletedSourceKeys = new Set(
      Object.entries(sources).map(
        ([entityType, sourceUrl]) =>
          `spotify:${entityType}:${sourceUrl.slice(sourceUrl.lastIndexOf('/') + 1)}`,
      ),
    )

    const identities = await db.select().from(musicSourceIdentitiesTable)
    const aliases = await db.select().from(musicSourceAliasesTable)

    expect(
      identities.some(
        (identity) =>
          deletedSourceKeys.has(identity.sourceKey) ||
          (identity.entityId !== null && deletedEntityIds.has(identity.entityId)),
      ),
    ).toBe(false)
    expect(aliases.some((alias) => deletedSourceKeys.has(alias.sourceKey))).toBe(false)
  })

  test('explicit refresh always calls the provider and preserves the entity ID', async () => {
    const sourceUrl = `https://open.spotify.com/track/${externalId()}`

    const recorder = recordingScraper(() =>
      Effect.succeed({
        links: [],
        entityMeta: { title: 'Refreshed Title', artistName: 'Artist', type: 'song' },
      }),
    )

    const result = await serviceWith(recorder.service, (service) =>
      Effect.gen(function* () {
        const imported = yield* service.importProviderEntity({
          snapshot: snapshot(sourceUrl, 'Original Title', [
            {
              platform: 'spotify',
              url: sourceUrl,
              metadata: { discoveredBy: 'spotify', confidence: 'exact_source' },
            },
          ]),
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const first = yield* service.refreshEntity({
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: crypto.randomUUID(),
          origin: 'manual',
          artworkDelivery: 'preserve',
        })

        const second = yield* service.refreshEntity({
          entityType: 'track',
          entityId: imported.entity.id,
          actorId: crypto.randomUUID(),
          origin: 'manual',
          artworkDelivery: 'preserve',
        })

        return { imported, first, second }
      }),
    )

    expect(recorder.calls).toHaveLength(2)
    expect(result.first.entity.id).toBe(result.imported.entity.id)
    expect(result.second.entity.id).toBe(result.imported.entity.id)
    expect('title' in result.second.entity ? result.second.entity.title : '').toBe(
      'Refreshed Title',
    )
  })
})
