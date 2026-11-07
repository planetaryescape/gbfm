import { eq } from 'drizzle-orm'
import { Effect, Exit, Layer } from 'effect'
import { beforeAll, describe, expect, test } from 'vitest'

import { Database } from '@/db/layer'
import {
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import {
  CanonicalMusicIdentity,
  CanonicalMusicIdentityLayer,
  type CanonicalMusicIdentityService,
} from '@/services/canonical-music-identity'
import { MusicIdentityAuthorizationFailed } from '@/services/canonical-music-identity/errors'
import { ConfigService, createConfig } from '@/services/config.service'
import {
  MusicLinkScraperService,
  MusicScraperError,
  type MusicScrapeInput,
} from '@/services/music-link-scraper.service'
import { S3Service } from '@/services/s3.service'
import type {
  SpotifyImportPlaylist,
  SpotifyImportTrack,
  SpotifyService,
} from '@/services/spotify.service'
import { db } from '@/test/d1'
import { withTestLayer } from '@/test/effect'
import { makeTestS3Service } from '@/test/s3'

import {
  addSpotifyTrackToPlaylistEffect,
  enrichPlaylistLinksEffect,
  importSpotifyPlaylistEffect,
  syncPlaylistLinksEffect,
  type PlaylistExecutionProgress,
} from './playlist-tracks.service'

const externalId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 22)

let nextDeezerId = Date.now()

const deezerId = () => String(nextDeezerId++)

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
    ])
    .onConflictDoNothing()
})

const trackFixture = (spotifyTrackId: string): SpotifyImportTrack => ({
  spotifyTrackId,
  title: 'Imported track',
  artistNames: ['Artist'],
  artistSpotifyIds: [],
  albumName: null,
  albumSpotifyId: null,
  albumImageUrl: null,
  trackUrl: `https://open.spotify.com/track/${spotifyTrackId}`,
  previewUrl: null,
  durationMs: null,
  trackNumber: null,
})

const runWithIdentity = <A, E>(
  scraper: MusicLinkScraperService,
  use: (identity: CanonicalMusicIdentityService) => Effect.Effect<A, E, Database>,
) => {
  const dependencies = Layer.mergeAll(
    Layer.succeed(Database, db),
    Layer.succeed(MusicLinkScraperService, scraper),
    Layer.succeed(ConfigService, createConfig()),
    Layer.succeed(S3Service, makeTestS3Service()),
  )

  const identityLayer = CanonicalMusicIdentityLayer.pipe(Layer.provide(dependencies))

  return Effect.runPromise(
    withTestLayer(
      Effect.flatMap(CanonicalMusicIdentity, use).pipe(Effect.provideService(Database, db)),
      identityLayer,
    ),
  )
}

type PlaylistTrackSeed = {
  readonly trackId: string
  readonly spotifyTrackId: string
  readonly additionalExactDeezerUrl?: string
}

const seedPreBackfillPlaylist = async (
  playlistId: string,
  spotifyPlaylistId: string,
  tracks: ReadonlyArray<PlaylistTrackSeed>,
) => {
  await db.insert(musicPlaylistsTable).values({
    id: playlistId,
    title: 'Pre-backfill playlist',
    slug: playlistId,
  })
  await db.insert(musicTracksTable).values(
    tracks.map((track) => ({
      id: track.trackId,
      title: `Track ${track.spotifyTrackId}`,
      artistNames: ['Artist'],
      slug: track.trackId,
    })),
  )
  await db
    .insert(musicPlaylistTracksTable)
    .values(tracks.map((track, position) => ({ playlistId, trackId: track.trackId, position })))
  await db.insert(musicEntityLinksTable).values([
    {
      entityType: 'playlist',
      entityId: playlistId,
      platform: 'spotify',
      url: `https://open.spotify.com/playlist/${spotifyPlaylistId}`,
    },
    ...tracks.flatMap((track) => [
      {
        entityType: 'track' as const,
        entityId: track.trackId,
        platform: 'spotify' as const,
        url: `https://open.spotify.com/track/${track.spotifyTrackId}`,
        metadata: { confidence: 'exact_source' as const },
      },
      ...(track.additionalExactDeezerUrl
        ? [
            {
              entityType: 'track' as const,
              entityId: track.trackId,
              platform: 'deezer' as const,
              url: track.additionalExactDeezerUrl,
              metadata: { confidence: 'exact_source' as const },
            },
          ]
        : []),
    ]),
  ])
}

describe('playlist Spotify caller migration', () => {
  test('checks canonical track identity before invoking the Spotify detail loader', async () => {
    const spotifyTrackId = externalId()
    const track = trackFixture(spotifyTrackId)
    const playlistId = crypto.randomUUID()
    await db.insert(musicPlaylistsTable).values({
      id: playlistId,
      title: 'Target playlist',
      slug: playlistId,
    })
    let providerCalls = 0

    const spotify: Pick<SpotifyService, 'getTrackForImport'> = {
      getTrackForImport: () => {
        providerCalls += 1

        return Effect.die('Canonical hit must not invoke Spotify')
      },
    }

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Canonical hit must not scrape'),
      discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
    }

    const result = await runWithIdentity(scraper, (identity) =>
      Effect.gen(function* () {
        yield* identity.importProviderEntity({
          snapshot: {
            entityType: 'track',
            sourceUrl: track.trackUrl,
            title: track.title,
            artistNames: track.artistNames,
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        return yield* addSpotifyTrackToPlaylistEffect(spotify, identity)(
          playlistId,
          `${track.trackUrl}?si=test`,
        )
      }),
    )

    expect(providerCalls).toBe(0)
    expect(result.created).toBe(false)
  })

  test('continues track enrichment when a pre-backfill playlist lacks exact-source metadata', async () => {
    const playlistId = crypto.randomUUID()
    const spotifyPlaylistId = externalId()
    const trackId = crypto.randomUUID()
    const spotifyTrackId = externalId()
    const discoveredDeezerId = deezerId()
    await seedPreBackfillPlaylist(playlistId, spotifyPlaylistId, [{ trackId, spotifyTrackId }])
    const inputs: Array<MusicScrapeInput> = []

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Playlist refresh should be skipped without exact-source metadata'),
      discoverCrossPlatformLinks: (input) => {
        inputs.push(input)

        return Effect.succeed({
          links: [
            {
              platform: 'deezer',
              url: `https://www.deezer.com/track/${discoveredDeezerId}`,
              scrapedAt: new Date(),
            },
          ],
        })
      },
    }

    const result = await runWithIdentity(scraper, (identity) =>
      Effect.gen(function* () {
        return yield* syncPlaylistLinksEffect(identity)(playlistId)
      }),
    )

    expect(result).toEqual({ playlistId, trackCount: 1, insertedCount: 1 })
    expect(inputs.map((input) => input.url)).toEqual([
      `https://open.spotify.com/track/${spotifyTrackId}`,
    ])

    const links = await db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.entityId, trackId))

    expect(links.some((link) => link.platform === 'deezer')).toBe(true)
  })

  test('continues enriching later tracks after a checked track failure', async () => {
    const playlistId = crypto.randomUUID()
    const spotifyPlaylistId = externalId()
    const failingTrackId = crypto.randomUUID()
    const failingSpotifyTrackId = externalId()
    const laterTrackId = crypto.randomUUID()
    const laterSpotifyTrackId = externalId()
    const laterDiscoveredDeezerUrl = `https://www.deezer.com/track/${deezerId()}`
    await seedPreBackfillPlaylist(playlistId, spotifyPlaylistId, [
      {
        trackId: failingTrackId,
        spotifyTrackId: failingSpotifyTrackId,
        additionalExactDeezerUrl: `https://www.deezer.com/track/${deezerId()}`,
      },
      { trackId: laterTrackId, spotifyTrackId: laterSpotifyTrackId },
    ])
    const inputs: Array<MusicScrapeInput> = []

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Playlist refresh should be skipped without exact-source metadata'),
      discoverCrossPlatformLinks: (input) => {
        inputs.push(input)

        if (input.trackTitle === `Track ${failingSpotifyTrackId}`) {
          return Effect.fail(
            new MusicScraperError({
              message: 'Provider response contained private request details',
              provider: 'odesli',
              statusCode: 503,
            }),
          )
        }

        return Effect.succeed({
          links: [{ platform: 'deezer', url: laterDiscoveredDeezerUrl, scrapedAt: new Date() }],
        })
      },
    }

    const progress: Array<PlaylistExecutionProgress> = []

    const exit = await runWithIdentity(scraper, (identity) =>
      Effect.exit(
        syncPlaylistLinksEffect(identity)(playlistId, {
          checkpoint: Effect.void,
          progress: (value) =>
            Effect.sync(() => {
              progress.push(value)
            }),
        }),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)

    const links = await db
      .select({ entityId: musicEntityLinksTable.entityId })
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.url, laterDiscoveredDeezerUrl))

    expect(links.map((link) => link.entityId)).toEqual([laterTrackId])
    expect(inputs).toHaveLength(2)
    expect(progress).toEqual([
      { phase: 'enriching', processed: 0, total: 2, failed: 0 },
      { phase: 'enriching', processed: 1, total: 2, failed: 1 },
      { phase: 'enriching', processed: 2, total: 2, failed: 1 },
    ])
  })

  test('retries enrichment for a reused track without repeating successful provider work', async () => {
    const spotifyTrackId = externalId()
    const playlistSpotifyId = externalId()
    const track = trackFixture(spotifyTrackId)

    const playlist: SpotifyImportPlaylist = {
      spotifyPlaylistId: playlistSpotifyId,
      title: 'Imported playlist',
      description: null,
      coverImageUrl: null,
      ownerName: null,
      playlistUrl: `https://open.spotify.com/playlist/${playlistSpotifyId}`,
      tracks: [track, track],
    }

    let enrichmentCalls = 0
    let playlistCalls = 0
    const inputs: Array<MusicScrapeInput> = []

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Automatic enrichment must not refresh provider metadata'),
      discoverCrossPlatformLinks: (input) => {
        enrichmentCalls += 1
        inputs.push(input)

        return Effect.succeed({
          links: [
            {
              platform: 'deezer',
              url: `https://www.deezer.com/track/${Date.now()}`,
              scrapedAt: new Date(),
            },
          ],
        })
      },
    }

    const spotify: Pick<SpotifyService, 'getPlaylistForImport'> = {
      getPlaylistForImport: () => {
        playlistCalls += 1

        return Effect.succeed(playlist)
      },
    }

    const results = await runWithIdentity(scraper, (identity) =>
      Effect.gen(function* () {
        const reused = yield* identity.importProviderEntity({
          snapshot: {
            entityType: 'track',
            sourceUrl: track.trackUrl,
            title: track.title,
            artistNames: track.artistNames,
          },
          origin: 'spotify_import',
          artworkDelivery: 'preserve',
        })

        const first = yield* importSpotifyPlaylistEffect(
          spotify,
          identity,
        )(`${playlist.playlistUrl}?si=test`)

        yield* enrichPlaylistLinksEffect(identity)(first.playlist.id)

        const second = yield* importSpotifyPlaylistEffect(
          spotify,
          identity,
        )(`${playlist.playlistUrl}?si=test`)

        yield* enrichPlaylistLinksEffect(identity)(second.playlist.id)

        return { reused, first, second }
      }),
    )

    expect(results.first.reusedTrackCount).toBe(2)
    expect(results.second.reusedTrackCount).toBe(2)
    expect(enrichmentCalls).toBe(1)
    expect(inputs).toHaveLength(1)
    expect(playlistCalls).toBe(2)
  })

  test('revocation after one enriched item stops the next provider call without claiming completion', async () => {
    const playlistId = crypto.randomUUID()
    const firstTrackId = crypto.randomUUID()
    const secondTrackId = crypto.randomUUID()
    await seedPreBackfillPlaylist(playlistId, externalId(), [
      { trackId: firstTrackId, spotifyTrackId: externalId() },
      { trackId: secondTrackId, spotifyTrackId: externalId() },
    ])
    const inputs: Array<MusicScrapeInput> = []
    const progress: Array<PlaylistExecutionProgress> = []
    let allowed = true

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('Enrichment does not refresh playlist metadata'),
      discoverCrossPlatformLinks: (input) => {
        inputs.push(input)

        return Effect.succeed({
          links: [
            {
              platform: 'deezer',
              url: `https://www.deezer.com/track/${deezerId()}`,
              scrapedAt: new Date(),
            },
          ],
        })
      },
    }

    const exit = await runWithIdentity(scraper, (identity) =>
      Effect.exit(
        enrichPlaylistLinksEffect(identity)(playlistId, {
          checkpoint: Effect.suspend(() =>
            allowed
              ? Effect.void
              : Effect.fail(new MusicIdentityAuthorizationFailed({ reason: 'denied' })),
          ),
          progress: (value) =>
            Effect.sync(() => {
              progress.push(value)

              if (value.processed === 1) allowed = false
            }),
        }),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(inputs).toHaveLength(1)
    expect(progress).toEqual([
      { phase: 'enriching', processed: 0, total: 2, failed: 0 },
      { phase: 'enriching', processed: 1, total: 2, failed: 0 },
    ])

    const links = await db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.entityId, secondTrackId))

    expect(links).toHaveLength(1)
    expect(links[0]?.platform).toBe('spotify')
  })

  test('revocation during playlist provider fetch prevents canonical persistence and reports no processed tracks', async () => {
    const spotifyPlaylistId = externalId()
    const playlistUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`
    const progress: Array<PlaylistExecutionProgress> = []
    let allowed = true

    const scraper: MusicLinkScraperService = {
      scrape: () => Effect.die('No scrape after denial'),
      discoverCrossPlatformLinks: () => Effect.die('No enrichment after denial'),
    }

    const exit = await runWithIdentity(scraper, (identity) =>
      Effect.exit(
        importSpotifyPlaylistEffect(
          {
            getPlaylistForImport: () =>
              Effect.sync(() => {
                allowed = false

                return {
                  spotifyPlaylistId,
                  playlistUrl,
                  title: 'Must not persist',
                  description: null,
                  coverImageUrl: null,
                  ownerName: null,
                  tracks: [trackFixture(externalId())],
                }
              }),
          },
          identity,
        )(`${playlistUrl}?si=fixture`, undefined, {
          checkpoint: Effect.suspend(() =>
            allowed
              ? Effect.void
              : Effect.fail(new MusicIdentityAuthorizationFailed({ reason: 'denied' })),
          ),
          progress: (value) =>
            Effect.sync(() => {
              progress.push(value)
            }),
        }),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(progress).toEqual([{ phase: 'importing', processed: 0, total: null, failed: 0 }])
    expect(
      await db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.url, playlistUrl)),
    ).toEqual([])
  })

  test.each(['importing', 'enriching'] as const)(
    '%s dependency interruption never advances tracked outcome counters',
    async (phase) => {
      const playlistId = crypto.randomUUID()
      const spotifyPlaylistId = externalId()
      const first = { trackId: crypto.randomUUID(), spotifyTrackId: externalId() }
      const second = { trackId: crypto.randomUUID(), spotifyTrackId: externalId() }
      await seedPreBackfillPlaylist(playlistId, spotifyPlaylistId, [first, second])
      const progress: Array<PlaylistExecutionProgress> = []
      const providerInputs: Array<MusicScrapeInput> = []

      const scraper: MusicLinkScraperService = {
        scrape: () => Effect.die('No metadata scrape in this fixture'),
        discoverCrossPlatformLinks: (input) => {
          providerInputs.push(input)

          return Effect.succeed({
            links: [
              {
                platform: 'deezer',
                url: `https://www.deezer.com/track/${deezerId()}`,
                scrapedAt: new Date(),
              },
            ],
          })
        },
      }

      const playlistUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`

      const hooks = {
        checkpoint: Effect.void,
        progress: (value: PlaylistExecutionProgress) =>
          Effect.sync(() => {
            progress.push(value)
          }),
      }

      const exit = await runWithIdentity(scraper, (identity) => {
        // The production service interface is the controlled dependency seam;
        // all non-interrupted work still uses the real canonical writer and D1.
        const controlled: CanonicalMusicIdentityService = {
          ...identity,
          enrichEntity: (input) =>
            input.entityId === first.trackId ? Effect.interrupt : identity.enrichEntity(input),
          importProviderEntity: (input) =>
            input.snapshot.sourceUrl === trackFixture(second.spotifyTrackId).trackUrl
              ? Effect.interrupt
              : identity.importProviderEntity(input),
        }

        return Effect.exit(
          phase === 'enriching'
            ? enrichPlaylistLinksEffect(controlled)(playlistId, hooks).pipe(Effect.asVoid)
            : importSpotifyPlaylistEffect(
                {
                  getPlaylistForImport: () =>
                    Effect.succeed({
                      spotifyPlaylistId,
                      playlistUrl,
                      title: 'Interrupted import',
                      description: null,
                      coverImageUrl: null,
                      ownerName: null,
                      tracks: [
                        trackFixture(first.spotifyTrackId),
                        trackFixture(second.spotifyTrackId),
                      ],
                    }),
                },
                controlled,
              )(`${playlistUrl}?si=fixture`, undefined, hooks).pipe(Effect.asVoid),
        )
      })

      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(progress).toEqual(
        phase === 'enriching'
          ? [{ phase, processed: 0, total: 2, failed: 0 }]
          : [
              { phase, processed: 0, total: null, failed: 0 },
              { phase, processed: 0, total: 2, failed: 0 },
              { phase, processed: 1, total: 2, failed: 0 },
            ],
      )
      expect(providerInputs).toEqual([])
    },
  )
})
