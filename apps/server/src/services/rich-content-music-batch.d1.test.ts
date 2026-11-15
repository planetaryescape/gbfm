/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Fixtures use the parser-owned reference union, which has no constructors. */
import type { D1Database } from '@cloudflare/workers-types'
import { Effect, Layer } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { DatabaseLayer } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { MdxService, MdxServiceCatalogLayer } from '@/lib/mdx'
import { d1, db, DatabaseTestLayer } from '@/test/database'
import { withTestLayer } from '@/test/effect'
import { observedD1 } from '@/test/observed-d1'

import { parseMusicSource } from './canonical-music-identity/music-source'
import {
  RichContentMusicResolver,
  RichContentMusicResolverLayer,
  type MusicReference,
} from './rich-content-music.service'

const url = 'https://open.spotify.com/album/1234567890123456789012'

const trackedUrl = `${url}?si=authored`

const resolvingUrl = 'https://open.spotify.com/album/2222222222222222222222'

const collisionUrl = 'https://open.spotify.com/album/3333333333333333333333'

const mismatchUrl = 'https://open.spotify.com/album/4444444444444444444444'

const missingUrl = 'https://open.spotify.com/album/5555555555555555555555'

const catalog = (
  entityType: 'album' | 'track',
  entityId: string,
  showTracks = true,
): MusicReference => ({
  _tag: 'MusicCatalog',
  entityType,
  entityId,
  showTracks,
  blurb: null,
})

const albumUrl = (url: string, showTracks = true): MusicReference => ({
  _tag: 'MusicUrl',
  entityType: 'album',
  url,
  showTracks,
  genres: [],
  blurb: null,
})

const run = <A, E>(effect: Effect.Effect<A, E, RichContentMusicResolver>, database = d1) =>
  Effect.runPromise(
    withTestLayer(
      effect,
      RichContentMusicResolverLayer.pipe(Layer.provide(DatabaseLayer(database))),
    ),
  )

const resolveMany = (references: ReadonlyArray<MusicReference>, database = d1) =>
  run(
    Effect.flatMap(RichContentMusicResolver, (resolver) => resolver.resolveMany(references)),
    database,
  )

beforeAll(async () => {
  await db
    .insert(musicEntityTypesTable)
    .values([
      { id: 'album', displayName: 'Album' },
      { id: 'track', displayName: 'Track' },
    ])
    .onConflictDoNothing()
  await db
    .insert(musicPlatformsTable)
    .values([
      { id: 'spotify', displayName: 'Spotify' },
      { id: 'bandcamp', displayName: 'Bandcamp' },
    ])
    .onConflictDoNothing()
  await db.insert(musicAlbumsTable).values([
    {
      id: 'album',
      slug: 'batch-album',
      title: 'Album',
      artistNames: ['Artist'],
      coverImageUrl: 'javascript:invalid',
    },
    { id: 'empty', slug: 'batch-empty', title: 'Empty' },
  ])
  await db.insert(musicTracksTable).values([
    { id: 'second', slug: 'batch-second', title: 'Second', albumId: 'album', trackNumber: 2 },
    {
      id: 'first',
      slug: 'batch-first',
      title: 'First',
      albumId: 'album',
      trackNumber: 1,
      artistNames: ['Guest'],
    },
  ])
  await db.insert(musicEntityLinksTable).values([
    { entityType: 'album', entityId: 'album', platform: 'spotify', url, status: 'verified' },
    {
      entityType: 'album',
      entityId: 'album',
      platform: 'bandcamp',
      url: 'https://example.bandcamp.com/album/batch',
      status: 'verified',
    },
    {
      entityType: 'track',
      entityId: 'first',
      platform: 'spotify',
      url: 'https://open.spotify.com/track/1111111111111111111111',
      status: 'pending',
    },
    {
      entityType: 'track',
      entityId: 'second',
      platform: 'spotify',
      url: 'javascript:invalid',
      status: 'verified',
    },
  ])

  const sources = await Effect.runPromise(
    Effect.forEach([url, resolvingUrl, collisionUrl, mismatchUrl, missingUrl], (url) =>
      parseMusicSource(url, 'album'),
    ),
  )

  await db.insert(musicSourceIdentitiesTable).values(
    sources.map((source): typeof musicSourceIdentitiesTable.$inferInsert => {
      if (source.normalizedUrl === resolvingUrl)
        return {
          ...source,
          state: 'resolving',
          ownerToken: 'owner',
          leaseExpiresAt: new Date('2100-01-01'),
        }

      return {
        ...source,
        state: 'resolved',
        entityType: source.normalizedUrl === mismatchUrl ? 'track' : 'album',
        entityId: source.normalizedUrl === missingUrl ? 'absent' : 'album',
        resolvedAt: new Date('2020-01-01'),
      }
    }),
  )
  const source = sources[0]

  if (!source) throw Error('Missing fixture source')
  await db.insert(musicSourceAliasesTable).values([
    {
      normalizedUrl: source.normalizedUrl,
      sourceKey: source.sourceKey,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
    {
      normalizedUrl: collisionUrl,
      sourceKey: source.sourceKey,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  ])
})

test('batch snapshots exactly match individual reads, including isolated unavailable references', async () => {
  const references = [
    albumUrl(trackedUrl),
    catalog('album', 'album', false),
    catalog('track', 'first'),
    catalog('track', 'second'),
    catalog('album', 'empty'),
    albumUrl(resolvingUrl),
    albumUrl(collisionUrl),
    albumUrl(mismatchUrl),
    albumUrl(missingUrl),
    albumUrl('https://open.spotify.com/album/0000000000000000000000'),
    albumUrl('https://127.0.0.1/album'),
    catalog('track', 'absent'),
  ]

  const expected = await run(
    Effect.flatMap(RichContentMusicResolver, (resolver) =>
      Effect.forEach(references, resolver.resolve, { concurrency: 2 }),
    ),
  )

  const observed = observedD1(d1)
  const actual = await resolveMany(references, observed.database)
  expect(actual).toEqual(expected)
  expect(observed.queries).toEqual(['batch', 'batch'])
  expect(actual[0]).toMatchObject({
    title: 'Album',
    canonicalUrl: trackedUrl,
    imageUrl: null,
    tracks: [
      { title: 'First', artists: ['Guest'], url: null },
      { title: 'Second', artists: [], url: null },
    ],
  })
  expect(actual.slice(5)).toEqual(Array(7).fill(null))
})

test.each([0, 1, 6, 20, 21, 41])(
  'URL cards obey two round trips per 20-reference chunk for %i cards',
  async (count) => {
    const observed = observedD1(d1)

    const results = await resolveMany(
      Array.from({ length: count }, () => albumUrl(url)),
      observed.database,
    )

    expect(results).toHaveLength(count)
    expect(results.every((snapshot) => snapshot?.title === 'Album')).toBe(true)
    expect(observed.queries).toEqual(Array(Math.ceil(count / 20) * 2).fill('batch'))
    expect(observed.maxActive).toBeLessThanOrEqual(1)
  },
)

test('catalog-only cards skip identity reads and omit tracks when requested', async () => {
  const observed = observedD1(d1)

  const results = await resolveMany(
    Array.from({ length: 6 }, () => catalog('album', 'album', false)),
    observed.database,
  )

  expect(results.every((snapshot) => snapshot?.tracks.length === 0)).toBe(true)
  expect(observed.queries).toEqual(['batch'])
})

test('six distinct track URLs share two calls and retain their own snapshots', async () => {
  const references: Array<MusicReference> = []

  for (let index = 0; index < 6; index++) {
    const externalId = String(index).padStart(22, '8')
    const url = `https://open.spotify.com/track/${externalId}`
    const id = `distinct-${index}`
    await db.batch([
      db.insert(musicTracksTable).values({ id, slug: id, title: `Track ${index}` }),
      db.insert(musicSourceIdentitiesTable).values({
        sourceKey: `spotify:track:${externalId}`,
        platform: 'spotify',
        sourceEntityType: 'track',
        canonicalUrl: url,
        externalId,
        state: 'resolved',
        entityType: 'track',
        entityId: id,
        resolvedAt: new Date('2020-01-01'),
      }),
    ])
    references.push({
      _tag: 'MusicUrl',
      entityType: 'track',
      url,
      showTracks: false,
      genres: [],
      blurb: null,
    })
  }

  const observed = observedD1(d1)
  const result = await resolveMany(references, observed.database)
  expect(result.map((snapshot) => snapshot?.title)).toEqual(
    Array.from({ length: 6 }, (_, index) => `Track ${index}`),
  )
  expect(observed.queries).toEqual(['batch', 'batch'])
})

test('mixed documents retain playlist publication rules, member ordering and partial fallbacks', async () => {
  await db.insert(musicPlaylistsTable).values([
    { id: 'public', slug: 'batch-public', title: 'Public', publishedAt: new Date('2020-01-01') },
    { id: 'draft', slug: 'batch-draft', title: 'Draft' },
    { id: 'future', slug: 'batch-future', title: 'Future', publishedAt: new Date('2100-01-01') },
  ])
  await db.insert(musicPlaylistTracksTable).values([
    { playlistId: 'public', trackId: 'second', position: 2 },
    { playlistId: 'public', trackId: 'first', position: 1 },
  ])

  const playlist = (entityId: string): MusicReference => ({
    _tag: 'MusicCatalog',
    entityType: 'playlist',
    entityId,
    showTracks: true,
    blurb: null,
  })

  const references = [
    catalog('album', 'album'),
    playlist('public'),
    playlist('draft'),
    playlist('future'),
    catalog('track', 'first'),
  ]

  const expected = await run(
    Effect.flatMap(RichContentMusicResolver, (resolver) =>
      Effect.forEach(references, resolver.resolve, { concurrency: 2 }),
    ),
  )

  const actual = await resolveMany(references)
  expect(actual).toEqual(expected)
  expect(actual[1]?.tracks.map((track) => track.title)).toEqual(['First', 'Second'])
  expect(actual[2]).toBeNull()
  expect(actual[3]).toBeNull()
  expect(actual[4]?.title).toBe('First')
})

test('nested quotes, card groups and lists share the document batch without reordering cards', async () => {
  const observed = observedD1(d1)

  const layer = MdxServiceCatalogLayer.pipe(
    Layer.provide(
      RichContentMusicResolverLayer.pipe(Layer.provide(DatabaseLayer(observed.database))),
    ),
  )

  const source = `::layout{name="spotlight"}\n\n> ::album{url="${trackedUrl}" blurb="Quoted."}\n\n:::cards\n::track{id="first"}\n\n::album{id="empty"}\n:::\n\n- ${url}`

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.flatMap(MdxService, (mdx) => mdx.render(source)),
      layer,
    ),
  )

  const singleLayer = Layer.effect(
    RichContentMusicResolver,
    Effect.map(RichContentMusicResolver, (resolver) =>
      RichContentMusicResolver.of({
        resolve: resolver.resolve,
        resolveMany: (references) =>
          Effect.forEach(references, resolver.resolve, { concurrency: 2 }),
      }),
    ),
  ).pipe(Layer.provide(RichContentMusicResolverLayer.pipe(Layer.provide(DatabaseTestLayer))))

  const control = await Effect.runPromise(
    withTestLayer(
      Effect.flatMap(MdxService, (mdx) => mdx.render(source)),
      MdxServiceCatalogLayer.pipe(Layer.provide(singleLayer)),
    ),
  )

  expect(result).toEqual(control)
  expect(result.layout).toBe('spotlight')

  const serialized = JSON.stringify(result)
  expect(serialized).toContain('Quoted.')
  expect(serialized).toContain('"title":"First"')
  expect(serialized).toContain('"title":"Empty"')
  expect(serialized).not.toContain('UnavailableEmbed')
  expect(observed.queries).toEqual(['batch', 'batch'])
})

test('batch reads use indexed lookup predicates and stay below D1 bind limits', async () => {
  const queries: Array<string> = []

  const database: D1Database = {
    prepare: (query) => {
      queries.push(query)

      return d1.prepare(query)
    },
    batch: (statements) => d1.batch(statements),
    exec: (query) => d1.exec(query),
    withSession: (constraint) => d1.withSession(constraint),
    dump: () => d1.dump(),
  }

  await resolveMany(
    Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? albumUrl(url) : catalog('track', 'first'),
    ),
    database,
  )
  expect(queries).toHaveLength(7)

  for (const query of queries) {
    const bindCount = [...query.matchAll(/\?/g)].length
    expect(bindCount).toBeLessThanOrEqual(100)

    const plan = await d1
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .bind(...Array(bindCount).fill('album'))
      .all<{ detail: string }>()

    expect(plan.results.some((row) => row.detail.includes('SEARCH'))).toBe(true)
    expect(plan.results.map((row) => row.detail).join('\n')).not.toContain(
      'music_entity_links_status_idx',
    )
    expect(plan.results.some((row) => /\bSCAN (?:music_|a\b)/.test(row.detail))).toBe(false)
  }
})
