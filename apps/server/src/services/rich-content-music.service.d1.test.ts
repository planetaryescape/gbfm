/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Test expectations intentionally spell out schema-owned rich-content wire values. */
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { DatabaseLayer } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicPlaylistsTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { MdxService, MdxServiceCatalogLayer } from '@/lib/mdx'
import { DatabaseTestLayer, d1, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'
import { observedD1 } from '@/test/observed-d1'

import { RichContentMusicResolverLayer } from './rich-content-music.service'

const entityId = randomUUID()

const spotifyId = '2Mf7lfHxdiABiO7j0BDbHc'

const spotifyUrl = `https://open.spotify.com/track/${spotifyId}`

const MdxCatalogTestLayer = MdxServiceCatalogLayer.pipe(
  Layer.provide(RichContentMusicResolverLayer.pipe(Layer.provide(DatabaseTestLayer))),
)

beforeAll(async () => {
  await db.batch([
    db
      .insert(musicEntityTypesTable)
      .values({ id: 'track', displayName: 'Track' })
      .onConflictDoNothing(),
    db
      .insert(musicPlatformsTable)
      .values({ id: 'spotify', displayName: 'Spotify' })
      .onConflictDoNothing(),
    db.insert(musicTracksTable).values({
      id: entityId,
      title: 'Grapefruit',
      artistNames: ['Lack'],
      coverImageUrl: `https://cdn.goosebumps.fm/music/${entityId}/cover`,
      slug: `grapefruit-${entityId}`,
    }),
    db.insert(musicEntityLinksTable).values({
      entityType: 'track',
      entityId,
      platform: 'spotify',
      url: spotifyUrl,
      status: 'verified',
    }),
    db.insert(musicSourceIdentitiesTable).values({
      sourceKey: `spotify:track:${spotifyId}`,
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: spotifyId,
      canonicalUrl: spotifyUrl,
      state: 'resolved',
      entityType: 'track',
      entityId,
      resolvedAt: new Date(),
    }),
  ])
})

afterAll(async () => {
  await db
    .delete(musicSourceIdentitiesTable)
    .where(eq(musicSourceIdentitiesTable.entityId, entityId))
  await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, entityId))
  await db.delete(musicTracksTable).where(eq(musicTracksTable.id, entityId))
})

const render = (source: string, layer = MdxCatalogTestLayer) =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const mdx = yield* MdxService

        return yield* mdx.render(source)
      }),
      layer,
    ),
  )

describe('catalog-backed rich content', () => {
  test('projects a Spotify reference as an existing GBFM music entity', async () => {
    const document = await render(
      `::track{url="${spotifyUrl}" genres="experimental" blurb="Selected cut."}`,
    )

    expect(document.blocks[0]).toEqual({
      _tag: 'MusicEmbed',
      music: {
        entityType: 'track',
        entityId,
        title: 'Grapefruit',
        artists: ['Lack'],
        description: null,
        imageUrl: `https://cdn.goosebumps.fm/music/${entityId}/cover`,
        canonicalUrl: spotifyUrl,
        links: [{ platform: 'spotify', url: spotifyUrl }],
        tracks: [],
      },
      genres: ['experimental'],
      blurb: 'Selected cut.',
      showTracks: true,
    })
  })

  test('degrades an unknown Spotify reference without creating an iframe payload', async () => {
    const unknownUrl = 'https://open.spotify.com/track/0000000000000000000000'
    const document = await render(unknownUrl)

    expect(document.blocks).toEqual([
      {
        _tag: 'UnavailableEmbed',
        kind: 'music',
        label: 'This music embed is unavailable.',
        href: unknownUrl,
      },
    ])
  })

  test('album snapshots overlap three bounded reads and preserve ordered tracks', async () => {
    const albumId = randomUUID()
    await db.insert(musicAlbumsTable).values({
      id: albumId,
      slug: `snapshot-${albumId}`,
      title: 'Snapshot album',
      artistNames: ['Album artist'],
      coverImageUrl: 'https://example.com/album.png',
    })
    await db.insert(musicTracksTable).values([
      { slug: `second-${albumId}`, title: 'Second', albumId, trackNumber: 2 },
      { slug: `first-${albumId}`, title: 'First', albumId, trackNumber: 1, artistNames: ['Guest'] },
    ])

    const observed = observedD1(d1)

    const layer = MdxServiceCatalogLayer.pipe(
      Layer.provide(
        RichContentMusicResolverLayer.pipe(Layer.provide(DatabaseLayer(observed.database))),
      ),
    )

    const document = await render(`::album{id="${albumId}"}`, layer)
    expect(document.blocks).toEqual([
      {
        _tag: 'MusicEmbed',
        music: {
          entityType: 'album',
          entityId: albumId,
          title: 'Snapshot album',
          artists: ['Album artist'],
          description: null,
          imageUrl: 'https://example.com/album.png',
          canonicalUrl: '/',
          links: [],
          tracks: [
            { title: 'First', artists: ['Guest'], url: null },
            { title: 'Second', artists: [], url: null },
          ],
        },
        genres: [],
        blurb: null,
        showTracks: true,
      },
    ])
    expect(observed.queries).toHaveLength(3)
    expect(observed.maxActive).toBe(3)

    observed.reset()
    const compact = await render(`::album{id="${albumId}" tracks="false"}`, layer)
    expect(compact.blocks[0]).toMatchObject({
      _tag: 'MusicEmbed',
      music: { title: 'Snapshot album', tracks: [] },
      showTracks: false,
    })
    expect(observed.queries).toHaveLength(2)
    expect(observed.maxActive).toBe(2)
  })

  test('playlist snapshots retain public visibility and unavailable-entity fallbacks', async () => {
    const publishedId = randomUUID()
    const draftId = randomUUID()
    const futureId = randomUUID()
    await db.insert(musicPlaylistsTable).values([
      {
        id: publishedId,
        title: 'Public playlist',
        description: 'Public description',
        slug: `public-${publishedId}`,
        publishedAt: new Date('2020-01-01'),
      },
      { id: draftId, title: 'Private playlist', slug: `draft-${draftId}` },
      {
        id: futureId,
        title: 'Scheduled playlist',
        slug: `future-${futureId}`,
        publishedAt: new Date('2100-01-01'),
      },
    ])
    const published = await render(`::playlist{id="${publishedId}" tracks="false"}`)
    expect(published.blocks[0]).toMatchObject({
      _tag: 'MusicEmbed',
      music: { title: 'Public playlist', description: 'Public description', tracks: [] },
    })

    for (const [type, id] of [
      ['playlist', draftId],
      ['playlist', futureId],
      ['playlist', randomUUID()],
      ['album', randomUUID()],
      ['track', randomUUID()],
    ]) {
      const document = await render(`::${type}{id="${id}"}`)
      expect(document.blocks).toEqual([
        {
          _tag: 'UnavailableEmbed',
          kind: 'music',
          label: 'This music embed is unavailable.',
          href: null,
        },
      ])
    }
  })
})
