import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'

import { Database, makeDatabaseClient } from '@/db/layer'
import {
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import {
  CanonicalMusicIdentity,
  CanonicalMusicIdentityLayer,
} from '@/services/canonical-music-identity'
import { ConfigService, createConfig } from '@/services/config.service'
import { MusicLinkScraperService } from '@/services/music-link-scraper.service'
import { S3Service } from '@/services/s3.service'
import type { SpotifyImportPlaylist, SpotifyImportTrack } from '@/services/spotify.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { makeTestS3Service } from '@/test/s3'

import { importSpotifyPlaylistEffect, reorderPlaylistTracksEffect } from './playlist-tracks.service'

const harness = async () => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await seedMusicLookups(db)
  await db
    .insert(musicPlaylistsTable)
    .values({ id: 'playlist', title: 'Playlist', slug: 'playlist' })
  await db.insert(musicTracksTable).values([
    { id: 'first', title: 'First', slug: 'first' },
    { id: 'second', title: 'Second', slug: 'second' },
  ])
  await db.insert(musicPlaylistTracksTable).values([
    { playlistId: 'playlist', trackId: 'first', position: 0 },
    { playlistId: 'playlist', trackId: 'second', position: 1 },
  ])

  const contend = (playlistId: string, untilRevision = 3) =>
    resource.database
      .prepare(
        `CREATE TRIGGER competing_revision BEFORE UPDATE ON music_playlists
         WHEN old.id = '${playlistId}' AND new.revision = old.revision + 1 AND old.revision < ${untilRevision}
         BEGIN
           UPDATE music_playlists SET revision = revision + 1 WHERE id = old.id;
           SELECT RAISE(IGNORE);
         END`,
      )
      .run()

  const failTrackWrite = (operation: 'UPDATE' | 'DELETE') =>
    resource.database
      .prepare(
        `CREATE TRIGGER failing_track_write BEFORE ${operation} ON music_playlist_tracks
         BEGIN SELECT RAISE(ABORT, 'fixture track write failure'); END`,
      )
      .run()

  return { db, contend, failTrackWrite, [Symbol.asyncDispose]: () => resource.dispose() }
}

test('reorder advances once, rejects mismatched sets, and preserves positions on validation failure', async () => {
  await using h = await harness()

  const run = (ids: Array<string>) =>
    Effect.runPromise(
      reorderPlaylistTracksEffect('playlist', ids).pipe(Effect.provideService(Database, h.db)),
    )

  await run(['second', 'first'])
  expect(await h.db.select().from(musicPlaylistsTable)).toMatchObject([{ revision: 1 }])

  const before = await h.db
    .select()
    .from(musicPlaylistTracksTable)
    .orderBy(musicPlaylistTracksTable.position)

  expect(before.map((track) => track.trackId)).toEqual(['second', 'first'])
  await expect(run(['first'])).rejects.toMatchObject({
    message: 'Reorder track set must match current playlist tracks exactly',
  })
  expect(
    await h.db.select().from(musicPlaylistTracksTable).orderBy(musicPlaylistTracksTable.position),
  ).toEqual(before)
})

test('exhausted reorder conflicts preserve the original positions', async () => {
  await using h = await harness()
  await h.contend('playlist')
  await expect(
    Effect.runPromise(
      reorderPlaylistTracksEffect('playlist', ['second', 'first']).pipe(
        Effect.provideService(Database, h.db),
      ),
    ),
  ).rejects.toMatchObject({ message: 'Playlist changed while reordering tracks' })
  expect(await h.db.select().from(musicPlaylistsTable)).toMatchObject([{ revision: 3 }])

  const tracks = await h.db
    .select()
    .from(musicPlaylistTracksTable)
    .orderBy(musicPlaylistTracksTable.position)

  expect(tracks.map((track) => track.trackId)).toEqual(['first', 'second'])
})

test('reorder keeps duplicate last positions, supports empty playlists, and excludes other playlists', async () => {
  await using h = await harness()
  await h.db.insert(musicPlaylistsTable).values([
    { id: 'other', title: 'Other', slug: 'other' },
    { id: 'empty', title: 'Empty', slug: 'empty' },
  ])
  await h.db
    .insert(musicPlaylistTracksTable)
    .values({ playlistId: 'other', trackId: 'first', position: 7 })

  const run = (playlistId: string, tracks: Array<string>) =>
    Effect.runPromise(
      reorderPlaylistTracksEffect(playlistId, tracks).pipe(Effect.provideService(Database, h.db)),
    )

  await run('playlist', ['second', 'first', 'second'])
  expect(
    await h.db
      .select()
      .from(musicPlaylistTracksTable)
      .where(eq(musicPlaylistTracksTable.playlistId, 'playlist'))
      .orderBy(musicPlaylistTracksTable.position),
  ).toMatchObject([
    { trackId: 'first', position: 1 },
    { trackId: 'second', position: 2 },
  ])
  await run('empty', [])
  expect(
    await h.db.select().from(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, 'empty')),
  ).toMatchObject([{ revision: 1 }])
  expect(
    await h.db
      .select()
      .from(musicPlaylistTracksTable)
      .where(eq(musicPlaylistTracksTable.playlistId, 'other')),
  ).toMatchObject([{ trackId: 'first', position: 7 }])
})

const importHarness = async (h: Awaited<ReturnType<typeof harness>>) => {
  const dependencies = Layer.mergeAll(
    Layer.succeed(Database, h.db),
    Layer.succeed(ConfigService, createConfig()),
    Layer.succeed(S3Service, makeTestS3Service()),
    Layer.succeed(MusicLinkScraperService, {
      scrape: () => Effect.die('Snapshot imports do not scrape'),
      discoverCrossPlatformLinks: () => Effect.die('Snapshot imports do not enrich'),
    }),
  )

  const identity = await Effect.runPromise(
    withTestLayer(
      CanonicalMusicIdentity,
      CanonicalMusicIdentityLayer.pipe(Layer.provide(dependencies)),
    ),
  )

  const sourceUrl = 'https://open.spotify.com/playlist/1234567890123456789012'

  const imported = await Effect.runPromise(
    identity.importProviderEntity({
      snapshot: { entityType: 'playlist', sourceUrl, title: 'Canonical playlist' },
      origin: 'spotify_import',
      artworkDelivery: 'preserve',
    }),
  )

  await h.db.insert(musicPlaylistTracksTable).values({
    playlistId: imported.entity.id,
    trackId: 'first',
    position: 0,
  })

  const data: SpotifyImportPlaylist = {
    spotifyPlaylistId: '1234567890123456789012',
    title: 'New provider title',
    description: null,
    coverImageUrl: null,
    ownerName: null,
    playlistUrl: sourceUrl,
    tracks: [],
  }

  const run = (tracks: Array<SpotifyImportTrack>) =>
    Effect.runPromise(
      importSpotifyPlaylistEffect(
        { getPlaylistForImport: () => Effect.succeed({ ...data, tracks }) },
        identity,
      )(`${sourceUrl}?si=fixture`).pipe(Effect.provideService(Database, h.db)),
    )

  const membership = () =>
    h.db
      .select()
      .from(musicPlaylistTracksTable)
      .where(eq(musicPlaylistTracksTable.playlistId, imported.entity.id))
      .orderBy(musicPlaylistTracksTable.position)

  return { playlistId: imported.entity.id, run, membership }
}

const providerTrack = (id: string): SpotifyImportTrack => ({
  spotifyTrackId: id,
  title: `Track ${id}`,
  artistNames: [],
  artistSpotifyIds: [],
  albumName: null,
  albumSpotifyId: null,
  albumImageUrl: null,
  trackUrl: `https://open.spotify.com/track/${id}`,
  previewUrl: null,
  durationMs: null,
  trackNumber: null,
})

const firstProviderTrack = providerTrack('1111111111111111111111')

const secondProviderTrack = providerTrack('2222222222222222222222')

test.each([{ tracks: [] }, { tracks: [firstProviderTrack] }])(
  'exhausted import conflicts preserve membership with provider tracks $tracks',
  async ({ tracks }) => {
    await using h = await harness()
    const imported = await importHarness(h)
    const before = await imported.membership()
    await h.contend(imported.playlistId)
    await expect(imported.run(tracks)).rejects.toMatchObject({
      message: 'Failed to import Spotify playlist: Spotify playlist changed while importing',
    })
    expect(
      await h.db
        .select()
        .from(musicPlaylistsTable)
        .where(eq(musicPlaylistsTable.id, imported.playlistId)),
    ).toMatchObject([{ revision: 3, title: 'Canonical playlist' }])
    expect(await imported.membership()).toEqual(before)
  },
)

test('import replaces membership, preserves last duplicate positions, and can clear an empty snapshot', async () => {
  await using h = await harness()
  const imported = await importHarness(h)

  const unrelated = await h.db
    .select()
    .from(musicPlaylistTracksTable)
    .where(eq(musicPlaylistTracksTable.playlistId, 'playlist'))

  const first = await imported.run([firstProviderTrack, secondProviderTrack])
  const initialTracks = await imported.membership()
  expect(initialTracks).toHaveLength(2)
  expect(initialTracks.map((track) => track.position)).toEqual([0, 1])
  expect(first.playlist.revision).toBe(1)
  expect(first.trackCount).toBe(2)
  await h.db
    .update(musicPlaylistTracksTable)
    .set({ addedAt: new Date(0) })
    .where(eq(musicPlaylistTracksTable.playlistId, imported.playlistId))

  const second = await imported.run([secondProviderTrack, secondProviderTrack])
  expect(second.playlist.revision).toBe(2)
  expect(await imported.membership()).toMatchObject([
    { trackId: initialTracks[1]?.trackId, position: 1 },
  ])
  expect((await imported.membership())[0]?.addedAt.getTime()).toBeGreaterThan(0)

  const cleared = await imported.run([])
  expect(cleared.playlist.revision).toBe(3)
  expect(await imported.membership()).toEqual([])

  const empty = await imported.run([])
  expect(empty.playlist.revision).toBe(4)
  expect(await imported.membership()).toEqual([])

  const refilled = await imported.run([firstProviderTrack])
  expect(refilled.playlist.revision).toBe(5)
  expect(await imported.membership()).toMatchObject([
    { trackId: initialTracks[0]?.trackId, position: 0 },
  ])
  expect(
    await h.db
      .select()
      .from(musicPlaylistTracksTable)
      .where(eq(musicPlaylistTracksTable.playlistId, 'playlist')),
  ).toEqual(unrelated)
})

test('a reorder can retry a lost revision without retaining the failed attempt', async () => {
  await using h = await harness()
  await h.contend('playlist', 1)
  await Effect.runPromise(
    reorderPlaylistTracksEffect('playlist', ['second', 'first']).pipe(
      Effect.provideService(Database, h.db),
    ),
  )
  expect(await h.db.select().from(musicPlaylistsTable)).toMatchObject([{ revision: 2 }])
  expect(
    await h.db.select().from(musicPlaylistTracksTable).orderBy(musicPlaylistTracksTable.position),
  ).toMatchObject([
    { trackId: 'second', position: 0 },
    { trackId: 'first', position: 1 },
  ])
})

test('a successful import retry replaces membership after a lost revision', async () => {
  await using h = await harness()
  const imported = await importHarness(h)
  await h.contend(imported.playlistId, 1)
  const result = await imported.run([firstProviderTrack])
  expect(result.playlist.revision).toBe(2)
  const membership = await imported.membership()
  expect(membership).toHaveLength(1)
  expect(membership[0]?.trackId).not.toBe('first')
  expect(membership[0]?.position).toBe(0)
})

test('a failed reorder write rolls back its revision advance', async () => {
  await using h = await harness()
  const before = await h.db.select().from(musicPlaylistTracksTable)
  await h.failTrackWrite('UPDATE')
  await expect(
    Effect.runPromise(
      reorderPlaylistTracksEffect('playlist', ['second', 'first']).pipe(
        Effect.provideService(Database, h.db),
      ),
    ),
  ).rejects.toThrow('Failed to reorder tracks')
  expect(await h.db.select().from(musicPlaylistsTable)).toMatchObject([{ revision: 0 }])
  expect(await h.db.select().from(musicPlaylistTracksTable)).toEqual(before)
})

test('a failed import delete rolls back its revision and preceding membership inserts', async () => {
  await using h = await harness()
  const imported = await importHarness(h)
  const before = await imported.membership()
  await h.failTrackWrite('DELETE')
  await expect(imported.run([firstProviderTrack])).rejects.toThrow(
    'Failed to import Spotify playlist',
  )
  expect(await imported.membership()).toEqual(before)
  expect(
    await h.db
      .select()
      .from(musicPlaylistsTable)
      .where(eq(musicPlaylistsTable.id, imported.playlistId)),
  ).toMatchObject([{ revision: 0, title: 'Canonical playlist' }])
})
