import { PlaylistListResponse } from '@gbfm/api/music'
import { eq } from 'drizzle-orm'
import { Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { DatabaseLayer } from '@/db/layer'
import {
  musicEntityLinksTable,
  musicPlaylistTracksTable,
  musicPlaylistsTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { oauthResource } from '@/db/oauth.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { MdxServiceCatalogLayer } from '@/lib/mdx'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { RichContentMusicResolverLayer } from '@/services/rich-content-music.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

import {
  CompareResult,
  ExportDocument,
  ExportResult,
  PlaylistResult,
  PlaylistTracksResult,
} from './contracts'
import { PlaylistReadServiceLayer } from './service'
import { PlaylistReadHandlersLayer, PlaylistReadToolkit } from './toolkit'

const fixture = await createEditorialOAuthFixture()

const db = fixture.db

const config = Layer.succeed(ConfigService, {
  ...fixture.config,
  auth: {
    ...fixture.config.auth,
    betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
  },
})

const database = DatabaseLayer(db.$client)

const providerRequests: Array<string> = []

const fetcher = Layer.succeed(ExternalMediaFetcher, async (url) => {
  providerRequests.push(url)

  return new Response('', { status: 404 })
})

const base = Layer.mergeAll(
  config,
  UploadAssetServiceLayer,
  UnavailableObjectStoreClientLayer,
  MdxServiceCatalogLayer.pipe(
    Layer.provide(RichContentMusicResolverLayer),
    Layer.provide(database),
    Layer.provide(fetcher),
  ),
).pipe(Layer.provideMerge(database))

const services = Layer.mergeAll(
  base,
  PostServiceLayer.pipe(Layer.provide(base)),
  EditorialOAuthLive.pipe(Layer.provide(base)),
  AuthLive.pipe(
    Layer.provide(EmailDeliveryLive.pipe(Layer.provide(RecordingEmailTransportLayer))),
    Layer.provide(base),
  ),
)

const app = HttpRouter.toWebHandler(
  makeMcpRoutes(
    PlaylistReadToolkit,
    PlaylistReadHandlersLayer.pipe(Layer.provide(PlaylistReadServiceLayer)),
  ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)

const api = createTestWebHandler(
  db.$client,
  undefined,
  undefined,
  undefined,
  config,
  undefined,
  fetcher,
)

const Envelope = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      isError: Schema.optional(Schema.Boolean),
      structuredContent: Schema.optional(Schema.Unknown),
      content: Schema.optional(
        Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
      ),
      tools: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
    }),
  ),
  error: Schema.optional(Schema.Unknown),
})

let reader: Redacted.Redacted

let owner: Redacted.Redacted

let wrongScope: Redacted.Redacted

const rpc = async (name: string, args: Schema.Json = {}, token = reader, method = 'tools/call') => {
  const response = await app.handler(
    new Request(fixture.config.mcp.resourceUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        'mcp-name': name,
        authorization: `Bearer ${Redacted.value(token)}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
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

  const text = await response.text()
  expect(response.headers.get('cache-control')).toBe('private, no-store')

  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : text

  return {
    status: response.status,
    bytes: new TextEncoder().encode(text).byteLength,
    body: payload ? Schema.decodeUnknownSync(Schema.fromJsonString(Envelope))(payload) : undefined,
  }
}

const get = (path: string, actor?: string) =>
  api.handler(
    new Request(`https://editorial-test.localhost${path}`, {
      headers: actor ? { authorization: `Bearer ${actor}-session-token` } : {},
    }),
  )

const failureCode = (result: Awaited<ReturnType<typeof rpc>>) => {
  expect(result.status).toBe(200)
  expect(result.body?.result?.isError).toBe(true)
  const text = result.body?.result?.content?.[0]?.text

  return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ code: Schema.String })))(
    text ?? '',
  ).code
}

beforeAll(async () => {
  await db
    .update(oauthResource)
    .set({ allowedScopes: JSON.stringify(['catalogue:read', 'posts:read', 'offline_access']) })
  const client = await fixture.register('catalogue:read posts:read offline_access')

  const grant = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(
          client,
          await fixture.authorize(client, actor, `${scope} offline_access`),
        )
      ).json(),
    ).access_token

  reader = await grant('reader', 'catalogue:read')
  owner = await grant('owner', 'catalogue:read')
  wrongScope = await grant('owner', 'posts:read')
  await seedMusicLookups(db)
  await db.insert(musicPlaylistsTable).values([
    { id: 'left', slug: 'left', title: 'Left', publishedAt: new Date(1), createdById: 'owner' },
    { id: 'right', slug: 'right', title: 'Right', publishedAt: new Date(1), createdById: 'other' },
    { id: 'private', slug: 'private', title: 'PRIVATE TITLE', createdById: 'owner' },
    {
      id: 'future',
      slug: 'future',
      title: 'FUTURE TITLE',
      publishedAt: new Date('2099-01-01'),
      createdById: 'other',
    },
    { id: 'empty', slug: 'empty', title: 'Empty', publishedAt: new Date(1) },
    { id: 'large', slug: 'large', title: 'Large', publishedAt: new Date(1) },
  ])
  await db.insert(musicTracksTable).values([
    { id: 'a', slug: 'a', title: 'Same name', artistNames: ['Artist'] },
    {
      id: 'b',
      slug: 'b',
      title: 'Same name',
      artistNames: ['Artist'],
      publishedAt: new Date('2099-01-01'),
    },
    { id: 'c', slug: 'c', title: 'Other track' },
  ])
  await db.insert(musicPlaylistTracksTable).values([
    { playlistId: 'left', trackId: 'b', position: 4 },
    { playlistId: 'left', trackId: 'a', position: 4 },
    { playlistId: 'left', trackId: 'c', position: 12 },
    { playlistId: 'right', trackId: 'b', position: 0 },
    { playlistId: 'private', trackId: 'a', position: 0 },
    { playlistId: 'future', trackId: 'c', position: 0 },
  ])
  await db.insert(musicEntityLinksTable).values([
    {
      entityType: 'track',
      entityId: 'a',
      platform: 'spotify',
      url: 'https://open.spotify.com/track/existing',
      status: 'verified',
    },
    {
      entityType: 'track',
      entityId: 'b',
      platform: 'spotify',
      url: 'https://open.spotify.com/track/unverified',
      status: 'pending',
    },
    {
      entityType: 'playlist',
      entityId: 'left',
      platform: 'spotify',
      url: 'https://open.spotify.com/playlist/existing',
      status: 'verified',
    },
  ])
})

afterAll(async () => {
  await app.dispose()
  await api.dispose()
  await fixture[Symbol.asyncDispose]()
})

test('actual public API and persisted OAuth enforce one playlist publication policy, with separate browser ownership', async () => {
  for (const actor of [undefined, 'reader', 'owner', 'other']) {
    const response = await get('/api/music/playlists', actor)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')

    const rows = Schema.decodeUnknownSync(Schema.fromJsonString(PlaylistListResponse))(
      await response.text(),
    )

    expect(rows.map((row) => row.id).sort()).toEqual(
      [
        'empty',
        'large',
        'left',
        'right',
        ...(actor === 'owner' ? ['private'] : []),
        ...(actor === 'other' ? ['future'] : []),
      ].sort(),
    )

    for (const id of ['private', 'future']) {
      const allowed =
        (id === 'private' && actor === 'owner') || (id === 'future' && actor === 'other')

      expect((await get(`/api/music/playlists/${id}`, actor)).status).toBe(allowed ? 200 : 404)
      expect((await get(`/api/music/playlists/${id}/tracks`, actor)).status).toBe(
        allowed ? 200 : 404,
      )
    }
  }

  for (const token of [reader, owner]) {
    for (const id of ['private', 'future', 'absent']) {
      for (const name of ['get_playlist', 'get_playlist_tracks', 'export_playlist'])
        expect(failureCode(await rpc(name, { playlistId: id }, token))).toBe('not_found')
      expect(
        failureCode(
          await rpc('compare_playlists', { leftPlaylistId: 'left', rightPlaylistId: id }, token),
        ),
      ).toBe('not_found')
    }
  }

  const listed = await rpc('', {}, reader, 'tools/list')
  expect(listed.body?.result?.tools?.map((tool) => tool.name).sort()).toEqual([
    'compare_playlists',
    'export_playlist',
    'get_playlist',
    'get_playlist_tracks',
  ])
  expect((await rpc('', {}, wrongScope, 'tools/list')).body?.result?.tools).toEqual([])
  expect(failureCode(await rpc('get_playlist', { playlistId: 'left' }, wrongScope))).toBe(
    'access_denied',
  )
})

test('pages, comparison and portable export retain stable identity/positions, never infer recording equality', async () => {
  const before = await Promise.all([
    db.select().from(musicPlaylistsTable),
    db.select().from(musicPlaylistTracksTable),
    db.select().from(musicTracksTable),
    db.select().from(musicEntityLinksTable),
  ])

  const result = await rpc('get_playlist_tracks', { playlistId: 'left', limit: 2 })

  const page = Schema.decodeUnknownSync(PlaylistTracksResult)(
    result.body?.result?.structuredContent,
  )

  expect(page.entries.map(({ trackId, position }) => [trackId, position])).toEqual([
    ['a', 4],
    ['b', 4],
  ])
  expect(page.pagination).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true })
  expect(page.entries[0]?.track?.links).toEqual([
    { platform: 'spotify', url: 'https://open.spotify.com/track/existing' },
  ])
  expect(page.entries[1]?.track?.links).toEqual([])

  const tail = Schema.decodeUnknownSync(PlaylistTracksResult)(
    (await rpc('get_playlist_tracks', { playlistId: 'left', limit: 2, offset: 2 })).body?.result
      ?.structuredContent,
  )

  expect(tail.entries.map((entry) => entry.position)).toEqual([12])
  expect(tail.pagination.hasMore).toBe(false)

  const comparison = Schema.decodeUnknownSync(CompareResult)(
    (await rpc('compare_playlists', { leftPlaylistId: 'left', rightPlaylistId: 'right' })).body
      ?.result?.structuredContent,
  )

  expect(comparison.sharedTrackIds).toEqual(['b'])
  expect(comparison.leftOnlyTrackIds).toEqual(['a', 'c'])
  expect(comparison.rightOnlyTrackIds).toEqual([])
  expect(comparison.identity).toBe('gbfm_track_id')

  const exported = Schema.decodeUnknownSync(ExportResult)(
    (await rpc('export_playlist', { playlistId: 'left' })).body?.result?.structuredContent,
  )

  const document = Schema.decodeUnknownSync(Schema.fromJsonString(ExportDocument))(exported.content)
  expect(document.entries.map((entry) => [entry.trackId, entry.position])).toEqual([
    ['a', 4],
    ['b', 4],
    ['c', 12],
  ])
  expect(exported.byteLength).toBe(new TextEncoder().encode(exported.content).byteLength)
  expect(exported.content).not.toContain('createdById')
  expect(exported.content).not.toContain('curatorId')
  expect(exported.content).not.toContain('sourceMetadata')
  expect(
    (await rpc('export_playlist', { playlistId: 'left' })).body?.result?.structuredContent,
  ).toEqual(exported)
  expect(
    Schema.decodeUnknownSync(PlaylistResult)(
      (await rpc('get_playlist', { playlistId: 'left' })).body?.result?.structuredContent,
    ).playlist.links,
  ).toHaveLength(1)
  expect(
    await Promise.all([
      db.select().from(musicPlaylistsTable),
      db.select().from(musicPlaylistTracksTable),
      db.select().from(musicTracksTable),
      db.select().from(musicEntityLinksTable),
    ]),
  ).toEqual(before)
  expect(providerRequests).toEqual([])
})

test('missing tracks follow migrated foreign-key cascade, empty pages/counts and exports stay truthful', async () => {
  await db.insert(musicTracksTable).values({ id: 'deleted', slug: 'deleted', title: 'Removed' })
  await db
    .insert(musicPlaylistTracksTable)
    .values({ playlistId: 'empty', trackId: 'deleted', position: 9 })
  await db.delete(musicTracksTable).where(eq(musicTracksTable.id, 'deleted'))

  const page = Schema.decodeUnknownSync(PlaylistTracksResult)(
    (await rpc('get_playlist_tracks', { playlistId: 'empty' })).body?.result?.structuredContent,
  )

  expect(page.entries).toEqual([])
  expect(page.pagination).toEqual({ limit: 50, offset: 0, total: 0, hasMore: false })

  const exported = Schema.decodeUnknownSync(ExportResult)(
    (await rpc('export_playlist', { playlistId: 'empty' })).body?.result?.structuredContent,
  )

  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(ExportDocument))(exported.content).entries,
  ).toEqual([])
})

test('500 versus 501 memberships, invalid paging, Unicode file bytes and escaped MCP envelope budgets', async () => {
  for (let offset = 0; offset < 501; offset += 10) {
    const values = Array.from({ length: Math.min(10, 501 - offset) }, (_, index) => {
      const id = `bounded-${String(offset + index).padStart(3, '0')}`

      return { id, slug: id, title: `Track ${offset + index}` }
    })

    await db.insert(musicTracksTable).values(values)
    await db.insert(musicPlaylistTracksTable).values(
      values.map((row, index) => ({
        playlistId: 'large',
        trackId: row.id,
        position: offset + index,
      })),
    )
  }

  expect(failureCode(await rpc('export_playlist', { playlistId: 'large' }))).toBe('invalid_input')
  expect(
    failureCode(
      await rpc('compare_playlists', { leftPlaylistId: 'large', rightPlaylistId: 'left' }),
    ),
  ).toBe('invalid_input')
  await db
    .delete(musicPlaylistTracksTable)
    .where(eq(musicPlaylistTracksTable.trackId, 'bounded-500'))
  expect(
    Schema.decodeUnknownSync(CompareResult)(
      (await rpc('compare_playlists', { leftPlaylistId: 'large', rightPlaylistId: 'left' })).body
        ?.result?.structuredContent,
    ).leftOnlyTrackIds,
  ).toHaveLength(500)
  const invalid = await rpc('get_playlist_tracks', { playlistId: 'left', limit: 101 })
  expect(invalid.body?.error ?? invalid.body?.result?.isError).toBeTruthy()
  const invalidOffset = await rpc('get_playlist_tracks', { playlistId: 'left', offset: 10001 })
  expect(invalidOffset.body?.error ?? invalidOffset.body?.result?.isError).toBeTruthy()
  await db
    .update(musicPlaylistsTable)
    .set({ description: 'é'.repeat(33_000) })
    .where(eq(musicPlaylistsTable.id, 'empty'))
  expect(failureCode(await rpc('export_playlist', { playlistId: 'empty' }))).toBe('invalid_input')
  await db
    .update(musicPlaylistsTable)
    .set({ description: '"\\'.repeat(40_000) })
    .where(eq(musicPlaylistsTable.id, 'empty'))
  const overflow = await rpc('get_playlist', { playlistId: 'empty' })
  expect(failureCode(overflow)).toBe('invalid_input')
  expect(overflow.bytes).toBeLessThan(256 * 1024)
  await db
    .update(musicPlaylistsTable)
    .set({ description: null })
    .where(eq(musicPlaylistsTable.id, 'empty'))
})

test('cached OAuth token is refused after current account ban', async () => {
  await db.update(user).set({ banned: true }).where(eq(user.id, 'reader'))
  expect((await rpc('get_playlist', { playlistId: 'left' })).status).toBe(401)
  await db.update(user).set({ banned: false }).where(eq(user.id, 'reader'))
})
