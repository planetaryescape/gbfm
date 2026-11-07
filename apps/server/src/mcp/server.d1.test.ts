import { EditorialPrincipal, McpPrincipal, PostId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Role } from '@gbfm/core/roles'
import { eq, inArray } from 'drizzle-orm'
import { Effect, Exit, Layer, Match, Option, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import { replaceEntityLabels } from '@/db/labels'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable } from '@/db/tags.schema'
import { DatabaseError } from '@/errors'
import { MdxService, MdxServiceLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { PostService, PostServiceLayer, PostSourceAccess } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor, McpAuthorization, McpAuthorizationLive } from './authorization'
import { GetPostResult, ListDraftsResult } from './contracts'
import { insertEditorialDraft, updateEditorialDraft } from './draft-store'
import { EditorialDraftServiceLayer } from './drafts'
import { EditorialActor, EditorialMcpConfig, EditorialReadServiceLayer } from './editorial'
import { loadEditorialSnapshot } from './editorial-music/snapshot'
import { EditorialMcpSettings } from './model'
import { composeMcpToolkits, EditorialToolkit, makeEditorialMcpLayer } from './server'

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
  readScope,
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const createApp = (postServiceLayer: Layer.Layer<PostService> = postLayer) =>
  HttpRouter.toWebHandler(
    makeEditorialMcpLayer(['https://example.test']).pipe(
      Layer.provide(EditorialDraftServiceLayer),
      Layer.provide(EditorialReadServiceLayer),
      Layer.provide(postServiceLayer),
      Layer.provide(DatabaseTestLayer),
      Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
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
            scopes: Match.value(request.headers['x-fixture-scope']).pipe(
              Match.when('missing', () => []),
              Match.when('drafts:write', () => [readScope, 'drafts:write']),
              Match.orElse(() => [readScope]),
            ),
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

const createDraft = async (title = 'Jazz notes', requestId = crypto.randomUUID()) => {
  const input = {
    requestId,
    title,
    content: 'Jazz crept up on me.',
    description: 'Listening notes',
  }

  const result = await call('create_draft', input, ownerId, 'drafts:write')
  expect(result.isError).not.toBe(true)

  return { input, result: Schema.decodeUnknownSync(GetPostResult)(result.structuredContent) }
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

test('composition rejects duplicate wire names instead of replacing a domain tool', () => {
  expect(() => composeMcpToolkits(EditorialToolkit, EditorialToolkit)).toThrow('Duplicate MCP tool')
})

test('high-trust authorization requires an exact scope and the live admin role', async () => {
  const check = (scopes: typeof McpPrincipal.Type.scopes) =>
    Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const authorization = yield* McpAuthorization

          return yield* Effect.result(authorization.highTrust('catalogue:write'))
        }).pipe(
          Effect.provideService(
            McpActor,
            Schema.decodeUnknownSync(McpPrincipal)({
              userId: ownerId,
              clientId: 'fixture-client',
              scopes,
            }),
          ),
        ),
        McpAuthorizationLive.pipe(Layer.provide(DatabaseTestLayer)),
      ),
    )

  expect((await check(['catalogue:read']))._tag).toBe('Failure')
  expect((await check(['catalogue:write']))._tag).toBe('Success')

  try {
    await db.update(user).set({ role: 'creator' }).where(eq(user.id, ownerId))
    expect((await check(['catalogue:write']))._tag).toBe('Failure')
  } finally {
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, ownerId))
  }
})

describe('draft-only MCP writes', () => {
  afterEach(async () => {
    const created = (
      await db.select({ id: editorialOperations.postId }).from(editorialOperations)
    ).map((row) => row.id)

    if (created.length === 0) return
    await db.batch([
      db.delete(editorialOperations).where(inArray(editorialOperations.postId, created)),
      db.delete(entityLabelsTable).where(inArray(entityLabelsTable.entityId, created)),
      db.delete(postCreators).where(inArray(postCreators.postId, created)),
      db.delete(postsTable).where(inArray(postsTable.id, created)),
    ])
  })
  test('requires explicit write consent, including for admins', async () => {
    const result = await call('create_draft', {
      requestId: crypto.randomUUID(),
      title: 'Denied',
      content: '',
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('access_denied') },
    ])
  })

  test('creates an owned unpublished draft and replays without duplicating', async () => {
    const { input, result } = await createDraft()
    expect(
      Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID(4)))(result.post.postId),
    ).toBe(result.post.postId)
    expect(result.post).toMatchObject({
      title: input.title,
      content: input.content,
      draft: true,
      type: 'post',
      creatorIds: [ownerId],
    })
    const replay = await call('create_draft', input, ownerId, 'drafts:write')
    expect(Schema.decodeUnknownSync(GetPostResult)(replay.structuredContent)).toEqual(result)

    const collision = await call(
      'create_draft',
      { ...input, title: 'Different payload' },
      ownerId,
      'drafts:write',
    )

    expect(collision.isError).toBe(true)
    expect(collision.content[0]?.text).toContain('conflict')
    expect(
      await db.select().from(postCreators).where(eq(postCreators.postId, result.post.postId)),
    ).toEqual([{ postId: result.post.postId, creatorId: ownerId }])
  })

  test('expired receipts reject retries without recreating posts or replaying old bodies', async () => {
    const { input, result } = await createDraft()
    await db
      .update(editorialOperations)
      .set({ createdAt: new Date(0) })
      .where(eq(editorialOperations.postId, result.post.postId))
    const expired = await call('create_draft', input, ownerId, 'drafts:write')
    expect(expired.isError).toBe(true)
    expect(expired.content[0]?.text).toContain('expired')
    await db
      .update(editorialOperations)
      .set({ result: null })
      .where(eq(editorialOperations.postId, result.post.postId))
    expect((await call('create_draft', input, ownerId, 'drafts:write')).isError).toBe(true)
    expect(
      await db.select().from(postsTable).where(eq(postsTable.id, result.post.postId)),
    ).toHaveLength(1)
  })

  test('isolates retry keys by approving account and serializes simultaneous creates', async () => {
    const requestId = crypto.randomUUID()

    const [first, second] = await Promise.all([
      createDraft('Same operation', requestId),
      createDraft('Same operation', requestId),
    ])

    expect(first.result.post.postId).toBe(second.result.post.postId)
    const other = await call('create_draft', first.input, otherId, 'drafts:write')
    const otherPost = Schema.decodeUnknownSync(GetPostResult)(other.structuredContent).post
    expect(otherPost.postId).not.toBe(first.result.post.postId)
    expect(otherPost.creatorIds).toEqual([otherId])
  })

  test('updates only requested fields and rejects stale revisions', async () => {
    const { input, result } = await createDraft()

    const updated = await call(
      'update_draft',
      {
        requestId: crypto.randomUUID(),
        postId: result.post.postId,
        expectedVersion: result.post.version,
        title: 'An ode to jazz',
        description: null,
      },
      ownerId,
      'drafts:write',
    )

    const next = Schema.decodeUnknownSync(GetPostResult)(updated.structuredContent).post
    expect(next).toMatchObject({
      title: 'An ode to jazz',
      content: input.content,
      description: null,
      draft: true,
      creatorIds: [ownerId],
    })
    expect(next.version).not.toBe(result.post.version)

    const stale = await call(
      'update_draft',
      {
        requestId: crypto.randomUUID(),
        postId: next.postId,
        expectedVersion: result.post.version,
        content: 'Must not overwrite',
      },
      ownerId,
      'drafts:write',
    )

    expect(stale.isError).toBe(true)
    expect(stale.content[0]?.text).toContain('conflict')
    const replay = await call('create_draft', input, ownerId, 'drafts:write')
    expect(Schema.decodeUnknownSync(GetPostResult)(replay.structuredContent)).toEqual(result)
  })

  test('only one concurrent update using the same revision can succeed', async () => {
    const { result } = await createDraft()

    const replies = await Promise.all(
      ['First', 'Second'].map((title) =>
        call(
          'update_draft',
          {
            requestId: crypto.randomUUID(),
            postId: result.post.postId,
            expectedVersion: result.post.version,
            title,
          },
          ownerId,
          'drafts:write',
        ),
      ),
    )

    expect(replies.filter((reply) => reply.isError === true)).toHaveLength(1)
    expect(replies.filter((reply) => reply.isError !== true)).toHaveLength(1)
  })

  test('identical concurrent updates and later retries replay the original saved result', async () => {
    const { result } = await createDraft()

    const input = {
      requestId: crypto.randomUUID(),
      postId: result.post.postId,
      expectedVersion: result.post.version,
      title: 'Original save',
    }

    const [first, second] = await Promise.all([
      call('update_draft', input, ownerId, 'drafts:write'),
      call('update_draft', input, ownerId, 'drafts:write'),
    ])

    const saved = Schema.decodeUnknownSync(GetPostResult)(first.structuredContent)
    expect(Schema.decodeUnknownSync(GetPostResult)(second.structuredContent)).toEqual(saved)

    const later = await call(
      'update_draft',
      {
        ...input,
        requestId: crypto.randomUUID(),
        expectedVersion: saved.post.version,
        title: 'Later save',
      },
      ownerId,
      'drafts:write',
    )

    expect(Schema.decodeUnknownSync(GetPostResult)(later.structuredContent).post.title).toBe(
      'Later save',
    )
    const retry = await call('update_draft', input, ownerId, 'drafts:write')
    expect(Schema.decodeUnknownSync(GetPostResult)(retry.structuredContent)).toEqual(saved)
    expect(
      (await call('update_draft', { ...input, description: null }, ownerId, 'drafts:write'))
        .isError,
    ).toBe(true)
    const current = await call('get_post', { postId: saved.post.postId })
    expect(Schema.decodeUnknownSync(GetPostResult)(current.structuredContent).post.title).toBe(
      'Later save',
    )
  })

  test('receipts do not leak after ownership loss and do not recreate deleted drafts', async () => {
    const { input, result } = await createDraft()
    await db.delete(postCreators).where(eq(postCreators.postId, result.post.postId))
    expect((await call('create_draft', input, ownerId, 'drafts:write')).isError).toBe(true)
    await db.delete(postsTable).where(eq(postsTable.id, result.post.postId))
    expect((await call('create_draft', input, ownerId, 'drafts:write')).isError).toBe(true)
    expect(await db.select().from(postsTable).where(eq(postsTable.id, result.post.postId))).toEqual(
      [],
    )
    await db.delete(editorialOperations).where(eq(editorialOperations.postId, result.post.postId))
  })

  test('a failed receipt insert rolls back draft and creator creation', async () => {
    const postId = `mcp-${'b'.repeat(64)}`
    const input = { requestId: crypto.randomUUID(), title: 'Must roll back', content: '' }
    await expect(
      insertEditorialDraft(db, ownerId, postId, input, new Date(), {
        id: crypto.randomUUID(),
        actorId: 'missing-user',
        postId,
        inputHash: 'test',
        result: '{}',
        createdAt: new Date(),
      }),
    ).rejects.toThrow()
    expect(await db.select().from(postsTable).where(eq(postsTable.id, postId))).toEqual([])
    expect(await db.select().from(postCreators).where(eq(postCreators.postId, postId))).toEqual([])
  })

  test('denies cross-owner admin writes, published posts and micro posts', async () => {
    for (const postId of [privateId, publishedId, secondDraftId]) {
      const read = await call('get_post', { postId }, postId === privateId ? otherId : ownerId)
      const version = Schema.decodeUnknownSync(GetPostResult)(read.structuredContent).post.version

      const denied = await call(
        'update_draft',
        { requestId: crypto.randomUUID(), postId, expectedVersion: version, title: 'Forbidden' },
        ownerId,
        'drafts:write',
      )

      expect(denied.isError).toBe(true)
    }

    const { result } = await createDraft()
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, result.post.postId))
    const published = await call('get_post', { postId: result.post.postId })

    const version = Schema.decodeUnknownSync(GetPostResult)(published.structuredContent).post
      .version

    expect(
      (
        await call(
          'update_draft',
          {
            requestId: crypto.randomUUID(),
            postId: result.post.postId,
            expectedVersion: version,
            title: 'No',
          },
          ownerId,
          'drafts:write',
        )
      ).isError,
    ).toBe(true)
  })

  test('rejects forbidden fields, empty patches, invalid content and oversized titles', async () => {
    const { result } = await createDraft()

    for (const fields of [{ draft: false }, { creatorIds: [otherId] }, { content: ' ' }]) {
      const response = await rpc(
        'tools/call',
        {
          name: 'create_draft',
          arguments: {
            requestId: crypto.randomUUID(),
            title: 'Invalid',
            content: 'Draft body',
            ...fields,
          },
        },
        ownerId,
        'drafts:write',
      )

      expect(
        response.body.error ?? Schema.decodeUnknownSync(ToolResult)(response.body.result).isError,
      ).toBeTruthy()
    }

    for (const extra of [
      { draft: false },
      { creatorIds: [otherId] },
      { slug: 'hijacked' },
      { type: 'micro' },
      { thumbnailUrl: 'https://example.test/image.png' },
    ]) {
      const response = await rpc(
        'tools/call',
        {
          name: 'update_draft',
          arguments: {
            requestId: crypto.randomUUID(),
            postId: result.post.postId,
            expectedVersion: result.post.version,
            title: 'No',
            ...extra,
          },
        },
        ownerId,
        'drafts:write',
      )

      expect(
        response.body.error ?? Schema.decodeUnknownSync(ToolResult)(response.body.result).isError,
      ).toBeTruthy()
    }

    for (const patch of [
      {},
      { title: ' ' },
      { content: '' },
      { content: '  ' },
      { title: 'x'.repeat(501) },
      { content: '<Track url="https://open.spotify.com/track/abc" />' },
    ]) {
      const response = await rpc(
        'tools/call',
        {
          name: 'update_draft',
          arguments: {
            requestId: crypto.randomUUID(),
            postId: result.post.postId,
            expectedVersion: result.post.version,
            ...patch,
          },
        },
        ownerId,
        'drafts:write',
      )

      expect(
        response.body.error ?? Schema.decodeUnknownSync(ToolResult)(response.body.result).isError,
      ).toBeTruthy()
    }
  })

  test('rechecks banned and downgraded accounts before writing', async () => {
    const { result } = await createDraft()

    try {
      for (const change of [{ banned: true }, { banned: false, role: 'user' }]) {
        await db.update(user).set(change).where(eq(user.id, ownerId))
        expect(
          (
            await call(
              'update_draft',
              {
                requestId: crypto.randomUUID(),
                postId: result.post.postId,
                expectedVersion: result.post.version,
                title: 'No',
              },
              ownerId,
              'drafts:write',
            )
          ).isError,
        ).toBe(true)
        expect(
          (
            await call(
              'create_draft',
              { requestId: crypto.randomUUID(), title: 'No', content: '' },
              ownerId,
              'drafts:write',
            )
          ).isError,
        ).toBe(true)
      }
    } finally {
      await db.update(user).set({ banned: false, role: 'admin' }).where(eq(user.id, ownerId))
    }
  })

  test('atomic storage guards reject content and relation drift without timestamp changes', async () => {
    for (const drift of ['content', 'tags', 'creators', 'published']) {
      const { result } = await createDraft()

      const snapshot = await Effect.runPromise(loadEditorialSnapshot(db, result.post.postId))

      if (drift === 'content')
        await db
          .update(postsTable)
          .set({ content: 'Web editor changed content' })
          .where(eq(postsTable.id, snapshot.id))

      if (drift === 'published')
        await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, snapshot.id))

      if (drift === 'tags')
        await replaceEntityLabels(db, 'post', snapshot.id, { tags: ['new-tag'] })

      if (drift === 'creators')
        await db.insert(postCreators).values({ postId: snapshot.id, creatorId: otherId })

      const changed = await updateEditorialDraft(
        db,
        ownerId,
        snapshot,
        {
          requestId: crypto.randomUUID(),
          postId: snapshot.id,
          expectedVersion: result.post.version,
          title: 'Must not overwrite',
        },
        new Date(),
        {
          id: crypto.randomUUID(),
          actorId: ownerId,
          postId: snapshot.id,
          inputHash: 'uncommitted',
          result: '{}',
          createdAt: new Date(),
        },
      )

      expect(changed).toBe(false)
      const [persisted] = await db.select().from(postsTable).where(eq(postsTable.id, snapshot.id))
      expect(persisted?.title).toBe(snapshot.title)
    }
  })
})

describe('request-scoped editorial MCP', () => {
  test('advertises strictly validated reads and separate draft-only writes', async () => {
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

    expect(result.tools.map((tool) => tool.name).toSorted()).toEqual([
      'create_draft',
      'get_post',
      'list_drafts',
      'update_draft',
    ])

    for (const tool of result.tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: ['get_post', 'list_drafts'].includes(tool.name),
        destructiveHint: false,
      })
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

  test('missing identity or scopes produce typed tool errors', async () => {
    for (const actor of ['']) {
      const response = await rpc('tools/call', { name: 'list_drafts', arguments: {} }, actor)
      const result = Schema.decodeUnknownSync(ToolResult)(response.body.result)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('access_denied')
      expect(JSON.stringify(result)).not.toContain('Draft title')
    }

    expect((await call('list_drafts', {}, ownerId, 'missing')).isError).toBe(true)
    expect((await call('list_drafts')).isError).not.toBe(true)
  })

  test('another eligible user reads only their own authored content, even with an admin role', async () => {
    const result = await call('list_drafts', {}, otherId)
    expect(result.isError).not.toBe(true)
    const drafts = Schema.decodeUnknownSync(ListDraftsResult)(result.structuredContent)
    expect(drafts.posts.map((post) => post.postId)).toEqual([privateId])
    const own = await call('get_post', { postId: privateId }, otherId)
    expect(own.isError).not.toBe(true)
    expect(Schema.decodeUnknownSync(GetPostResult)(own.structuredContent).post.postId).toBe(
      privateId,
    )
    const unrelated = await call('get_post', { postId: draftId }, otherId)
    expect(unrelated.isError).toBe(true)
    expect(JSON.stringify(unrelated)).not.toContain('A private editorial body.')
  })

  test('rechecks the acting user role and ban state on each tool call', async () => {
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
