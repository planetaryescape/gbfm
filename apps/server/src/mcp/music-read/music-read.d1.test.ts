import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import {
  musicAlbumArtistsTable,
  musicAlbumsTable,
  musicArtistsTable,
  musicEntityLinksTable,
  musicLabelAlbumsTable,
  musicLabelArtistsTable,
  musicLabelsTable,
  musicPlaylistsTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicTrackArtistsTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { makeMcpLayer } from '../server'
import {
  GetMusicEntitiesInput,
  GetMusicEntitiesResult,
  GetMusicEntityResult,
  LookupMusicUrlResult,
  MusicListResult,
  MusicRef,
  MusicRelationshipsResult,
  SearchMusicInput,
} from './contracts'
import { MusicReadService, MusicReadServiceLayer } from './service'
import { MusicReadHandlersLayer, MusicReadToolkit } from './toolkit'

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'disposable-r1',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const actor = Schema.decodeUnknownSync(McpPrincipal)({
  userId: 'r1-listener',
  clientId: 'r1-client',
  scopes: ['catalogue:read'],
})

const services = MusicReadServiceLayer.pipe(
  Layer.provide(DatabaseTestLayer),
  Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
)

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], MusicReadToolkit).pipe(
    Layer.provide(MusicReadHandlersLayer),
    Layer.provide(services),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) => effect.pipe(Effect.provideService(McpActor, actor)),
  },
)

const Envelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    structuredContent: Schema.optional(Schema.Unknown),
    content: Schema.Array(
      Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
    ),
  }),
})

const call = async (name: string, args: Schema.Json) => {
  const response = await app.handler(
    new Request('https://api.example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  )

  const body = await response.text()

  const data =
    body.startsWith('event:') || body.startsWith('data:')
      ? body
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : body

  if (!data) throw new Error('Missing MCP response')

  return Schema.decodeUnknownSync(Envelope)(JSON.parse(data)).result
}

const success = async <A>(name: string, args: Schema.Json, schema: Schema.Codec<A, unknown>) => {
  const result = await call(name, args)
  expect(result.isError).not.toBe(true)

  return Schema.decodeUnknownSync(schema)(result.structuredContent)
}

beforeAll(async () => {
  await seedMusicLookups(db)
  await db
    .insert(user)
    .values({ id: 'r1-listener', name: 'Reader', email: 'r1@example.test', role: 'user' })
  await db.insert(musicArtistsTable).values([
    {
      id: 'artist-a',
      name: 'R1 Shared',
      slug: 'artist-a',
      publishedAt: null,
      createdById: 'r1-listener',
    },
    { id: 'artist-z', name: 'R1 Shared', slug: 'artist-z', publishedAt: new Date('2099-01-01') },
  ])
  await db.insert(musicAlbumsTable).values([
    { id: 'album-a', title: 'R1 Shared', slug: 'album-a', publishedAt: new Date('2099-01-01') },
    { id: 'album-z', title: 'Other release', slug: 'album-z' },
  ])
  await db.insert(musicTracksTable).values([
    { id: 'track-a', title: 'R1 Shared', slug: 'track-a', albumId: 'album-a', trackNumber: 9 },
    { id: 'track-z', title: 'Second', slug: 'track-z', albumId: 'album-a', trackNumber: 2 },
    { id: 'track-m', title: 'Unknown number', slug: 'track-m', albumId: 'album-a' },
    {
      id: 'track-other',
      title: 'Other track',
      slug: 'track-other',
      albumId: 'album-z',
      trackNumber: 1,
    },
  ])
  await db.insert(musicLabelsTable).values({
    id: 'label-a',
    name: 'R1 Shared',
    slug: 'label-a',
    content: 'PRIVATE LABEL DRAFT BODY',
    publishedAt: null,
    createdById: 'r1-listener',
  })
  await db.insert(musicPlaylistsTable).values({
    id: 'playlist-private',
    title: 'R1 Shared',
    slug: 'playlist-private',
    publishedAt: null,
  })
  await db.insert(musicAlbumArtistsTable).values([
    { albumId: 'album-a', artistId: 'artist-a', role: 'featured', displayOrder: 3 },
    { albumId: 'album-z', artistId: 'artist-z' },
  ])
  await db
    .insert(musicTrackArtistsTable)
    .values({ trackId: 'track-z', artistId: 'artist-a', role: 'primary', displayOrder: 1 })
  await db.insert(musicLabelArtistsTable).values({ labelId: 'label-a', artistId: 'artist-a' })
  await db.insert(musicLabelAlbumsTable).values({ labelId: 'label-a', albumId: 'album-z' })
  await db.insert(musicEntityLinksTable).values([
    {
      entityType: 'artist',
      entityId: 'artist-a',
      platform: 'spotify',
      url: 'https://open.spotify.com/artist/abc?si=tracking',
      metadata: { secret: 'PRIVATE PROVENANCE' },
    },
    {
      entityType: 'artist',
      entityId: 'artist-a',
      platform: 'website',
      url: 'https://user:password@example.test',
    },
    {
      entityType: 'artist',
      entityId: 'artist-a',
      platform: 'other',
      url: 'https://hidden.example.test',
      status: 'rejected',
    },
  ])
  await db.insert(musicSourceIdentitiesTable).values([
    {
      sourceKey: 'spotify:artist:abc',
      platform: 'spotify',
      sourceEntityType: 'artist',
      externalId: 'abc',
      canonicalUrl: 'https://open.spotify.com/artist/abc',
      state: 'resolved',
      entityType: 'artist',
      entityId: 'artist-a',
      resolvedAt: new Date(1),
    },
    {
      sourceKey: 'spotify:track:orphan',
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: 'orphan',
      canonicalUrl: 'https://open.spotify.com/track/orphan',
      state: 'resolved',
      entityType: 'track',
      entityId: 'missing',
      resolvedAt: new Date(1),
    },
    {
      sourceKey: 'spotify:track:pending',
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: 'pending',
      canonicalUrl: 'https://open.spotify.com/track/pending',
      state: 'resolving',
      ownerToken: 'PRIVATE LEASE',
      leaseExpiresAt: new Date('2099-01-01'),
    },
    {
      sourceKey: 'spotify:playlist:private',
      platform: 'spotify',
      sourceEntityType: 'playlist',
      externalId: 'private',
      canonicalUrl: 'https://open.spotify.com/playlist/private',
      state: 'resolved',
      entityType: 'playlist',
      entityId: 'playlist-private',
      resolvedAt: new Date(1),
    },
  ])
  await db.insert(musicSourceAliasesTable).values({
    normalizedUrl: 'https://alias.example.test/artist',
    sourceKey: 'spotify:artist:abc',
    firstSeenAt: new Date(1),
    lastSeenAt: new Date(2),
  })
})

afterAll(() => app.dispose())

test('search/filter/get expose all four kinds with safe null/future catalogue projections and literal search', async () => {
  const first = await success('search_music', { query: 'r1 shared', limit: 2 }, MusicListResult)
  expect(first.entities.map((row) => [row.entityType, row.entityId])).toEqual([
    ['album', 'album-a'],
    ['artist', 'artist-a'],
  ])
  expect(first.pagination).toEqual({ limit: 2, offset: 0, hasMore: true })

  const second = await success(
    'search_music',
    { query: 'r1 shared', limit: 2, offset: 2 },
    MusicListResult,
  )

  expect(second.entities.map((row) => row.entityId)).toEqual(['artist-z', 'label-a'])

  const last = await success(
    'search_music',
    { query: 'r1 shared', limit: 2, offset: 4 },
    MusicListResult,
  )

  expect(last.entities.map((row) => row.entityId)).toEqual(['track-a'])
  expect(last.pagination.hasMore).toBe(false)
  expect((await success('search_music', { query: '%' }, MusicListResult)).entities).toEqual([])
  expect(
    (await success('filter_music', { entityType: 'artist', name: 'R1' }, MusicListResult)).entities,
  ).toEqual([])
  expect(
    (
      await success('filter_music', { entityType: 'artist', name: 'r1 shared' }, MusicListResult)
    ).entities.map((row) => row.entityId),
  ).toEqual(['artist-a', 'artist-z'])

  const artist = await success(
    'get_music_entity',
    { entityType: 'artist', entityId: 'artist-a' },
    GetMusicEntityResult,
  )

  expect(artist.endpoint.environment).toBe('disposable-r1')
  expect(artist.entity.links).toEqual([
    { platform: 'spotify', url: 'https://open.spotify.com/artist/abc' },
  ])

  const label = await success(
    'get_music_entity',
    { entityType: 'label', entityId: 'label-a' },
    GetMusicEntityResult,
  )

  expect(Object.keys(label.entity).sort()).toEqual([
    'entityId',
    'entityType',
    'links',
    'linksHasMore',
    'name',
    'observedUpdatedAt',
    'slug',
  ])
  expect(JSON.stringify([first, second, last, artist, label])).not.toMatch(
    /PRIVATE|createdById|metadata|password|playlist-private/,
  )
})

test('batch preserves order, duplicates, wrong-kind and missing references', async () => {
  const entities = [
    { entityType: 'track', entityId: 'track-z' },
    { entityType: 'artist', entityId: 'track-z' },
    { entityType: 'label', entityId: 'missing' },
    { entityType: 'track', entityId: 'track-z' },
  ]

  const batch = await success('get_music_entities', { entities }, GetMusicEntitiesResult)
  expect(batch.results.map((row) => row.ref)).toEqual(entities)
  expect(batch.results.map((row) => row.status)).toEqual([
    'found',
    'not_found',
    'not_found',
    'found',
  ])
  expect(batch.results[0]).toEqual(batch.results[3])
})

test('asymmetric relationships retain roles, direction and bounded album track order without graph expansion', async () => {
  const discography = await success(
    'get_artist_discography',
    { artistId: 'artist-a' },
    MusicRelationshipsResult,
  )

  expect(
    discography.relationships.map((row) => [
      row.relationship,
      row.direction,
      row.entity.entityId,
      row.role,
      row.position,
    ]),
  ).toEqual([
    ['album_artist', 'incoming', 'album-a', 'featured', 3],
    ['track_artist', 'incoming', 'track-z', 'primary', 1],
  ])

  const tracks = await success(
    'get_album_tracks',
    { albumId: 'album-a', limit: 2 },
    MusicRelationshipsResult,
  )

  expect(tracks.relationships.map((row) => row.entity.entityId)).toEqual(['track-z', 'track-a'])
  expect(tracks.pagination.hasMore).toBe(true)

  const tail = await success(
    'get_album_tracks',
    { albumId: 'album-a', limit: 2, offset: 2 },
    MusicRelationshipsResult,
  )

  expect(tail.relationships.map((row) => row.entity.entityId)).toEqual(['track-m'])
  expect(tail.pagination.hasMore).toBe(false)

  const catalogue = await success(
    'get_label_catalogue',
    { labelId: 'label-a' },
    MusicRelationshipsResult,
  )

  expect(catalogue.relationships.map((row) => row.entity.entityId)).toEqual(['album-z', 'artist-a'])

  const related = await success(
    'get_music_relationships',
    { entityType: 'track', entityId: 'track-z' },
    MusicRelationshipsResult,
  )

  expect(
    related.relationships.map((row) => [row.relationship, row.direction, row.entity.entityId]),
  ).toEqual([
    ['album_track', 'incoming', 'album-a'],
    ['track_artist', 'outgoing', 'artist-a'],
  ])
  expect(related.relationships.some((row) => row.entity.entityId === 'label-a')).toBe(false)
})

test('normalized identities and aliases read only; misses/unresolved/orphans/playlists never mutate any persisted data', async () => {
  const snapshot = async () => {
    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and substr(name, 1, 4) <> '_cf_' order by name`,
    )

    return Promise.all(
      tables.map(async ({ name }) => [
        name,
        await db.all(sql`select * from ${sql.identifier(name)}`),
      ]),
    )
  }

  const before = await snapshot()

  for (const url of [
    'https://open.spotify.com/intl-za/artist/abc?si=tracking#fragment',
    'https://alias.example.test/artist?utm_source=test',
  ]) {
    const result = await success('lookup_music_url', { url }, LookupMusicUrlResult)
    expect(result.result).toMatchObject({ status: 'found', entity: { entityId: 'artist-a' } })
  }

  for (const id of ['unknown', 'orphan', 'pending']) {
    expect(
      (
        await success(
          'lookup_music_url',
          { url: `https://open.spotify.com/track/${id}` },
          LookupMusicUrlResult,
        )
      ).result,
    ).toEqual({ status: 'not_found' })
  }

  expect(
    (
      await success(
        'lookup_music_url',
        { url: 'https://open.spotify.com/playlist/private' },
        LookupMusicUrlResult,
      )
    ).result,
  ).toEqual({ status: 'not_found' })
  expect(await snapshot()).toEqual(before)
})

test('missing entities and unsafe URLs return typed tool errors', async () => {
  for (const [name, args, code] of [
    ['get_music_entity', { entityType: 'artist', entityId: 'missing' }, 'not_found'],
    ['get_album_tracks', { albumId: 'missing' }, 'not_found'],
    ['lookup_music_url', { url: 'https://user:password@example.test' }, 'invalid_input'],
    ['lookup_music_url', { url: 'https://127.0.0.1/x' }, 'invalid_input'],
  ] as const) {
    const result = await call(name, args)
    expect(result.isError).toBe(true)
    expect(result.content.map((item) => item.text).join('')).toContain(code)
    expect(JSON.stringify(result)).not.toContain('password')
  }
})

test('direct service checks current listener account and scope rather than relying on transport admission', async () => {
  const read = Effect.gen(function* () {
    const service = yield* MusicReadService

    return yield* service.getMusicEntity({ entityType: 'artist', entityId: 'artist-a' })
  })

  const missingScope = Schema.decodeUnknownSync(McpPrincipal)({
    ...actor,
    scopes: ['content:read'],
  })

  const denied = await Effect.runPromise(
    withTestLayer(read.pipe(Effect.provideService(McpActor, missingScope), Effect.flip), services),
  )

  expect(denied.code).toBe('access_denied')
  await db.update(user).set({ banned: true }).where(eq(user.id, actor.userId))

  try {
    const banned = await call('get_music_entity', { entityType: 'artist', entityId: 'artist-a' })
    expect(banned.isError).toBe(true)
    expect(banned.content.map((item) => item.text).join('')).toContain('access_denied')
  } finally {
    await db.update(user).set({ banned: false }).where(eq(user.id, actor.userId))
  }
})

test('default/max pages, max batch, invalid bounds and encoded response ceiling are enforced', async () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({
    id: `bounded-${String(i).padStart(3, '0')}`,
    name: 'Boundary',
    slug: `bounded-${i}`,
  }))

  for (const row of rows) await db.insert(musicArtistsTable).values(row)

  try {
    const first = await success('search_music', { query: 'Boundary' }, MusicListResult)
    expect(first.entities).toHaveLength(20)
    expect(first.pagination).toEqual({ limit: 20, offset: 0, hasMore: true })
    const max = await success('search_music', { query: 'Boundary', limit: 50 }, MusicListResult)
    expect(max.entities).toHaveLength(50)
    expect(max.pagination.hasMore).toBe(true)

    const entities = Array.from({ length: 50 }, () => ({
      entityType: 'artist',
      entityId: 'artist-a',
    }))

    expect(
      (await success('get_music_entities', { entities }, GetMusicEntitiesResult)).results,
    ).toHaveLength(50)
    expect(Schema.is(GetMusicEntitiesInput)({ entities: [...entities, entities[0]] })).toBe(false)

    for (const args of [
      { query: 'x', limit: 0 },
      { query: 'x', limit: 51 },
      { query: 'x', offset: -1 },
      { query: 'x', offset: 10001 },
    ])
      expect(Schema.is(SearchMusicInput)(args)).toBe(false)
    expect(Schema.is(MusicRef)({ entityType: 'playlist', entityId: 'playlist-private' })).toBe(
      false,
    )
    expect(Schema.is(MusicRef)({ entityType: 'audio', entityId: 'mix' })).toBe(false)
    // JSON escaping means this is over 256KiB despite fewer than 100000 characters.
    await db
      .update(musicArtistsTable)
      .set({ name: '\u0001'.repeat(45000) })
      .where(eq(musicArtistsTable.id, 'bounded-000'))

    const oversize = await call('get_music_entity', {
      entityType: 'artist',
      entityId: 'bounded-000',
    })

    expect(oversize.isError).toBe(true)
    expect(oversize.content.map((item) => item.text).join('')).toContain('unavailable')
    expect(new TextEncoder().encode(JSON.stringify(oversize)).byteLength).toBeLessThan(256 * 1024)
  } finally {
    await db.delete(musicArtistsTable).where(sql`id like 'bounded-%'`)
  }
})
