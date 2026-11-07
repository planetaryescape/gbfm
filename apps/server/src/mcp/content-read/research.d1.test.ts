import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { audioArtists, audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import * as tables from '@/db/exports'
import { Database } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  listeningMembershipsTable as memberships,
  savedMixesTable as saves,
} from '@/db/listening.schema'
import { musicArtistsTable } from '@/db/music-entity.schema'
import { postsTable } from '@/db/post.schema'
import { showsTable } from '@/db/show.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { MdxServiceCatalogLayer } from '@/lib/mdx'
import { AudioServiceLayer } from '@/services/audio.service'
import { ConfigServiceLayer } from '@/services/config.service'
import { ProfileServiceLayer } from '@/services/profile.service'
import { RichContentMusicResolverLayer } from '@/services/rich-content-music.service'
import { SearchServiceLayer } from '@/services/search.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { db, d1 } from '@/test/database'

import { McpActor } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { makeMcpLayer } from '../server'
import {
  PublicCollectionResult,
  PublicMixResult,
  PublicProfileResult,
  PublicSearchResult,
} from './research-contracts'
import { PublicResearchServiceLayer } from './research-service'
import { PublicResearchHandlersLayer, PublicResearchToolkit } from './research-toolkit'

const queries: Array<string> = []

const providerRequests: Array<string> = []

const database = Layer.succeed(
  Database,
  drizzle(d1, { schema: tables, logger: { logQuery: (query) => queries.push(query) } }),
)

const mdx = MdxServiceCatalogLayer.pipe(
  Layer.provide(RichContentMusicResolverLayer.pipe(Layer.provide(database))),
  Layer.provide(
    Layer.succeed(ExternalMediaFetcher, async (url) => {
      providerRequests.push(url)

      return new Response('', { status: 404 })
    }),
  ),
)

const audio = AudioServiceLayer.pipe(
  Layer.provide(mdx),
  Layer.provide(ConfigServiceLayer),
  Layer.provide(UploadAssetServiceLayer),
  Layer.provide(UnavailableObjectStoreClientLayer),
  Layer.provide(database),
)

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], PublicResearchToolkit).pipe(
    Layer.provide(PublicResearchHandlersLayer),
    Layer.provide(PublicResearchServiceLayer),
    Layer.provide(audio),
    Layer.provide(ProfileServiceLayer.pipe(Layer.provide(database))),
    Layer.provide(SearchServiceLayer.pipe(Layer.provide(database))),
    Layer.provide(database),
    Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        const actor = yield* Schema.decodeUnknownEffect(McpPrincipal)({
          userId: 'research-listener',
          clientId: 'research-client',
          scopes: [request.headers['x-test-scope'] ?? 'content:read'],
        })

        return yield* effect.pipe(Effect.provideService(McpActor, actor))
      }),
  },
)

const Envelope = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      isError: Schema.optional(Schema.Boolean),
      structuredContent: Schema.optional(Schema.Unknown),
      content: Schema.Array(
        Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
      ),
    }),
  ),
  error: Schema.optional(Schema.Unknown),
})

const call = async (name: string, args: Schema.Json, scope = 'content:read') => {
  const response = await app.handler(
    new Request('https://api.example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
        'x-test-scope': scope,
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

  expect(response.status).toBe(200)
  const body = await response.text()

  const payload =
    body.startsWith('event:') || body.startsWith('data:')
      ? body
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : body

  if (!payload) throw new Error('Missing MCP response')

  return Schema.decodeUnknownSync(Envelope)(JSON.parse(payload))
}

beforeAll(async () => {
  await db.insert(user).values([
    {
      id: 'research-listener',
      name: 'Listener',
      username: 'listener',
      email: 'listener@research.test',
      role: 'user',
    },
    { id: 'other-owner', name: 'Other', username: 'other', email: 'other@research.test' },
    {
      id: 'banned-profile',
      name: 'Banned',
      username: 'banned',
      email: 'banned@research.test',
      banned: true,
    },
  ])
  await db.insert(showsTable).values([
    {
      id: 'public-show',
      slug: 'public-show',
      title: 'Needle Show',
      content: 'https://provider.test/not-rendered',
    },
    {
      id: 'private-show',
      slug: 'SECRET-SHOW',
      title: 'Needle private',
      draft: true,
      content: 'SECRET BODY',
      thumbnailUrl: 'https://secret.test/image',
    },
  ])
  await db.insert(audioTable).values([
    {
      id: 'a',
      slug: 'a',
      title: 'Needle A',
      type: 'mix',
      url: 'https://media.test/a',
      content: 'https://provider.test/not-rendered',
      showId: 'private-show',
      createdAt: new Date(2000),
    },
    {
      id: 'z',
      slug: 'z',
      title: 'Needle Z',
      type: 'mix',
      url: 'https://media.test/z',
      content: 'https://provider.test/not-rendered',
      createdAt: new Date(2000),
    },
    {
      id: 'new',
      slug: 'new',
      title: 'Needle newest',
      type: 'track',
      url: 'https://media.test/new',
      content: 'body',
      createdAt: new Date(3000),
    },
    {
      id: 'draft',
      slug: 'draft',
      title: 'Needle SECRET',
      type: 'mix',
      url: 'https://media.test/draft',
      draft: true,
      content: 'SECRET',
      createdAt: new Date(4000),
    },
  ])
  await db.insert(postsTable).values([
    { id: 'post', slug: 'post', title: 'Needle Post', type: 'post', content: 'not rendered' },
    {
      id: 'draft-post',
      slug: 'draft-post',
      title: 'Needle SECRET',
      type: 'micro',
      draft: true,
      content: 'SECRET',
    },
  ])
  await db.insert(musicArtistsTable).values(
    ['dj', 'unpublished', 'not-dj', 'banned', 'listener'].map((slug) => ({
      id: slug,
      slug,
      name: `Artist ${slug}`,
      publishedAt: slug === 'unpublished' ? null : new Date(1000),
    })),
  )
  await db.insert(audioArtists).values(
    ['dj', 'unpublished', 'banned', 'listener'].map((artistId) => ({
      audioId: 'draft',
      artistId,
    })),
  )
  await db.insert(collections).values([
    { id: 'public', userId: 'research-listener', title: 'Public collection', published: true },
    { id: 'private', userId: 'research-listener', title: 'SECRET collection', published: false },
    { id: 'empty', userId: 'other-owner', title: 'Empty', published: true },
  ])
  await db.insert(saves).values([
    {
      id: 'saved-a',
      userId: 'research-listener',
      title: 'A',
      url: 'https://soundcloud.com/a/mix',
      platform: 'soundcloud',
      published: true,
      notes: 'Public notes',
      createdAt: 2000,
    },
    {
      id: 'saved-z',
      userId: 'research-listener',
      title: 'Z',
      url: 'https://soundcloud.com/z/mix',
      platform: 'soundcloud',
      published: true,
      createdAt: 2000,
    },
    {
      id: 'saved-new',
      userId: 'research-listener',
      title: 'New',
      url: 'https://soundcloud.com/new/mix',
      platform: 'soundcloud',
      published: true,
      createdAt: 3000,
    },
    {
      id: 'saved-private',
      userId: 'research-listener',
      title: 'SECRET',
      url: 'https://soundcloud.com/private/mix',
      platform: 'soundcloud',
      published: false,
      notes: 'SECRET',
      createdAt: 4000,
    },
    {
      id: 'saved-other',
      userId: 'other-owner',
      title: 'Wrong owner',
      url: 'https://soundcloud.com/other/mix',
      platform: 'soundcloud',
      published: true,
      createdAt: 5000,
    },
  ])
  await db.insert(memberships).values(
    ['saved-a', 'saved-z', 'saved-new', 'saved-private', 'saved-other'].flatMap((mixId) => [
      { collectionId: 'public', mixId },
      { collectionId: 'private', mixId },
    ]),
  )
  queries.length = 0
})

afterAll(async () => {
  await app.dispose()
})

test('searches short/FTS in all namespaces, excludes drafts and private relationships, and pages deterministic ties', async () => {
  for (const query of ['Ne', 'Needle']) {
    for (const kind of ['audio', 'show', 'post']) {
      const output = await call('search_catalogue', { query, kind, limit: 1 })
      const page = Schema.decodeUnknownSync(PublicSearchResult)(output.result?.structuredContent)
      expect(page.pagination.total).toBe(kind === 'audio' ? 3 : 1)
      expect(page.results.map((row) => row.id)).toEqual([
        { audio: 'new', show: 'public-show', post: 'post' }[kind],
      ])
      expect(JSON.stringify(output)).not.toContain('SECRET')
    }
  }

  const ids = []

  for (const offset of [0, 1, 2, 3]) {
    const output = await call('search_catalogue', {
      query: 'Needle',
      kind: 'audio',
      limit: 1,
      offset,
    })

    const page = Schema.decodeUnknownSync(PublicSearchResult)(output.result?.structuredContent)
    ids.push(...page.results.map((row) => row.id))
    expect(page.pagination.hasMore).toBe(offset < 2)
    expect(JSON.stringify(page)).not.toContain('secret.test')
    expect(JSON.stringify(page)).not.toContain('showSlug')
  }

  expect(ids).toEqual(['new', 'z', 'a'])
})

test('mix metadata preserves anonymous audio identity without leaking its private show or rendering its body', async () => {
  const output = await call('get_mix', { slug: 'a' })
  const page = Schema.decodeUnknownSync(PublicMixResult)(output.result?.structuredContent)
  expect(page.mix.audioId).toBe('a')
  expect(page.mix.reviewUrl).toBe('https://example.test/mixes/a')
  expect(Object.keys(page.mix).sort()).toEqual([
    'audioId',
    'createdAt',
    'description',
    'reviewUrl',
    'slug',
    'title',
    'updatedAt',
  ])

  for (const slug of ['draft', 'new', 'missing'])
    expect(JSON.stringify(await call('get_mix', { slug }))).toContain('not_found')
})

test('profile identity keeps user precedence, banned denial and exact published DJ fallback without content expansion', async () => {
  for (const [username, id] of [
    ['listener', 'research-listener'],
    ['dj', 'dj'],
  ] as const) {
    const output = await call('get_public_profile', { username })
    const page = Schema.decodeUnknownSync(PublicProfileResult)(output.result?.structuredContent)
    expect(page.profile.id).toBe(id)
    expect(Object.keys(page.profile).sort()).toEqual(['bio', 'createdAt', 'id', 'name', 'username'])
  }

  for (const username of ['banned', 'unpublished', 'not-dj', 'missing'])
    expect(JSON.stringify(await call('get_public_profile', { username }))).toContain('not_found')
})

test('collection filters private parent/member and cross-owner membership before counts and deterministic paging', async () => {
  const ids = []
  const notes = []

  for (const offset of [0, 1, 2, 3]) {
    const output = await call('get_public_collection', { collectionId: 'public', limit: 1, offset })
    const page = Schema.decodeUnknownSync(PublicCollectionResult)(output.result?.structuredContent)
    expect(page.pagination.total).toBe(3)
    expect(page.pagination.hasMore).toBe(offset < 2)
    expect(JSON.stringify(output)).not.toContain('SECRET')
    ids.push(...page.mixes.map((mix) => mix.id))
    notes.push(...page.mixes.map((mix) => mix.notes))
  }

  expect(ids).toEqual(['saved-new', 'saved-z', 'saved-a'])
  expect(notes).toEqual(['', '', 'Public notes'])

  for (const collectionId of ['private', 'missing'])
    expect(JSON.stringify(await call('get_public_collection', { collectionId }))).toContain(
      'not_found',
    )

  const empty = Schema.decodeUnknownSync(PublicCollectionResult)(
    (await call('get_public_collection', { collectionId: 'empty' })).result?.structuredContent,
  )

  expect(empty.mixes).toEqual([])
  expect(empty.pagination).toEqual({ total: 0, hasMore: false, offset: 0, limit: 20 })
})

test('every entry point requires content:read, enforces input bounds and rejects currently banned callers', async () => {
  const requests = [
    { name: 'search_catalogue', args: { query: 'Needle', kind: 'audio' } },
    { name: 'get_mix', args: { slug: 'a' } },
    { name: 'get_public_profile', args: { username: 'dj' } },
    { name: 'get_public_collection', args: { collectionId: 'public' } },
  ] as const

  for (const { name, args } of requests)
    expect(JSON.stringify(await call(name, args, 'posts:read'))).toContain('access_denied')

  for (const args of [
    { query: '', kind: 'audio' },
    { query: 'x'.repeat(201), kind: 'audio' },
    { query: 'Needle', kind: 'music' },
    { query: 'Ne', kind: 'audio', limit: 51 },
    { query: 'Ne', kind: 'audio', offset: 10001 },
  ]) {
    const output = await call('search_catalogue', args)
    expect(output.error !== undefined || output.result?.isError === true).toBe(true)
  }

  // Writes here are test setup, so use the unrecorded database.
  await db.update(user).set({ banned: true, role: 'admin' }).where(eq(user.id, 'research-listener'))

  try {
    for (const { name, args } of requests)
      expect(JSON.stringify(await call(name, args))).toContain('access_denied')
  } finally {
    await db
      .update(user)
      .set({ banned: false, role: 'user' })
      .where(eq(user.id, 'research-listener'))
  }
})

test('UTF-8 output ceiling fails closed without truncating public metadata', async () => {
  await db
    .update(audioTable)
    .set({ description: 'é'.repeat(140_000) })
    .where(eq(audioTable.id, 'a'))

  try {
    const output = await call('get_mix', { slug: 'a' })
    expect(JSON.stringify(output)).toContain('unavailable')
    expect(JSON.stringify(output)).not.toContain('é')
  } finally {
    await db.update(audioTable).set({ description: null }).where(eq(audioTable.id, 'a'))
  }
})

test('all protocol reads and denials perform zero writes and provider requests', () => {
  expect(queries.length).toBeGreaterThan(0)
  expect(queries.every((sql) => sql.trimStart().toLowerCase().startsWith('select'))).toBe(true)
  expect(providerRequests).toEqual([])
})
