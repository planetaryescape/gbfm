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
import type { SpotifyImportPlaylist } from '@/services/spotify.service'
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

  const contend = (playlistId: string) =>
    resource.database
      .prepare(
        `CREATE TRIGGER competing_revision BEFORE UPDATE ON music_playlists
         WHEN old.id = '${playlistId}' AND new.revision = old.revision + 1
         BEGIN
           UPDATE music_playlists SET revision = revision + 1 WHERE id = old.id;
           SELECT RAISE(IGNORE);
         END`,
      )
      .run()

  return { db, contend, [Symbol.asyncDispose]: () => resource.dispose() }
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

test('exhausted reorder conflicts currently retain dependent position writes', async () => {
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

  expect(tracks.map((track) => track.trackId)).toEqual(['second', 'first'])
})

test('exhausted import conflicts currently replace membership despite returning failure', async () => {
  await using h = await harness()

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
  await h.contend(imported.entity.id)

  const data: SpotifyImportPlaylist = {
    spotifyPlaylistId: '1234567890123456789012',
    title: 'New provider title',
    description: null,
    coverImageUrl: null,
    ownerName: null,
    playlistUrl: sourceUrl,
    tracks: [],
  }

  await expect(
    Effect.runPromise(
      importSpotifyPlaylistEffect(
        { getPlaylistForImport: () => Effect.succeed(data) },
        identity,
      )(`${sourceUrl}?si=fixture`).pipe(Effect.provideService(Database, h.db)),
    ),
  ).rejects.toMatchObject({
    message: 'Failed to import Spotify playlist: Spotify playlist changed while importing',
  })
  expect(
    await h.db
      .select()
      .from(musicPlaylistsTable)
      .where(eq(musicPlaylistsTable.id, imported.entity.id)),
  ).toMatchObject([{ revision: 3, title: 'Canonical playlist' }])
  expect(
    await h.db
      .select()
      .from(musicPlaylistTracksTable)
      .where(eq(musicPlaylistTracksTable.playlistId, imported.entity.id)),
  ).toEqual([])
})
