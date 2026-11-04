import { EditorialPrincipal, PostId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Role } from '@gbfm/core/roles'
import { eq, inArray } from 'drizzle-orm'
import { Effect, Exit, Layer, Option, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { replaceEntityLabels } from '@/db/labels'
import { postCreators, postsTable } from '@/db/post.schema'
import { DatabaseError } from '@/errors'
import { MdxService, MdxServiceLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { PostService, PostServiceLayer, PostSourceAccess } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { GetPostResult, ListDraftsResult } from './contracts'
import { EditorialActor, EditorialMcpConfig, EditorialReadServiceLayer } from './editorial'
import { EditorialMcpSettings } from './model'
import { makeEditorialMcpLayer } from './server'

const ownerId = Schema.decodeUnknownSync(UserId)('mcp-owner')

const otherId = Schema.decodeUnknownSync(UserId)('mcp-other')

const draftId = Schema.decodeUnknownSync(PostId)('mcp-draft-id')

const secondDraftId = Schema.decodeUnknownSync(PostId)('mcp-second-draft-id')

const privateId = Schema.decodeUnknownSync(PostId)('mcp-private-id')

const publishedId = Schema.decodeUnknownSync(PostId)('mcp-published-id')

const readScope = 'posts:read'

const makePostLayer = (mdxLayer: Layer.Layer<MdxService>) =>
  PostServiceLayer.pipe(
    Layer.provide(mdxLayer),
    Layer.provide(UnavailableObjectStoreClientLayer),
    Layer.provide(Layer.mergeAll(ConfigServiceLayer, UploadAssetServiceLayer)),
    Layer.provide(DatabaseTestLayer),
  )

const postLayer = makePostLayer(MdxServiceLayer)

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  ownerUserId: ownerId,
  readScope,
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const createApp = (postServiceLayer: Layer.Layer<PostService> = postLayer) =>
  HttpRouter.toWebHandler(
    makeEditorialMcpLayer(['https://example.test']).pipe(
      Layer.provide(
        EditorialReadServiceLayer.pipe(
          Layer.provide(postServiceLayer),
          Layer.provide(DatabaseTestLayer),
          Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
        ),
      ),
      Layer.provide(HttpServer.layerServices),
    ),
    {
      disableLogger: true,
      middleware: (effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const actor = request.headers['x-fixture-actor']

          if (!actor) return yield* effect

          const principal = yield* Schema.decodeUnknownEffect(EditorialPrincipal)({
            userId: actor,
            clientId: 'fixture-client',
            scopes: request.headers['x-fixture-scope'] === 'missing' ? [] : [readScope],
          }).pipe(Effect.option)

          if (Option.isNone(principal)) return yield* effect

          return yield* effect.pipe(Effect.provideService(EditorialActor, principal.value))
        }),
    },
  )

const app = createApp()

const Envelope = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
})

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Unknown),
  content: Schema.Array(
    Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  ),
})

const rpc = async (
  method: string,
  params: { readonly name?: string; readonly arguments?: Schema.Json } = {},
  actor: string | undefined = ownerId,
  scope = readScope,
  protocol = '2026-07-28',
  handler = app.handler,
) => {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': protocol,
    'mcp-method': method,
    'x-fixture-scope': scope,
  })

  if (params.name !== undefined) headers.set('mcp-name', params.name)

  if (actor) headers.set('x-fixture-actor', actor)

  const response = await handler(
    new Request('https://api.example.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': protocol,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  )

  expect(response.headers.get('mcp-session-id')).toBeNull()
  const text = await response.text()

  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : text

  if (!payload) throw new Error('Missing MCP response')

  return { status: response.status, body: Schema.decodeUnknownSync(Envelope)(JSON.parse(payload)) }
}

const call = async (
  name: string,
  args: Schema.Json = {},
  actor: string = ownerId,
  scope = readScope,
) => {
  const response = await rpc('tools/call', { name, arguments: args }, actor, scope)
  expect(response.status).toBe(200)
  expect(response.body.error).toBeUndefined()

  return Schema.decodeUnknownSync(ToolResult)(response.body.result)
}

beforeAll(async () => {
  await db.insert(user).values([
    { id: ownerId, name: 'Owner', email: 'mcp-owner@example.test', role: 'admin' },
    { id: otherId, name: 'Other', email: 'mcp-other@example.test', role: 'admin' },
  ])
  await db.insert(postsTable).values([
    {
      id: draftId,
      slug: 'mcp-draft-slug',
      title: 'Draft title',
      content: 'A private editorial body.',
      type: 'post',
      draft: true,
      createdAt: new Date('2026-10-02T00:00:00Z'),
    },
    {
      id: secondDraftId,
      slug: 'mcp-second-draft-slug',
      title: 'Tweet draft',
      content: 'A private tweet body.',
      type: 'micro',
      draft: true,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    },
    {
      id: privateId,
      slug: 'mcp-unrelated-private',
      title: 'Must stay private',
      content: 'Never leak this private draft.',
      type: 'post',
      draft: true,
    },
    {
      id: publishedId,
      slug: 'mcp-published-slug',
      title: 'Published',
      content: 'Public editorial body.',
      type: 'post',
      draft: false,
    },
  ])
  await db.insert(postCreators).values([
    { postId: draftId, creatorId: ownerId },
    { postId: secondDraftId, creatorId: ownerId },
    { postId: privateId, creatorId: otherId },
    { postId: publishedId, creatorId: otherId },
  ])
  await replaceEntityLabels(db, 'post', draftId, { tags: ['listening-notes', 'editorial'] })
})

afterAll(() => app.dispose())

describe('request-scoped editorial MCP', () => {
  test('advertises exactly two strictly validated read-only tools', async () => {
    const response = await rpc('tools/list')
    expect(response.status).toBe(200)

    const result = Schema.decodeUnknownSync(
      Schema.Struct({
        tools: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            annotations: Schema.Struct({
              readOnlyHint: Schema.Boolean,
              destructiveHint: Schema.Boolean,
            }),
            inputSchema: Schema.Struct({ additionalProperties: Schema.Boolean }),
          }),
        ),
      }),
    )(response.body.result)

    expect(result.tools.map((tool) => tool.name).toSorted()).toEqual(['get_post', 'list_drafts'])

    for (const tool of result.tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  test('accepts an explicitly allowed browser origin and rejects unrelated origins', async () => {
    for (const origin of ['https://example.test', 'https://unrelated.test']) {
      const response = await app.handler(
        new Request('https://api.example.test/mcp', {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/list',
            'x-fixture-actor': ownerId,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        }),
      )

      expect(response.status).toBe(origin === config.frontendUrl ? 200 : 403)
      await response.text()
    }
  })

  test('pages only authored drafts even for an admin owner', async () => {
    const first = Schema.decodeUnknownSync(ListDraftsResult)(
      (await call('list_drafts', { limit: 1 })).structuredContent,
    )

    const second = Schema.decodeUnknownSync(ListDraftsResult)(
      (await call('list_drafts', { limit: 1, offset: 1 })).structuredContent,
    )

    expect(first.posts.map((post) => post.postId)).toEqual([draftId])
    expect(second.posts.map((post) => post.postId)).toEqual([secondDraftId])
    expect(first.pagination).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true })
    expect(second.pagination).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false })
    expect(second.posts[0]?.reviewUrl).toBe(
      'https://example.test/new/tweet?edit=mcp-second-draft-slug',
    )
    expect(first.endpoint).toEqual({
      environment: config.environment,
      resourceUrl: config.resourceUrl,
      frontendUrl: config.frontendUrl,
    })

    const empty = Schema.decodeUnknownSync(ListDraftsResult)(
      (await call('list_drafts', { offset: 2 })).structuredContent,
    )

    expect(empty.posts).toEqual([])
    expect(empty.pagination.total).toBe(2)
  })

  test('drafts with identical creation times have deterministic page boundaries', async () => {
    const ids = ['mcp-tied-b', 'mcp-tied-a', 'mcp-tied-c']
    await db.insert(postsTable).values(
      ids.map((id): typeof postsTable.$inferInsert => ({
        id,
        slug: id,
        title: id,
        content: 'Disposable pagination fixture',
        type: 'post',
        draft: true,
        createdAt: new Date('2030-01-01T00:00:00Z'),
      })),
    )
    await db.insert(postCreators).values(ids.map((postId) => ({ postId, creatorId: ownerId })))

    try {
      const pages: Array<string> = []

      for (let offset = 0; offset < 3; offset++) {
        const page = Schema.decodeUnknownSync(ListDraftsResult)(
          (await call('list_drafts', { limit: 1, offset })).structuredContent,
        )

        pages.push(...page.posts.map((post) => post.postId))
      }

      expect(pages).toEqual(['mcp-tied-c', 'mcp-tied-b', 'mcp-tied-a'])
    } finally {
      await db.delete(postCreators).where(inArray(postCreators.postId, ids))
      await db.delete(postsTable).where(inArray(postsTable.id, ids))
    }
  })

  test('reads stable IDs, projects source only, and keeps the same version across reads and listing', async () => {
    const first = Schema.decodeUnknownSync(GetPostResult)(
      (await call('get_post', { postId: draftId })).structuredContent,
    )

    const second = Schema.decodeUnknownSync(GetPostResult)(
      (await call('get_post', { postId: draftId })).structuredContent,
    )

    const drafts = Schema.decodeUnknownSync(ListDraftsResult)(
      (await call('list_drafts')).structuredContent,
    )

    expect(first).toEqual(second)
    expect(first.post.version).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.post.version).toBe(drafts.posts.find((post) => post.postId === draftId)?.version)
    expect(first.post.reviewUrl).toBe('https://example.test/new/editorial?edit=mcp-draft-slug')
    expect(first.post.content).toBe('A private editorial body.')
    expect(first.post.tags).toEqual(['editorial', 'listening-notes'])
    expect(first.post.creatorIds).toEqual([ownerId])
    expect(first.post).not.toHaveProperty('compiledContent')
    expect(first.post).not.toHaveProperty('richContent')
    expect(first.post).not.toHaveProperty('blueskySource')
  })

  test('versions change with content even if updatedAt has not changed', async () => {
    const before = Schema.decodeUnknownSync(GetPostResult)(
      (await call('get_post', { postId: secondDraftId })).structuredContent,
    )

    await db
      .update(postsTable)
      .set({ content: 'Updated body', updatedAt: new Date(before.post.updatedAt) })
      .where(eq(postsTable.id, secondDraftId))

    const after = Schema.decodeUnknownSync(GetPostResult)(
      (await call('get_post', { postId: secondDraftId })).structuredContent,
    )

    expect(after.post.version).not.toBe(before.post.version)
    expect(after.post.updatedAt).toBe(before.post.updatedAt)
  })

  test('reads published content but does not expose unrelated private drafts or unknown IDs', async () => {
    const published = Schema.decodeUnknownSync(GetPostResult)(
      (await call('get_post', { postId: publishedId })).structuredContent,
    )

    expect(published.post.draft).toBe(false)

    for (const postId of [privateId, 'unknown', 'mcp-draft-slug']) {
      const result = await call('get_post', { postId })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toBeUndefined()
      expect(JSON.stringify(result)).toContain('not_found')
      expect(JSON.stringify(result)).not.toContain('Never leak')
    }
  })

  test('rejects extra fields, malformed IDs, and unbounded paging as invalid parameters', async () => {
    for (const args of [
      { limit: 51 },
      { limit: 0 },
      { limit: 1.5 },
      { offset: -1 },
      { offset: 10_001 },
      { surprise: true },
    ]) {
      const response = await rpc('tools/call', { name: 'list_drafts', arguments: args })
      const result = Schema.decodeUnknownSync(ToolResult)(response.body.result)
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toBeUndefined()
      expect(result.content[0]?.text).toContain('Invalid parameters')
    }

    for (const args of [
      {},
      { postId: '' },
      { postId: 123 },
      { postId: 'x'.repeat(201) },
      { postId: draftId, surprise: true },
    ]) {
      const response = await rpc('tools/call', { name: 'get_post', arguments: args })
      const result = Schema.decodeUnknownSync(ToolResult)(response.body.result)
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toBeUndefined()
      expect(result.content[0]?.text).toContain('Invalid parameters')
    }
  })

  test('missing identity, different owner, or missing scopes produce typed tool errors', async () => {
    for (const actor of ['', otherId]) {
      const response = await rpc('tools/call', { name: 'list_drafts', arguments: {} }, actor)
      const result = Schema.decodeUnknownSync(ToolResult)(response.body.result)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('access_denied')
      expect(JSON.stringify(result)).not.toContain('Draft title')
    }

    expect((await call('list_drafts', {}, ownerId, 'missing')).isError).toBe(true)
    expect((await call('list_drafts')).isError).not.toBe(true)
  })

  test('rechecks owner role and ban state on each tool call', async () => {
    try {
      await db.update(user).set({ role: 'user' }).where(eq(user.id, ownerId))
      expect((await call('list_drafts')).isError).toBe(true)
      expect((await call('get_post', { postId: publishedId })).isError).toBe(true)
      await db.update(user).set({ role: 'unrecognized' }).where(eq(user.id, ownerId))
      expect((await call('list_drafts')).isError).toBe(true)
      await db.update(user).set({ role: 'creator', banned: true }).where(eq(user.id, ownerId))
      expect((await call('list_drafts')).isError).toBe(true)
      await db.update(user).set({ role: 'editor', banned: false }).where(eq(user.id, ownerId))
      expect((await call('list_drafts')).isError).not.toBe(true)
      expect((await call('get_post', { postId: draftId })).isError).not.toBe(true)
    } finally {
      await db.update(user).set({ role: 'admin', banned: false }).where(eq(user.id, ownerId))
    }

    expect((await call('list_drafts')).isError).not.toBe(true)
  })

  test('rejects write-tool names and legacy protocols', async () => {
    const write = await rpc('tools/call', { name: 'publish_post', arguments: {} })
    expect(write.body.error).toBeDefined()
    const legacy = await rpc('tools/list', {}, ownerId, readScope, '2025-11-25')
    expect(legacy.status).toBe(400)
    expect(legacy.body.error).toBeDefined()

    const termination = await app.handler(
      new Request('https://api.example.test/mcp', { method: 'DELETE' }),
    )

    expect(termination.status).toBe(405)
  })

  test('storage failures become declared, scrubbed tool failures rather than defects', async () => {
    const failure = Effect.fail(
      new DatabaseError({
        message: 'Sensitive storage failure details',
        operation: 'select',
        table: 'posts',
      }),
    )

    const failingPostLayer = Layer.effect(
      PostService,
      Effect.map(PostService, (posts) => ({
        ...posts,
        getSourcesForEdit: (_options, _reader) => failure,
      })),
    ).pipe(Layer.provide(postLayer))

    const failingApp = createApp(failingPostLayer)

    try {
      const response = await rpc(
        'tools/call',
        { name: 'list_drafts', arguments: {} },
        ownerId,
        readScope,
        '2026-07-28',
        failingApp.handler,
      )

      expect(response.status).toBe(200)
      expect(response.body.error).toBeUndefined()
      const result = Schema.decodeUnknownSync(ToolResult)(response.body.result)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('unavailable')
      expect(JSON.stringify(result)).not.toContain('Sensitive')
    } finally {
      await failingApp.dispose()
    }
  })

  test('source reads succeed with compilation and rich-content resolution unavailable', async () => {
    const unavailableMdx = Layer.succeed(
      MdxService,
      MdxService.of({
        compile: (_content) => Effect.die('Compiler unavailable'),
        render: (_content) => Effect.die('Rich-content resolver unavailable'),
        invalidateAll: Effect.void,
      }),
    )

    const unavailablePostLayer = makePostLayer(unavailableMdx)
    const sourceOnlyApp = createApp(unavailablePostLayer)

    try {
      const listed = await rpc(
        'tools/call',
        { name: 'list_drafts', arguments: {} },
        ownerId,
        readScope,
        '2026-07-28',
        sourceOnlyApp.handler,
      )

      const drafts = Schema.decodeUnknownSync(ListDraftsResult)(
        Schema.decodeUnknownSync(ToolResult)(listed.body.result).structuredContent,
      )

      expect(drafts.posts.map((post) => post.postId)).toEqual([draftId, secondDraftId])

      for (const postId of [draftId, publishedId]) {
        const response = await rpc(
          'tools/call',
          { name: 'get_post', arguments: { postId } },
          ownerId,
          readScope,
          '2026-07-28',
          sourceOnlyApp.handler,
        )

        const result = Schema.decodeUnknownSync(ToolResult)(response.body.result)
        expect(result.isError).not.toBe(true)
        const post = Schema.decodeUnknownSync(GetPostResult)(result.structuredContent).post
        expect(post.postId).toBe(postId)
        expect(post.version).toMatch(/^sha256:[a-f0-9]{64}$/)
      }

      const compiled = await Effect.runPromise(
        withTestLayer(
          Effect.flatMap(PostService, (posts) => posts.getBySlug('mcp-published-slug')).pipe(
            Effect.exit,
          ),
          unavailablePostLayer,
        ),
      )

      expect(Exit.isFailure(compiled)).toBe(true)
    } finally {
      await sourceOnlyApp.dispose()
    }
  })

  test('source access preserves publication, authorship, labels, and creator projections', async () => {
    const reader = PostSourceAccess.cases.Authored.make({
      userId: ownerId,
      userRole: Schema.decodeUnknownSync(Role)('admin'),
    })

    const result = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const posts = yield* PostService

          const published = yield* posts.getSourceById(
            publishedId,
            PostSourceAccess.cases.Published.make({}),
          )

          const privatePublishedRead = yield* posts
            .getSourceById(draftId, PostSourceAccess.cases.Published.make({}))
            .pipe(Effect.exit)

          const ownDraft = yield* posts.getSourceById(draftId, reader)
          const unrelatedDraft = yield* posts.getSourceById(privateId, reader).pipe(Effect.exit)

          const compiled = yield* posts.getBySlugForEdit(
            'mcp-draft-slug',
            ownerId,
            reader.userRole,
            'owned',
          )

          return { published, privatePublishedRead, ownDraft, unrelatedDraft, compiled }
        }),
        postLayer,
      ),
    )

    expect(result.published.id).toBe(publishedId)
    expect(Exit.isFailure(result.privatePublishedRead)).toBe(true)
    expect(Exit.isFailure(result.unrelatedDraft)).toBe(true)
    expect(result.ownDraft.content).toBe(result.compiled.content)
    expect(result.ownDraft.tags).toEqual(result.compiled.tags)
    expect(result.ownDraft.creators).toEqual(result.compiled.creators)
    expect(result.ownDraft).not.toHaveProperty('richContent')
    expect(result.ownDraft).not.toHaveProperty('compiledContent')
    expect(result.compiled).toHaveProperty('richContent')
    expect(result.compiled).toHaveProperty('compiledContent')
  })
})
