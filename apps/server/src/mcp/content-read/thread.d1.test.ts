import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import * as tables from '@/db/exports'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { MdxServiceCatalogLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { PostServiceLayer } from '@/services/post.service'
import { RichContentMusicResolverLayer } from '@/services/rich-content-music.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { db, d1 } from '@/test/database'

import { McpActor } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { makeMcpLayer } from '../server'
import {
  PublicMicroThreadResult,
  PublicThreadHandlersLayer,
  PublicThreadServiceLayer,
  PublicThreadToolkit,
} from './thread'

const queries: Array<string> = []

const providers: Array<string> = []

const database = Layer.succeed(
  Database,
  drizzle(d1, { schema: tables, logger: { logQuery: (query) => queries.push(query) } }),
)

const mdx = MdxServiceCatalogLayer.pipe(
  Layer.provide(RichContentMusicResolverLayer.pipe(Layer.provide(database))),
  Layer.provide(
    Layer.succeed(ExternalMediaFetcher, async (url) => {
      providers.push(url)

      return new Response('', { status: 404 })
    }),
  ),
)

const posts = PostServiceLayer.pipe(
  Layer.provide(mdx),
  Layer.provide(UnavailableObjectStoreClientLayer),
  Layer.provide(Layer.mergeAll(ConfigServiceLayer, UploadAssetServiceLayer)),
  Layer.provide(database),
)

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], PublicThreadToolkit).pipe(
    Layer.provide(PublicThreadHandlersLayer),
    Layer.provide(PublicThreadServiceLayer),
    Layer.provide(posts),
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
          userId: 'thread-reader',
          clientId: 'thread-client',
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

const call = async (args: Schema.Json, scope = 'content:read') => {
  const response = await app.handler(
    new Request(config.resourceUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'read_micro_thread',
        'x-test-scope': scope,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'read_micro_thread',
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

const read = async (slug: string, limit = 20, offset = 0) =>
  Schema.decodeUnknownSync(PublicMicroThreadResult)(
    (await call({ slug, limit, offset })).result?.structuredContent,
  )

const node = (
  id: string,
  parentPostId: string | null,
  rootPostId: string | null,
  createdAt = 2000,
) => ({
  id,
  slug: id,
  type: 'micro' as const,
  title: null,
  content: `Prose ${id}`,
  parentPostId,
  rootPostId,
  createdAt: new Date(createdAt),
})

beforeAll(async () => {
  await db.insert(user).values([
    { id: 'thread-reader', name: 'Listener', email: 'thread-reader@example.test', role: 'user' },
    { id: 'banned-author', name: 'Banned', email: 'banned-author@example.test', banned: true },
  ])

  const initialPosts = [
    {
      ...node('root', null, null, 1000),
      title: 'Authored title',
      content:
        'All **authored prose** survives.\n\n::music{type="playlist" id="SECRET-PLAYLIST"}\n\n> ::playlist{url="https://open.spotify.com/playlist/SECRET-URL" blurb="SECRET-BLURB"}\n\n:::cards\n::music{type="playlist" id="SECRET-NESTED"}\n:::\n\n<div data-id="SECRET-UNSUPPORTED">hidden source</div>\n\n::media{url="https://youtu.be/SECRET-MEDIA"}',
    },
    node('z', 'root', 'root'),
    node('a', 'root', 'root'),
    node('later', 'root', 'root', 3000),
    { ...node('private-child', 'root', 'root'), draft: true },
    node('public-under-private', 'private-child', 'root'),
    node('banned-child', 'root', 'root'),
    node('public-under-banned', 'banned-child', 'root'),
    { ...node('private-root', null, null), draft: true },
    node('public-focus-private-root', 'private-root', 'private-root'),
    node('banned-root', null, null),
    node('public-focus-banned-root', 'banned-root', 'banned-root'),
    node('empty-root', null, null),
    { ...node('wrong-type', null, null), type: 'post' as const },
    node('body-budget', null, null),
    node('deep-root', null, null),
    node('wide-root', null, null),
  ]

  for (const post of initialPosts) await db.insert(postsTable).values(post)
  await db
    .insert(postCreators)
    .values(
      ['banned-child', 'banned-root'].map((postId) => ({ postId, creatorId: 'banned-author' })),
    )
})

afterAll(() => app.dispose())

test('full unhydrated prose survives without embed IDs/URLs/unsupported source or catalogue/provider resolution', async () => {
  const start = queries.length
  const page = await read('root')
  expect(page.bodyMode).toBe('unhydrated')
  expect(JSON.stringify(page.root.body)).toContain('All ')
  expect(JSON.stringify(page.root.body)).toContain('authored prose')
  expect(JSON.stringify(page.root.body)).toContain('survives.')
  expect(JSON.stringify(page)).not.toContain('SECRET')
  expect(JSON.stringify(page)).not.toContain('hidden source')
  expect(JSON.stringify(page.root.body)).toContain('UnavailableEmbed')
  expect(Object.keys(page.root).sort()).toEqual([
    'body',
    'createdAt',
    'parentPostId',
    'postId',
    'rootPostId',
    'slug',
    'title',
    'updatedAt',
  ])
  expect(
    queries
      .slice(start)
      .every(
        (query) => !query.includes('music_playlists') && !query.includes('music_entity_links'),
      ),
  ).toBe(true)
  expect(providers).toEqual([])
})

test('public subtree pruning occurs before counts/pages; equal-time ID ties and primary time order are deterministic', async () => {
  const ids: Array<string> = []

  for (const offset of [0, 1, 2, 3]) {
    const page = await read('a', 1, offset)
    expect(page.root.postId).toBe('root')
    expect(page.focus.postId).toBe('a')
    expect(page.pagination.total).toBe(3)
    expect(page.pagination.hasMore).toBe(offset < 2)
    ids.push(...page.posts.map((post) => post.postId))
    expect(JSON.stringify(page)).not.toContain('private-child')
    expect(JSON.stringify(page)).not.toContain('banned-child')
  }

  expect(ids).toEqual(['a', 'z', 'later'])
})

test('missing, private, wrong-type and private/banned ancestor paths never return focus/root identities', async () => {
  for (const slug of [
    'missing',
    'private-child',
    'private-root',
    'wrong-type',
    'public-under-private',
    'public-focus-private-root',
    'banned-child',
    'public-under-banned',
    'public-focus-banned-root',
  ]) {
    const output = await call({ slug })
    expect(JSON.stringify(output)).toContain('not_found')
    expect(output.result?.structuredContent).toBeUndefined()
  }

  const empty = await read('empty-root')
  expect(empty.posts).toEqual([])
  expect(empty.pagination).toEqual({ total: 0, limit: 20, offset: 0, hasMore: false })
})

test('depth 8 succeeds and depth 9 fails closed, not a partial thread', async () => {
  for (let depth = 1; depth <= 8; depth++)
    await db
      .insert(postsTable)
      .values(node(`deep-${depth}`, depth === 1 ? 'deep-root' : `deep-${depth - 1}`, 'deep-root'))
  expect((await read('deep-8')).pagination.total).toBe(8)
  await db.insert(postsTable).values(node('deep-9', 'deep-8', 'deep-root'))
  expect(JSON.stringify(await call({ slug: 'deep-root' }))).toContain('unavailable')
  expect(JSON.stringify(await call({ slug: 'deep-9' }))).toContain('unavailable')
})

test('500 visible nodes succeed; node 501 fails instead of silently truncating totals', async () => {
  const children = Array.from({ length: 499 }, (_, index) =>
    node(`wide-${index}`, 'wide-root', 'wide-root'),
  )

  for (let start = 0; start < children.length; start += 5)
    await db.insert(postsTable).values(children.slice(start, start + 5))
  expect((await read('wide-root', 1)).pagination.total).toBe(499)
  await db.insert(postsTable).values(node('wide-overflow', 'wide-root', 'wide-root'))
  expect(JSON.stringify(await call({ slug: 'wide-root', limit: 1 }))).toContain('unavailable')
})

test('source bytes are bounded before parsing and output bytes fail closed', async () => {
  await db
    .update(postsTable)
    .set({ content: 'x'.repeat(100 * 1024) })
    .where(eq(postsTable.id, 'body-budget'))
  expect(JSON.stringify((await read('body-budget')).root.body)).toContain('x'.repeat(1024))
  await db
    .update(postsTable)
    .set({ content: 'x'.repeat(100 * 1024 + 1) })
    .where(eq(postsTable.id, 'body-budget'))
  expect(JSON.stringify(await call({ slug: 'body-budget' }))).toContain('unavailable')
  await db
    .update(postsTable)
    .set({ content: 'é'.repeat(100 * 1024) })
    .where(eq(postsTable.id, 'body-budget'))
  expect(JSON.stringify(await call({ slug: 'body-budget' }))).toContain('unavailable')
  await db
    .update(postsTable)
    .set({ content: 'x'.repeat(96 * 1024) })
    .where(eq(postsTable.id, 'body-budget'))
  await db.insert(postsTable).values({
    ...node('output-budget', 'body-budget', 'body-budget'),
    content: 'x'.repeat(96 * 1024),
  })
  expect(JSON.stringify(await call({ slug: 'output-budget' }))).toContain('unavailable')
})

test('scope, input bounds and live account ban apply even to admins', async () => {
  expect(JSON.stringify(await call({ slug: 'root' }, 'posts:read'))).toContain('access_denied')

  for (const input of [
    { slug: 'root', limit: 51 },
    { slug: 'root', limit: 0 },
    { slug: 'root', offset: -1 },
    { slug: 'root', offset: 10001 },
    { slug: 'x'.repeat(201) },
  ]) {
    const output = await call(input)
    expect(output.error !== undefined || output.result?.isError === true).toBe(true)
  }

  await db.update(user).set({ role: 'admin', banned: true }).where(eq(user.id, 'thread-reader'))

  try {
    expect(JSON.stringify(await call({ slug: 'root' }))).toContain('access_denied')
  } finally {
    await db.update(user).set({ role: 'user', banned: false }).where(eq(user.id, 'thread-reader'))
  }
})

test('parser limits fail closed and capped tables are explicitly omitted', async () => {
  await db.insert(postsTable).values({
    ...node('parser-budget', null, null),
    content: `${'> '.repeat(15)}Deep authored text`,
  })
  expect(JSON.stringify(await call({ slug: 'parser-budget' }))).toContain('unavailable')
  await db
    .update(postsTable)
    .set({ content: 'paragraph\n\n'.repeat(2001) })
    .where(eq(postsTable.id, 'parser-budget'))
  expect(JSON.stringify(await call({ slug: 'parser-budget' }))).toContain('unavailable')
  await db
    .update(postsTable)
    .set({ content: '| Column |\n| --- |\n| hidden table cell |' })
    .where(eq(postsTable.id, 'parser-budget'))
  const result = await read('parser-budget')
  expect(JSON.stringify(result.root.body)).toContain('Tables are omitted')
  expect(JSON.stringify(result.root.body)).not.toContain('hidden table cell')
})

test('all thread protocol calls, including failures, are SELECT-only and provider-free', async () => {
  await read('empty-root')
  expect(queries.length).toBeGreaterThan(0)
  expect(queries.every((query) => query.trimStart().toLowerCase().startsWith('select'))).toBe(true)
  expect(providers).toEqual([])
})
