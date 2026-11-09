import { AuthSession } from '@gbfm/api/middleware/auth'
import { PostId } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { audioCreators, audioTable } from '@/db/audio.schema'
import { user, session } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { Database } from '@/db/layer'
import { mcpOperations } from '@/db/mcp-operation.schema'
import { oauthClient, oauthResource } from '@/db/oauth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { showCreators, showsTable } from '@/db/show.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { ConflictError, DatabaseError } from '@/errors'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { McpActor, McpAuthorizationLive } from '@/mcp/authorization'
import {
  CommandAuthority,
  makeOAuthCommandAuthority,
  makeSessionCommandAuthority,
} from '@/mcp/command-authority'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { loadEditorialSnapshot } from '@/mcp/editorial-music/snapshot'
import { EditorialMcpSettings, projectPost } from '@/mcp/model'
import { McpOperationStore, createMcpOperationStore, type JsonValue } from '@/mcp/operations/store'
import { composeMcpToolkits, EditorialToolkit } from '@/mcp/server'
import { McpWireResponse, makeMcpWireResponse } from '@/mcp/wire-response'
import { AudioService, AudioServiceLayer } from '@/services/audio.service'
import { ConfigService } from '@/services/config.service'
import {
  CreatorCommandService,
  CreatorCommandServiceLayer,
} from '@/services/creator-command/service'
import { EditorialOAuth, EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { ShowService, ShowServiceLayer } from '@/services/show.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import {
  CreateMicroPostInput,
  CreatorCommandResult,
  DeleteContentInput,
  PublishEditorialInput,
  UnpublishContentInput,
  UpdateCreatorMetadataInput,
} from './contracts'
import { CreatorToolkit, CreatorToolHandlersLayer } from './toolkit'

const harness = async () => {
  const fixture = await createEditorialOAuthFixture()

  const scopes = [
    'creator:read',
    'creator:write',
    'posts:read',
    'drafts:write',
    'micros:publish',
    'content:publish',
    'content:delete',
    'offline_access',
  ]

  await fixture.register()
  await fixture.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes) })
  const clientId = await fixture.register(scopes.join(' '))

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(clientId, await fixture.authorize(clientId, 'owner', scopes.join(' ')))
    ).json(),
  )

  const principal = await Effect.runPromise(fixture.service.verify(tokens.access_token))

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
      Effect.provideService(Database, fixture.db),
      Effect.provideService(ConfigService, fixture.config),
      Effect.provideService(EditorialOAuth, fixture.service),
    ),
  )

  const database = Layer.succeed(Database, fixture.db)

  const service = CreatorCommandServiceLayer.pipe(
    Layer.provide(McpAuthorizationLive.pipe(Layer.provide(database))),
    Layer.provide(Layer.succeed(McpOperationStore, createMcpOperationStore(fixture.database))),
    Layer.provide(
      Layer.succeed(
        EditorialMcpConfig,
        Schema.decodeUnknownSync(EditorialMcpSettings)({
          readScope: 'posts:read',
          environment: 'test',
          resourceUrl: fixture.config.mcp.resourceUrl,
          frontendUrl: fixture.config.urls.frontend,
        }),
      ),
    ),
    Layer.provide(database),
  )

  const run = <A, E>(effect: Effect.Effect<A, E, CreatorCommandService | CommandAuthority>) =>
    Effect.runPromise(
      withTestLayer(effect.pipe(Effect.provideService(CommandAuthority, authority)), service).pipe(
        Effect.provideService(McpActor, principal),
        Effect.provideService(McpWireResponse, makeMcpWireResponse(1, 'json')),
      ),
    )

  const browser = Layer.mergeAll(AudioServiceLayer, ShowServiceLayer).pipe(
    Layer.provide(MdxServiceLayer),
    Layer.provide(UnavailableObjectStoreClientLayer),
    Layer.provide(UploadAssetServiceLayer.pipe(Layer.provide(database))),
    Layer.provide(Layer.succeed(ConfigService, fixture.config)),
    Layer.provide(database),
  )

  const [account] = await fixture.db.select().from(user).where(eq(user.id, 'owner'))

  const [ownerSession] = await fixture.db
    .select()
    .from(session)
    .where(eq(session.id, 'owner-session'))

  if (!account || !ownerSession) throw new Error('Missing real session fixture')

  const sessionAuthority = await Effect.runPromise(
    makeSessionCommandAuthority.pipe(
      Effect.provideService(AuthSession, { user: account, session: ownerSession }),
      Effect.provideService(Database, fixture.db),
      Effect.provideService(ConfigService, fixture.config),
    ),
  )

  const runBrowser = <A, E>(effect: Effect.Effect<A, E, AudioService | ShowService>) =>
    Effect.runPromise(
      withTestLayer(
        effect.pipe(Effect.provideService(CommandAuthority, sessionAuthority)),
        browser,
      ),
    )

  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    MdxServiceLayer,
    UnavailableObjectStoreClientLayer,
    UploadAssetServiceLayer,
  ).pipe(Layer.provideMerge(database))

  const email = EmailDeliveryLive.pipe(
    Layer.provide(RecordingEmailTransportLayer),
    Layer.provide(base),
  )

  const services = Layer.mergeAll(
    base,
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
  )

  // Disposable HTTP composition only; the shared production registry remains P1-owned.
  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(
      composeMcpToolkits(EditorialToolkit, CreatorToolkit),
      CreatorToolHandlersLayer.pipe(Layer.provide(service)),
    ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )

  const call = async (name: string, input: JsonValue, rpcId: string | number = 1) => {
    const response = await app.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          method: 'tools/call',
          params: {
            name,
            arguments: input,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )

    const body = await response.text()

    return {
      status: response.status,
      body:
        body.length === 0
          ? null
          : response.headers.get('content-type')?.includes('json')
            ? JSON.parse(body)
            : body,
    }
  }

  return {
    fixture,
    run,
    runBrowser,
    call,
    clientId,
    [Symbol.asyncDispose]: async () => {
      await app.dispose()
      await fixture[Symbol.asyncDispose]()
    },
  }
}

test('real OAuth HTTP composes public micro creation and separately consented deletion without registry activation', async () => {
  await using h = await harness()
  const input = { requestId: crypto.randomUUID(), content: 'HTTP public micro' }
  const response = await h.call('create_micro_post', input)
  expect(response.status).toBe(200)

  const decode = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
  )

  const created = decode(response.body).result.structuredContent

  if (!('version' in created.target)) throw new Error('Expected post version')

  const target = {
    kind: 'micro',
    targetId: created.target.targetId,
    expectedVersion: created.target.version,
  }

  const request = { requestId: crypto.randomUUID(), target }
  const deleted = await h.call('delete_content', request)
  expect(deleted.status).toBe(200)
  const result = decode(deleted.body).result.structuredContent
  expect(result.target).toMatchObject({ targetId: created.target.targetId, state: 'deleted' })
  const replay = decode((await h.call('delete_content', request)).body).result.structuredContent
  expect(replay).toMatchObject({ target: result.target, replayed: true })
  expect(await h.fixture.db.select().from(postsTable)).toEqual([])
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect((await h.call('delete_content', request)).status).toBe(401)
}, 20_000)

test('OAuth replies derive actual depth, retry once, and refuse oversized acknowledgements before writing', async () => {
  await using h = await harness()
  const rootId = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())
  await h.fixture.db.insert(postsTable).values({
    id: rootId,
    slug: rootId,
    content: 'Other creator public root',
    type: 'micro',
    draft: false,
    depth: 7,
  })
  await h.fixture.db.insert(postCreators).values({ postId: rootId, creatorId: 'other' })
  const input = { requestId: crypto.randomUUID(), parentPostId: rootId, content: 'Public reply' }

  const decode = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
  )

  expect((await h.call('reply_to_micro_post', input, 'a'.repeat(261500))).body).toMatchObject({
    result: { isError: true },
  })
  expect(await h.fixture.db.select().from(mcpOperations)).toEqual([])
  expect(await h.fixture.db.select().from(postsTable)).toHaveLength(1)

  const [first, second] = await Promise.all([
    h.call('reply_to_micro_post', input),
    h.call('reply_to_micro_post', input),
  ])

  const applied = decode(first.body).result.structuredContent
  const retry = decode(second.body).result.structuredContent
  expect(applied.target).toEqual(retry.target)
  expect([applied.replayed, retry.replayed].filter(Boolean)).toHaveLength(1)

  const [reply] = await h.fixture.db
    .select()
    .from(postsTable)
    .where(eq(postsTable.id, applied.target.targetId))

  expect(reply).toMatchObject({ parentPostId: rootId, rootPostId: rootId, depth: 1, draft: false })
  expect(
    await h.fixture.db
      .select()
      .from(postCreators)
      .where(eq(postCreators.postId, applied.target.targetId)),
  ).toEqual([{ postId: applied.target.targetId, creatorId: 'owner' }])
  expect(
    (await h.call('reply_to_micro_post', { ...input, content: 'Changed' })).body,
  ).toMatchObject({ result: { isError: true } })
  expect(await h.fixture.db.select().from(postsTable)).toHaveLength(2)
  expect(await h.fixture.db.select().from(mcpOperations)).toHaveLength(1)

  if (!('version' in applied.target)) throw new Error('Expected reply version')
  expect(
    (
      await h.call('unpublish_content', {
        requestId: crypto.randomUUID(),
        target: {
          kind: 'micro',
          targetId: applied.target.targetId,
          expectedVersion: applied.target.version,
        },
      })
    ).body,
  ).toMatchObject({ result: { structuredContent: { status: 'applied' } } })
  expect(
    decode((await h.call('reply_to_micro_post', input)).body).result.structuredContent,
  ).toMatchObject({ target: applied.target, replayed: true })
  expect(
    (
      await h.fixture.db.select().from(postsTable).where(eq(postsTable.id, applied.target.targetId))
    )[0]?.draft,
  ).toBe(true)
}, 20_000)

test('reply admission checks intermediate ancestry and depth8 boundary, not stored depth or owner draft access', async () => {
  await using h = await harness()
  const ids = Array.from({ length: 9 }, () => Schema.decodeUnknownSync(PostId)(crypto.randomUUID()))
  const rootId = ids[0]!

  for (const [depth, id] of ids.entries()) {
    await h.fixture.db.insert(postsTable).values({
      id,
      slug: id,
      content: 'Public chain',
      type: 'micro',
      draft: false,
      parentPostId: depth === 0 ? null : ids[depth - 1],
      rootPostId: depth === 0 ? null : rootId,
      depth: 0,
    })
    await h.fixture.db.insert(postCreators).values({ postId: id, creatorId: 'owner' })
  }

  const reply = (parentPostId: string) =>
    h.call('reply_to_micro_post', {
      requestId: crypto.randomUUID(),
      parentPostId,
      content: 'Boundary reply',
    })

  expect((await reply(crypto.randomUUID())).body).toMatchObject({ result: { isError: true } })
  expect((await reply(ids[8]!)).body).toMatchObject({ result: { isError: true } })
  const intermediate = ids[3]!

  for (const patch of [
    { draft: true },
    { type: 'post' as const },
    { rootPostId: ids[1]! },
    { parentPostId: ids[7]! },
  ]) {
    await h.fixture.db.update(postsTable).set(patch).where(eq(postsTable.id, intermediate))
    expect((await reply(ids[7]!)).body).toMatchObject({ result: { isError: true } })
    expect(await h.fixture.db.select().from(mcpOperations)).toEqual([])
    await h.fixture.db
      .update(postsTable)
      .set({
        draft: false,
        type: 'micro',
        rootPostId: rootId,
        parentPostId: ids[2]!,
      })
      .where(eq(postsTable.id, intermediate))
  }

  await h.fixture.db.insert(postCreators).values({ postId: intermediate, creatorId: 'other' })
  await h.fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'other'))
  expect((await reply(ids[7]!)).body).toMatchObject({ result: { isError: true } })
  await h.fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'other'))
  const response = await reply(ids[7]!)

  const result = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
  )(response.body).result.structuredContent

  expect(
    (
      await h.fixture.db.select().from(postsTable).where(eq(postsTable.id, result.target.targetId))
    )[0],
  ).toMatchObject({ depth: 8, parentPostId: ids[7], rootPostId: rootId })
}, 20_000)

test('reply INSERT rechecks ancestry after receipt reservation and rolls back hidden-root races', async () => {
  await using h = await harness()
  const rootId = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())
  await h.fixture.db.insert(postsTable).values({
    id: rootId,
    slug: rootId,
    content: 'Public parent',
    type: 'micro',
    draft: false,
  })
  await h.fixture.db.insert(postCreators).values({ postId: rootId, creatorId: 'other' })
  const before = await h.fixture.db.select().from(postsTable)
  const relations = await h.fixture.db.select().from(postCreators)
  await h.fixture.database
    .prepare(`CREATE TRIGGER hide_reply_parent AFTER INSERT ON mcp_operations
    BEGIN UPDATE posts SET draft=1 WHERE id='${rootId}'; END`)
    .run()
  // A final-only ancestry check would miss an invalid INSERT followed by restoration.
  await h.fixture.database
    .prepare(`CREATE TRIGGER restore_reply_parent AFTER INSERT ON posts
    WHEN NEW.parent_post_id='${rootId}'
    BEGIN UPDATE posts SET draft=0 WHERE id='${rootId}'; END`)
    .run()
  const input = { requestId: crypto.randomUUID(), parentPostId: rootId, content: 'Race reply' }
  expect((await h.call('reply_to_micro_post', input)).body).toMatchObject({
    result: { isError: true },
  })
  expect(await h.fixture.db.select().from(postsTable)).toEqual(before)
  expect(await h.fixture.db.select().from(postCreators)).toEqual(relations)
  expect(await h.fixture.db.select().from(mcpOperations)).toEqual([])
  await h.fixture.database.prepare('DROP TRIGGER hide_reply_parent').run()
  expect((await h.call('reply_to_micro_post', input)).body).toMatchObject({
    result: { structuredContent: { status: 'applied', replayed: false } },
  })
}, 20_000)

test('actual RPC ID acknowledgement overflow refuses creator writes and bounds replay disclosure', async () => {
  await using h = await harness()

  const decode = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
  )

  const input = { requestId: crypto.randomUUID(), content: 'Wire budget probe' }

  for (const rpcId of ['a'.repeat(261500), '"'.repeat(130750)]) {
    const response = await h.call('create_micro_post', input, rpcId)
    expect(await h.fixture.db.select().from(postsTable)).toEqual([])
    expect(await h.fixture.db.select().from(mcpOperations)).toEqual([])
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ result: { isError: true } })
  }

  const response = await h.call('create_micro_post', input, 'a'.repeat(260000))
  expect(response.status).toBe(200)
  const created = decode(response.body).result.structuredContent

  const before = {
    posts: await h.fixture.db.select().from(postsTable),
    receipts: await h.fixture.db.select().from(mcpOperations),
  }

  expect(before.posts).toHaveLength(1)
  const oversizedReplay = await h.call('create_micro_post', input, 'a'.repeat(261500))
  expect(oversizedReplay.body).toMatchObject({ result: { isError: true } })
  expect({
    posts: await h.fixture.db.select().from(postsTable),
    receipts: await h.fixture.db.select().from(mcpOperations),
  }).toEqual(before)
  expect(
    decode((await h.call('create_micro_post', input)).body).result.structuredContent,
  ).toMatchObject({ target: created.target, replayed: true })
}, 20_000)

test('actual-ID sizing precedes metadata and every lifecycle target write and bounds draft listing', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    showId = crypto.randomUUID(),
    postId = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())

  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    slug: mixId,
    title: 'Mix',
    content: '',
    url: 'https://example.test/mix',
    type: 'mix',
    draft: true,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'owner' })
  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, slug: showId, title: 'Show', content: '', draft: false })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })
  await h.fixture.db.insert(postsTable).values({
    id: postId,
    slug: postId,
    title: 'Post',
    content: 'Prose',
    type: 'post',
    draft: true,
  })
  await h.fixture.db.insert(postCreators).values({ postId, creatorId: 'owner' })

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const post = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, postId), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  const micro = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
  )(
    (
      await h.call('create_micro_post', {
        requestId: crypto.randomUUID(),
        content: 'Public control',
      })
    ).body,
  ).result.structuredContent

  if (!('version' in micro.target)) throw new Error('Expected micro version')

  const snapshot = async () => ({
    audio: await h.fixture.db.select().from(audioTable),
    shows: await h.fixture.db.select().from(showsTable),
    posts: await h.fixture.db.select().from(postsTable),
    receipts: await h.fixture.db.select().from(mcpOperations),
  })

  const before = await snapshot()

  const commands: ReadonlyArray<{ name: string; input: JsonValue }> = [
    { name: 'list_creator_drafts', input: {} },
    {
      name: 'update_creator_metadata',
      input: {
        kind: 'mix',
        targetId: mixId,
        expectedRevision: 0,
        title: 'Refuse',
        requestId: crypto.randomUUID(),
      },
    },
    {
      name: 'publish_editorial',
      input: { postId, expectedVersion: post.version, requestId: crypto.randomUUID() },
    },
    ...['mix', 'show'].flatMap((kind) => [
      {
        name: 'delete_content',
        input: {
          requestId: crypto.randomUUID(),
          target: { kind, targetId: kind === 'mix' ? mixId : showId, expectedRevision: 0 },
        },
      },
    ]),
    {
      name: 'unpublish_content',
      input: {
        requestId: crypto.randomUUID(),
        target: { kind: 'show', targetId: showId, expectedRevision: 0 },
      },
    },
    {
      name: 'unpublish_content',
      input: {
        requestId: crypto.randomUUID(),
        target: {
          kind: 'micro',
          targetId: micro.target.targetId,
          expectedVersion: micro.target.version,
        },
      },
    },
    {
      name: 'delete_content',
      input: {
        requestId: crypto.randomUUID(),
        target: { kind: 'post', targetId: postId, expectedVersion: post.version },
      },
    },
  ]

  for (const command of commands) {
    const response = await h.call(command.name, command.input, 'a'.repeat(261500))
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ result: { isError: true } })
    expect(await snapshot()).toEqual(before)
  }
}, 20_000)

test('genuine session browser save and delete roll back all writes when authority is lost inside the batch', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    showId = crypto.randomUUID(),
    labelId = crypto.randomUUID()

  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, slug: showId, title: 'Original show', content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })
  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    slug: mixId,
    title: 'Original mix',
    content: 'Body',
    type: 'mix',
    url: 'https://example.test/audio',
    showId,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'owner' })
  await h.fixture.db.insert(labelsTable).values({ id: labelId, kind: 'tag', name: 'original' })
  await h.fixture.db.insert(entityLabelsTable).values([
    { entityType: 'audio', entityId: mixId, labelId, position: 0 },
    { entityType: 'show', entityId: showId, labelId, position: 0 },
  ])

  const snapshot = async () => ({
    audio: await h.fixture.db.select().from(audioTable),
    shows: await h.fixture.db.select().from(showsTable),
    audioOwners: await h.fixture.db.select().from(audioCreators),
    showOwners: await h.fixture.db.select().from(showCreators),
    labels: await h.fixture.db.select().from(entityLabelsTable),
    tags: await h.fixture.db.select().from(labelsTable),
    accounts: await h.fixture.db.select().from(user),
  })

  const before = await snapshot()
  await h.fixture.database
    .prepare(
      "CREATE TRIGGER creator_browser_ban AFTER UPDATE ON audio BEGIN UPDATE user SET banned=1 WHERE id='owner'; END",
    )
    .run()
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', {
            title: 'After',
            tags: ['required tag'],
            expectedRevision: 0,
          }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
  expect(await snapshot()).toEqual(before)
  await h.fixture.database.prepare('DROP TRIGGER creator_browser_ban').run()

  for (const boundary of ['UPDATE', 'DELETE']) {
    await h.fixture.database
      .prepare(
        `CREATE TRIGGER creator_browser_ban AFTER ${boundary} ON shows BEGIN UPDATE user SET banned=1 WHERE id='owner'; END`,
      )
      .run()
    expect(
      await h.runBrowser(
        Effect.result(Effect.flatMap(ShowService, (s) => s.delete(showId, 'owner', 'editor'))),
      ),
    ).toMatchObject({ failure: expect.any(ConflictError) })
    expect(await snapshot()).toEqual(before)
    await h.fixture.database.prepare('DROP TRIGGER creator_browser_ban').run()
  }
}, 20_000)

test('live OAuth account authority is enforced inside the creation batch, not just at preflight', async () => {
  await using h = await harness()

  const input = Schema.decodeUnknownSync(CreateMicroPostInput)({
    requestId: crypto.randomUUID(),
    content: 'Must roll back',
  })

  await h.fixture.database
    .prepare(
      "CREATE TRIGGER creator_revoke_during_insert AFTER INSERT ON posts BEGIN UPDATE user SET banned=1 WHERE id='owner'; END",
    )
    .run()
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(input))),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(await h.fixture.db.select().from(postsTable)).toEqual([])
  expect(await h.fixture.db.select().from(postCreators)).toEqual([])
  expect(
    await h.fixture.db.select({ banned: user.banned }).from(user).where(eq(user.id, 'owner')),
  ).toEqual([{ banned: false }])
  await h.fixture.database.prepare('DROP TRIGGER creator_revoke_during_insert').run()
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(input))),
  ).toMatchObject({ replayed: false, target: { state: 'published' } })
}, 20_000)

test('real OAuth creator metadata is owner-only, revision guarded and receipt replay rechecks current access', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    otherId = crypto.randomUUID(),
    showId = crypto.randomUUID(),
    publishedId = crypto.randomUUID()

  const now = new Date()

  for (const [id, owner, draft] of [
    [mixId, 'owner', true],
    [otherId, 'other', true],
    [publishedId, 'owner', false],
  ] as const) {
    await h.fixture.db.insert(audioTable).values({
      id,
      title: id,
      slug: id,
      content: 'private body',
      url: 'private secret URL',
      type: 'mix',
      draft,
      createdAt: now,
      updatedAt: now,
    })
    await h.fixture.db.insert(audioCreators).values({ audioId: id, creatorId: owner })
  }

  await h.fixture.db.insert(showsTable).values({
    id: showId,
    title: 'Show',
    slug: showId,
    content: 'private body',
    draft: true,
    createdAt: now,
    updatedAt: now,
  })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })
  const listing = await h.run(Effect.flatMap(CreatorCommandService, (s) => s.listCreatorDrafts({})))
  expect(listing.drafts.map((x) => x.targetId).sort()).toEqual([mixId, showId].sort())
  expect(JSON.stringify(listing)).not.toContain('private body')
  expect(JSON.stringify(listing)).not.toContain('private secret URL')

  const input = Schema.decodeUnknownSync(UpdateCreatorMetadataInput)({
    requestId: crypto.randomUUID(),
    kind: 'mix',
    targetId: mixId,
    expectedRevision: 0,
    title: 'Changed',
    description: null,
  })

  const apply = () =>
    h.run(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input)))

  const outcomes = await Promise.all([apply(), apply()])
  expect(outcomes.map((x) => x.target)).toEqual([outcomes[0]?.target, outcomes[0]?.target])
  expect(outcomes.some((x) => x.replayed)).toBe(true)
  expect(
    await h.fixture.db
      .select({ title: audioTable.title, revision: audioTable.revision })
      .from(audioTable)
      .where(eq(audioTable.id, mixId)),
  ).toEqual([{ title: 'Changed', revision: 1 }])

  const changed = await h.run(
    Effect.result(
      Effect.flatMap(CreatorCommandService, (s) =>
        s.updateCreatorMetadata({ ...input, title: 'Different' }),
      ),
    ),
  )

  expect(changed).toMatchObject({ failure: { code: 'conflict' } })

  const stale = await h.run(
    Effect.result(
      Effect.flatMap(CreatorCommandService, (s) =>
        s.updateCreatorMetadata({ ...input, requestId: crypto.randomUUID() }),
      ),
    ),
  )

  expect(stale).toMatchObject({ failure: { code: 'conflict' } })

  for (const targetId of [otherId, publishedId]) {
    const denied = await h.run(
      Effect.result(
        Effect.flatMap(CreatorCommandService, (s) =>
          s.updateCreatorMetadata({ ...input, requestId: crypto.randomUUID(), targetId }),
        ),
      ),
    )

    expect(denied).toMatchObject({ failure: { code: 'not_found' } })
  }

  await h.fixture.db.delete(audioCreators).where(eq(audioCreators.audioId, mixId))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
  await h.fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  expect(
    (
      await h.run(
        Effect.flatMap(CreatorCommandService, (s) => s.listCreatorDrafts({ kind: 'mix' })),
      )
    ).drafts,
  ).toEqual([])
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)

test('browser show deletion versions detached episodes atomically and refuses child revision overflow', async () => {
  await using h = await harness()

  const showId = crypto.randomUUID(),
    episodeId = crypto.randomUUID()

  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, slug: showId, title: 'Show', content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })
  await h.fixture.db.insert(audioTable).values({
    id: episodeId,
    slug: episodeId,
    title: 'Keep episode',
    description: 'Unrelated prose',
    content: 'Body',
    type: 'mix',
    url: 'https://example.test/episode.mp3',
    showId,
    episodeNumber: 7,
    revision: Number.MAX_SAFE_INTEGER,
  })
  const before = await h.fixture.db.select().from(audioTable)
  expect(
    await h.runBrowser(
      Effect.result(Effect.flatMap(ShowService, (s) => s.delete(showId, 'owner', 'editor'))),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
  expect(await h.fixture.db.select().from(audioTable)).toEqual(before)
  expect(await h.fixture.db.select().from(showsTable)).toHaveLength(1)
  await h.fixture.db.update(audioTable).set({ revision: 8 }).where(eq(audioTable.id, episodeId))
  const [episode] = await h.fixture.db.select().from(audioTable)

  if (!episode) throw new Error('Missing seeded episode')
  await h.runBrowser(Effect.flatMap(ShowService, (s) => s.delete(showId, 'owner', 'editor')))
  const [detached] = await h.fixture.db.select().from(audioTable)
  expect(detached).toEqual({
    ...episode,
    showId: null,
    revision: 9,
    lastOperationId: expect.any(String),
    updatedAt: expect.any(Date),
  })
  expect(detached?.updatedAt.getTime()).toBeGreaterThan(episode.updatedAt.getTime())
  expect(detached?.lastOperationId).toHaveLength(36)
  expect(await h.fixture.db.select().from(showsTable)).toEqual([])
}, 20_000)

test('public micro create retries commit one post and return the shared version for separately consented unpublish', async () => {
  await using h = await harness()

  const input = Schema.decodeUnknownSync(CreateMicroPostInput)({
    requestId: crypto.randomUUID(),
    content: 'Public **micro**',
  })

  const apply = () => h.run(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(input)))
  const [first, retry] = await Promise.all([apply(), apply()])
  expect(first.target).toEqual(retry.target)
  expect(first.target).toMatchObject({ kind: 'micro', state: 'published' })
  const rows = await h.fixture.db.select().from(postsTable)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    id: first.target.targetId,
    content: 'Public **micro**',
    draft: false,
    depth: 0,
    parentPostId: null,
    rootPostId: null,
  })
  const id = Schema.decodeUnknownSync(PostId)(first.target.targetId)

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const current = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, id), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  expect(first.target).toMatchObject({ version: current.version })

  const transition = Schema.decodeUnknownSync(UnpublishContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'micro', targetId: id, expectedVersion: current.version },
  })

  const result = await h.run(
    Effect.flatMap(CreatorCommandService, (s) => s.unpublishContent(transition)),
  )

  expect(result.target).toMatchObject({ kind: 'micro', state: 'unpublished' })
  expect(result.target).not.toMatchObject({ version: current.version })
  expect((await h.fixture.db.select().from(postsTable))[0]?.draft).toBe(true)
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.unpublishContent(transition))),
  ).toMatchObject({ target: result.target, replayed: true })

  const changed = await h.run(
    Effect.result(
      Effect.flatMap(CreatorCommandService, (s) =>
        s.createMicroPost({ ...input, content: 'Changed retry' }),
      ),
    ),
  )

  expect(changed).toMatchObject({ failure: { code: 'conflict' } })

  const malformed = Schema.decodeUnknownSync(CreateMicroPostInput)({
    requestId: crypto.randomUUID(),
    content: '<script>alert(1)</script>',
  })

  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(malformed))),
    ),
  ).toMatchObject({ failure: { code: 'invalid_input' } })
  expect(await h.fixture.db.select().from(postsTable)).toHaveLength(1)
}, 20_000)

test('editorial publish uses shared version CAS; replay acknowledges transition but never bypasses current ownership', async () => {
  await using h = await harness()
  const id = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())
  await h.fixture.db.insert(postsTable).values({
    id,
    slug: id,
    title: 'Editorial',
    content: 'Canonical **prose**',
    type: 'post',
    draft: true,
  })
  await h.fixture.db.insert(postCreators).values({ postId: id, creatorId: 'owner' })

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const current = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, id), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  const input = Schema.decodeUnknownSync(PublishEditorialInput)({
    requestId: crypto.randomUUID(),
    postId: id,
    expectedVersion: current.version,
  })

  const first = await h.run(Effect.flatMap(CreatorCommandService, (s) => s.publishEditorial(input)))
  expect(first.target).toMatchObject({ kind: 'post', targetId: id, state: 'published' })
  expect((await h.fixture.db.select().from(postsTable))[0]?.draft).toBe(false)
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.publishEditorial(input))),
  ).toMatchObject({ target: first.target, replayed: true })
  expect(
    await h.run(
      Effect.result(
        Effect.flatMap(CreatorCommandService, (s) =>
          s.publishEditorial({ ...input, requestId: crypto.randomUUID() }),
        ),
      ),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  await h.fixture.db.delete(postCreators).where(eq(postCreators.postId, id))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.publishEditorial(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)

test('browser and MCP share revisions; rejected coupled creator/tag saves roll back together', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    showId = crypto.randomUUID()

  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    title: 'Original',
    slug: mixId,
    content: '',
    url: 'https://example.test/mix.mp3',
    type: 'mix',
    draft: true,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'owner' })
  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, title: 'Original show', slug: showId, content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })

  const first = await h.runBrowser(
    Effect.flatMap(AudioService, (s) =>
      s.update('mix', mixId, 'owner', 'editor', {
        title: 'Browser',
        tags: ['new tag'],
        expectedRevision: 0,
      }),
    ),
  )

  expect(first).toMatchObject({ title: 'Browser', revision: 1, tags: ['new tag'] })

  const input = Schema.decodeUnknownSync(UpdateCreatorMetadataInput)({
    kind: 'mix',
    targetId: mixId,
    requestId: crypto.randomUUID(),
    title: 'MCP',
    expectedRevision: 0,
  })

  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input))),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', {
            title: 'Stale browser',
            expectedRevision: 0,
          }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', {
            title: 'Broken',
            tags: ['bad'],
            creatorIds: ['nonexistent'],
            expectedRevision: 1,
          }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(DatabaseError) })
  expect(
    await h.fixture.db
      .select({ title: audioTable.title, revision: audioTable.revision })
      .from(audioTable)
      .where(eq(audioTable.id, mixId)),
  ).toEqual([{ title: 'Browser', revision: 1 }])
  expect(
    await h.fixture.db
      .select({ name: labelsTable.name })
      .from(entityLabelsTable)
      .innerJoin(labelsTable, eq(entityLabelsTable.labelId, labelsTable.id))
      .where(eq(entityLabelsTable.entityId, mixId)),
  ).toEqual([{ name: 'new tag' }])

  const show = await h.runBrowser(
    Effect.flatMap(ShowService, (s) =>
      s.update(showId, 'owner', 'editor', {
        title: 'Changed show',
        tags: ['show tag'],
        expectedRevision: 0,
      }),
    ),
  )

  expect(show).toMatchObject({ title: 'Changed show', revision: 1, tags: ['show tag'] })
  await h.fixture.db
    .update(audioTable)
    .set({ revision: Number.MAX_SAFE_INTEGER })
    .where(eq(audioTable.id, mixId))
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', { title: 'Overflow' }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
}, 20_000)

test('delete proves a physical winner, refuses dependent state and replays only the exact authorized outcome', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    showId = crypto.randomUUID()

  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    title: 'Delete mix',
    slug: mixId,
    content: 'unchanged',
    url: 'https://example.test/public.mp3',
    type: 'mix',
    draft: false,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'owner' })
  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, title: 'Delete show', slug: showId, content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })

  const input = Schema.decodeUnknownSync(DeleteContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'mix', targetId: mixId, expectedRevision: 0 },
  })

  const apply = () => h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input)))
  await h.fixture.db.insert(favoritesTable).values({ userId: 'other', audioId: mixId })
  const before = await h.fixture.db.select().from(audioTable)
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(await h.fixture.db.select().from(audioTable)).toEqual(before)
  expect(await h.fixture.db.select().from(audioCreators)).toEqual([
    { audioId: mixId, creatorId: 'owner' },
  ])
  expect(await h.fixture.db.select().from(favoritesTable)).toHaveLength(1)
  await h.fixture.db.delete(favoritesTable)
  const [first, retry] = await Promise.all([apply(), apply()])
  expect(first.target).toEqual({ kind: 'mix', targetId: mixId, revision: 1, state: 'deleted' })
  expect(retry.target).toEqual(first.target)
  expect([first.replayed, retry.replayed].filter(Boolean)).toHaveLength(1)
  expect(await h.fixture.db.select().from(audioTable)).toEqual([])
  expect(await h.fixture.db.select().from(audioCreators)).toEqual([])

  const showInput = Schema.decodeUnknownSync(DeleteContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'show', targetId: showId, expectedRevision: 0 },
  })

  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(showInput))),
  ).toMatchObject({ target: { kind: 'show', state: 'deleted', revision: 1 } })
  expect(await h.fixture.db.select().from(showCreators)).toEqual([])
  expect(
    await h.run(
      Effect.result(
        Effect.flatMap(CreatorCommandService, (s) =>
          s.deleteContent({ ...input, requestId: crypto.randomUUID() }),
        ),
      ),
    ),
  ).toMatchObject({ failure: { code: 'not_found' } })
  // An ID reused by another owner cannot inherit the old receipt's authority.
  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    title: 'Other owner',
    slug: mixId,
    content: '',
    url: '',
    type: 'mix',
    draft: true,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'other' })
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)

test('post deletion rolls back its stamp and owned relations on storage failure, then returns replayable deletion', async () => {
  await using h = await harness()

  const created = await h.run(
    Effect.flatMap(CreatorCommandService, (s) =>
      s.createMicroPost(
        Schema.decodeUnknownSync(CreateMicroPostInput)({
          requestId: crypto.randomUUID(),
          content: 'Delete only this micro',
        }),
      ),
    ),
  )

  if (!('version' in created.target)) throw new Error('Expected micro result')
  const id = created.target.targetId
  const labelId = crypto.randomUUID()
  await h.fixture.db
    .insert(labelsTable)
    .values({ id: labelId, kind: 'tag', name: 'Preserved on failure' })
  await h.fixture.db
    .insert(entityLabelsTable)
    .values({ entityType: 'post', entityId: id, labelId, position: 0 })

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const postId = Schema.decodeUnknownSync(PostId)(id)

  const observed = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, postId), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  const input = Schema.decodeUnknownSync(DeleteContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'micro', targetId: id, expectedVersion: observed.version },
  })

  const rows = await h.fixture.db.select().from(postsTable)
  await h.fixture.database
    .prepare(
      "CREATE TRIGGER creator_delete_failure BEFORE DELETE ON posts BEGIN SELECT RAISE(ABORT,'test failure'); END",
    )
    .run()
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'unavailable' } })
  expect(await h.fixture.db.select().from(postsTable)).toEqual(rows)
  expect(await h.fixture.db.select().from(postCreators)).toEqual([
    { postId: id, creatorId: 'owner' },
  ])
  expect(await h.fixture.db.select().from(entityLabelsTable)).toEqual([
    { entityType: 'post', entityId: id, labelId, position: 0 },
  ])
  await h.fixture.database.prepare('DROP TRIGGER creator_delete_failure').run()
  const applied = await h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input)))
  expect(applied.target).toMatchObject({ kind: 'micro', targetId: id, state: 'deleted' })
  expect(await h.fixture.db.select().from(postsTable)).toEqual([])
  expect(await h.fixture.db.select().from(entityLabelsTable)).toEqual([])
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
  ).toMatchObject({ target: applied.target, replayed: true })
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)
