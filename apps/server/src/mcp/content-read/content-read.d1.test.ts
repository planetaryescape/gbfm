import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import * as tables from '@/db/exports'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { showsTable } from '@/db/show.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { MdxServiceCatalogLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { PostServiceLayer } from '@/services/post.service'
import { RichContentMusicResolverLayer } from '@/services/rich-content-music.service'
import { ShowServiceLayer } from '@/services/show.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { db, d1 } from '@/test/database'

import { McpActor } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { makeMcpLayer } from '../server'
import { PublishedPostsResult, PublicShowResult, ShowEpisodesResult } from './contracts'
import { ContentReadServiceLayer } from './service'
import { ContentReadHandlersLayer, ContentReadToolkit } from './toolkit'

const queries: Array<string> = []

const recordedDb = drizzle(d1, {
  schema: tables,
  logger: { logQuery: (query) => queries.push(query) },
})

const database = Layer.succeed(Database, recordedDb)

const providerRequests: Array<string> = []

const mdxLayer = MdxServiceCatalogLayer.pipe(
  Layer.provide(RichContentMusicResolverLayer.pipe(Layer.provide(database))),
  Layer.provide(
    Layer.succeed(ExternalMediaFetcher, async (url) => {
      providerRequests.push(url)

      return new Response('', { status: 404 })
    }),
  ),
)

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const postLayer = PostServiceLayer.pipe(
  Layer.provide(mdxLayer),
  Layer.provide(UnavailableObjectStoreClientLayer),
  Layer.provide(Layer.mergeAll(ConfigServiceLayer, UploadAssetServiceLayer)),
  Layer.provide(database),
)

const showLayer = ShowServiceLayer.pipe(
  Layer.provide(mdxLayer),
  Layer.provide(ConfigServiceLayer),
  Layer.provide(UnavailableObjectStoreClientLayer),
  Layer.provide(database),
)

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], ContentReadToolkit).pipe(
    Layer.provide(ContentReadHandlersLayer),
    Layer.provide(ContentReadServiceLayer),
    Layer.provide(postLayer),
    Layer.provide(showLayer),
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
          userId: 'content-listener',
          clientId: 'content-client',
          scopes: [request.headers['x-test-scope'] ?? 'content:read'],
        })

        return yield* effect.pipe(Effect.provideService(McpActor, actor))
      }),
  },
)

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Unknown),
  content: Schema.Array(
    Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  ),
})

const Envelope = Schema.Struct({
  result: Schema.optional(ToolResult),
  error: Schema.optional(Schema.Unknown),
})

const call = async (
  args: Schema.Json = {},
  scope = 'content:read',
  name = 'list_published_posts',
) => {
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

  const text = await response.text()

  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : text

  if (!payload) throw new Error('Missing MCP response')
  expect(response.status).toBe(200)

  return Schema.decodeUnknownSync(Envelope)(JSON.parse(payload))
}

beforeAll(async () => {
  await db.insert(user).values({
    id: 'content-listener',
    name: 'Listener',
    email: 'listener@example.test',
    role: 'user',
  })
  await db.insert(postsTable).values([
    {
      id: 'public-older',
      slug: 'public-older',
      title: 'Older public post',
      type: 'post',
      content: 'Body',
      createdAt: new Date(1000),
    },
    {
      id: 'public-newer',
      slug: 'public-newer',
      title: 'Newer public post',
      type: 'post',
      content: 'https://private.bandcamp.com/album/not-fetched',
      createdAt: new Date(3000),
    },
    {
      id: 'private-draft',
      slug: 'private-draft',
      title: 'SECRET DRAFT',
      type: 'post',
      draft: true,
      content: 'SECRET BODY',
      createdAt: new Date(5000),
    },
    {
      id: 'blank-public',
      slug: 'blank-public',
      title: 'Blank public row',
      type: 'post',
      content: ' ',
      createdAt: new Date(2000),
    },
    {
      id: 'public-micro',
      slug: 'public-micro',
      title: 'Public micro',
      type: 'micro',
      content: 'Micro',
      createdAt: new Date(6000),
    },
  ])
  await db.insert(postCreators).values({ postId: 'private-draft', creatorId: 'content-listener' })
  // Both relationship directions must stay out of this summary projection.
  await db
    .update(postsTable)
    .set({ quotedPostId: 'private-draft' })
    .where(eq(postsTable.id, 'public-newer'))
  await db
    .update(postsTable)
    .set({ quotedPostId: 'public-older' })
    .where(eq(postsTable.id, 'private-draft'))
  await db.insert(showsTable).values([
    {
      id: 'public-show',
      slug: 'public-show',
      title: 'Public show',
      content: 'https://private.bandcamp.com/album/not-fetched',
    },
    {
      id: 'draft-show',
      slug: 'draft-show',
      title: 'SECRET SHOW',
      content: 'SECRET SHOW BODY',
      draft: true,
    },
  ])
  await db.insert(audioTable).values([
    {
      id: 'old-episode',
      slug: 'old-episode',
      title: 'Old episode',
      type: 'track',
      content: 'Do not render',
      url: 'https://example.test/old.mp3',
      showId: 'public-show',
      createdAt: new Date(1000),
    },
    {
      id: 'new-episode',
      slug: 'new-episode',
      title: 'New episode',
      type: 'mix',
      content: 'Do not render',
      url: 'https://example.test/new.mp3',
      showId: 'public-show',
      createdAt: new Date(3000),
    },
    {
      id: 'draft-episode',
      slug: 'draft-episode',
      title: 'SECRET EPISODE',
      type: 'mix',
      content: 'SECRET',
      url: 'https://example.test/private.mp3',
      showId: 'public-show',
      draft: true,
      createdAt: new Date(5000),
    },
    {
      id: 'public-child-of-draft',
      slug: 'public-child-of-draft',
      title: 'Hidden via draft parent',
      type: 'mix',
      content: 'Do not render',
      url: 'https://example.test/hidden.mp3',
      showId: 'draft-show',
      createdAt: new Date(7000),
    },
  ])
})

afterAll(() => app.dispose())

test('listener public summaries filter drafts before counts/paging, omit private relationships and never write', async () => {
  queries.length = 0
  const first = await call({ limit: 1 })
  const page = Schema.decodeUnknownSync(PublishedPostsResult)(first.result?.structuredContent)
  expect(page.posts.map((post) => post.postId)).toEqual(['public-newer'])
  expect(page.pagination).toEqual({ limit: 1, offset: 0, total: 3, hasMore: true })
  expect(page.posts[0]?.reviewUrl).toBe('https://example.test/editorial/public-newer')
  expect(page.endpoint.environment).toBe('test')
  expect(JSON.stringify(first)).not.toMatch(
    /SECRET|private-draft|quotedPostId|creator|bandcamp|content-listener/,
  )

  const blank = Schema.decodeUnknownSync(PublishedPostsResult)(
    (await call({ limit: 1, offset: 1 })).result?.structuredContent,
  )

  expect(blank.posts).toEqual([])
  expect(blank.pagination.hasMore).toBe(true)

  const last = Schema.decodeUnknownSync(PublishedPostsResult)(
    (await call({ limit: 1, offset: 2 })).result?.structuredContent,
  )

  expect(last.posts.map((post) => post.postId)).toEqual(['public-older'])
  expect(last.pagination.hasMore).toBe(false)

  const empty = Schema.decodeUnknownSync(PublishedPostsResult)(
    (await call({ offset: 3 })).result?.structuredContent,
  )

  expect(empty.posts).toEqual([])
  expect(empty.pagination.limit).toBe(20)
  expect(queries.length).toBeGreaterThan(0)
  expect(queries.every((query) => /^select\b/i.test(query))).toBe(true)
  expect(providerRequests).toEqual([])
})

test('wrong scope and live account ban deny reads', async () => {
  expect(JSON.stringify(await call({}, 'catalogue:read'))).toContain('access_denied')
  await db.update(user).set({ banned: true }).where(eq(user.id, 'content-listener'))

  try {
    expect(JSON.stringify(await call())).toContain('access_denied')
  } finally {
    await db.update(user).set({ banned: false }).where(eq(user.id, 'content-listener'))
  }
})

test('protocol rejects paging outside the approved bounds', async () => {
  for (const args of [{ limit: 0 }, { limit: 51 }, { offset: -1 }, { offset: 10001 }]) {
    const response = await call(args)
    expect(response.error !== undefined || response.result?.isError === true).toBe(true)
  }
})

test('show reads hide private parents and children before paging, without playback or writes', async () => {
  queries.length = 0
  const detail = await call({ slug: 'public-show' }, 'content:read', 'get_show')
  const show = Schema.decodeUnknownSync(PublicShowResult)(detail.result?.structuredContent)
  expect(show.show.showId).toBe('public-show')
  expect(show.show.reviewUrl).toBe('https://example.test/shows/public-show')
  expect(JSON.stringify(detail.result?.structuredContent)).not.toMatch(
    /content-listener|bandcamp|content|hosts|subscription/,
  )
  const first = await call({ slug: 'public-show', limit: 1 }, 'content:read', 'list_show_episodes')
  const page = Schema.decodeUnknownSync(ShowEpisodesResult)(first.result?.structuredContent)
  expect(page.episodes.map((episode) => episode.audioId)).toEqual(['new-episode'])
  expect(page.pagination).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true })
  expect(page.episodes[0]?.reviewUrl).toBe('https://example.test/mixes/new-episode')
  expect(JSON.stringify(first)).not.toMatch(/SECRET|draft-episode|mp3|playCount|creator/)

  const last = Schema.decodeUnknownSync(ShowEpisodesResult)(
    (await call({ slug: 'public-show', limit: 1, offset: 1 }, 'content:read', 'list_show_episodes'))
      .result?.structuredContent,
  )

  expect(last.episodes.map((episode) => episode.audioId)).toEqual(['old-episode'])
  expect(last.episodes[0]?.reviewUrl).toBe('https://example.test/tracks/old-episode')
  expect(last.pagination.hasMore).toBe(false)

  await db.update(user).set({ role: 'admin' }).where(eq(user.id, 'content-listener'))

  try {
    const adminPage = Schema.decodeUnknownSync(ShowEpisodesResult)(
      (await call({ slug: 'public-show' }, 'content:read', 'list_show_episodes')).result
        ?.structuredContent,
    )

    expect(adminPage.episodes.map((episode) => episode.audioId)).toEqual([
      'new-episode',
      'old-episode',
    ])
    expect(adminPage.pagination.total).toBe(2)
  } finally {
    await db.update(user).set({ role: 'user' }).where(eq(user.id, 'content-listener'))
  }

  for (const name of ['get_show', 'list_show_episodes']) {
    const missing = await call({ slug: 'absent-show' }, 'content:read', name)
    const hidden = await call({ slug: 'draft-show' }, 'content:read', name)
    expect(hidden).toEqual(missing)
    expect(JSON.stringify(hidden)).toContain('not_found')
    expect(JSON.stringify(await call({ slug: 'public-show' }, 'catalogue:read', name))).toContain(
      'access_denied',
    )
  }

  expect(queries.length).toBeGreaterThan(0)
  expect(queries.every((query) => /^select\b/i.test(query))).toBe(true)
  expect(providerRequests).toEqual([])
  const audio = await db.select({ playCount: audioTable.playCount }).from(audioTable)
  expect(audio.map((row) => row.playCount)).toEqual([0, 0, 0, 0])
})

test('oversized encoded public metadata returns an explicit failure rather than truncation', async () => {
  await db
    .update(postsTable)
    .set({ description: '字'.repeat(100000) })
    .where(eq(postsTable.id, 'public-newer'))

  try {
    const response = await call({ limit: 1 })
    expect(response.result?.isError).toBe(true)
    expect(JSON.stringify(response)).toContain('unavailable')
    expect(JSON.stringify(response)).not.toContain('字')
  } finally {
    await db.update(postsTable).set({ description: null }).where(eq(postsTable.id, 'public-newer'))
  }
})

test('episode pages use timestamp first and ID descending for ties, not insertion order', async () => {
  await db
    .insert(showsTable)
    .values({ id: 'tie-show', slug: 'tie-show', title: 'Tie show', content: '' })

  const empty = Schema.decodeUnknownSync(ShowEpisodesResult)(
    (await call({ slug: 'tie-show' }, 'content:read', 'list_show_episodes')).result
      ?.structuredContent,
  )

  expect(empty.episodes).toEqual([])
  expect(empty.pagination).toEqual({ limit: 20, offset: 0, total: 0, hasMore: false })

  for (const [id, timestamp] of [
    ['tie-a', 2000],
    ['tie-new', 3000],
    ['tie-z', 2000],
    ['tie-zzz-old', 1000],
  ] as const) {
    await db.insert(audioTable).values({
      id,
      slug: id,
      title: id,
      type: 'mix',
      content: '',
      url: 'https://example.test/episode.mp3',
      showId: 'tie-show',
      createdAt: new Date(timestamp),
    })
  }

  const ids: Array<string> = []

  for (let offset = 0; offset < 4; offset++) {
    const page = Schema.decodeUnknownSync(ShowEpisodesResult)(
      (await call({ slug: 'tie-show', limit: 1, offset }, 'content:read', 'list_show_episodes'))
        .result?.structuredContent,
    )

    expect(page.pagination.total).toBe(4)
    expect(page.pagination.hasMore).toBe(offset < 3)
    ids.push(...page.episodes.map((episode) => episode.audioId))
  }

  expect(ids).toEqual(['tie-new', 'tie-z', 'tie-a', 'tie-zzz-old'])
})

test('misc audio has a show review URL rather than a music-track or playback URL', async () => {
  await db.insert(audioTable).values({
    id: 'misc-episode',
    slug: 'misc-episode',
    title: 'Misc episode',
    type: 'misc',
    content: '',
    url: 'https://example.test/misc.mp3',
    showId: 'public-show',
    createdAt: new Date(9000),
  })

  const page = Schema.decodeUnknownSync(ShowEpisodesResult)(
    (await call({ slug: 'public-show', limit: 1 }, 'content:read', 'list_show_episodes')).result
      ?.structuredContent,
  )

  expect(page.episodes).toHaveLength(1)
  expect(page.episodes[0]?.audioId).toBe('misc-episode')
  expect(page.episodes[0]?.type).toBe('misc')
  expect(page.episodes[0]?.reviewUrl).toBe('https://example.test/shows/public-show')
})
