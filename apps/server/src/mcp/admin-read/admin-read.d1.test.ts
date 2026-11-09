import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Logger, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { DatabaseLayer } from '@/db/layer'
import { musicLabelsTable } from '@/db/music-entity.schema'
import { oauthAccessToken, oauthConsent, oauthRefreshToken, oauthResource } from '@/db/oauth.schema'
import { postsTable } from '@/db/post.schema'
import { releasesTable } from '@/db/release.schema'
import { showsTable } from '@/db/show.schema'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { McpActor } from '@/mcp/authorization'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { EditorialMcpSettings } from '@/mcp/model'
import { composeMcpToolkits, EditorialToolkit } from '@/mcp/server'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import {
  AdminOverviewResult,
  AdminReadService,
  AdminReadServiceLayer,
  AdminReadToolkit,
  AdminReadToolHandlersLayer,
} from './index'

const ToolEnvelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    structuredContent: Schema.optional(Schema.Unknown),
    content: Schema.Array(
      Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
    ),
  }),
})

const setup = async () => {
  const fixture = await createEditorialOAuthFixture()
  const logs: Array<unknown> = []

  const endpoint = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'local',
    resourceUrl: fixture.config.mcp.resourceUrl,
    frontendUrl: fixture.config.urls.frontend,
  })

  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    Layer.succeed(EditorialMcpConfig, endpoint),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
  ).pipe(Layer.provideMerge(DatabaseLayer(fixture.db.$client)))

  const services = Layer.mergeAll(
    base,
    AdminReadServiceLayer.pipe(Layer.provide(base)),
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(
      Layer.provide(EmailDeliveryLive.pipe(Layer.provide(RecordingEmailTransportLayer))),
      Layer.provide(base),
    ),
  )

  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(
      composeMcpToolkits(EditorialToolkit, AdminReadToolkit),
      AdminReadToolHandlersLayer,
    ).pipe(
      Layer.provide(services),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])),
    ),
    { disableLogger: true },
  )

  const rpc = (
    token: Redacted.Redacted,
    method = 'tools/call',
    args: Schema.Json = {},
    name = 'get_admin_overview',
  ) =>
    app.handler(
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

  return {
    fixture,
    base,
    rpc,
    logs,
    [Symbol.asyncDispose]: async () => {
      await app.dispose()
      await fixture[Symbol.asyncDispose]()
    },
  }
}

test('live OAuth, role and scope checks protect discovery, cached calls and revoked grants', async () => {
  await using context = await setup()
  const { fixture, rpc } = context
  // Test-only resource policy. Never change the production allowedScopes.
  await fixture.db.update(oauthResource).set({
    allowedScopes: JSON.stringify(['admin:read', 'catalogue:read', 'posts:read', 'offline_access']),
  })
  const client = await fixture.register('admin:read catalogue:read posts:read offline_access')

  // Real consent admission must reject both editor and creator, independently
  // of the defense-in-depth service check below.
  for (const actor of ['owner', 'other']) {
    const denied = await fixture.request(
      `/oauth2/authorize?${fixture.authorizationQuery(client, 'admin:read offline_access')}`,
      undefined,
      actor,
    )

    expect(denied.status).toBe(403)
    expect(denied.headers.get('location')).toBeNull()
    expect(await denied.json()).toMatchObject({ code: 'EDITORIAL_PERMISSION_REQUIRED' })
  }

  expect(await fixture.db.$count(oauthConsent)).toBe(0)
  expect(await fixture.db.$count(oauthAccessToken)).toBe(0)
  expect(await fixture.db.$count(oauthRefreshToken)).toBe(0)
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))

  const issue = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(client, await fixture.authorize(client, actor, scope))).json(),
    )

  const admin = await issue('owner', 'admin:read offline_access')
  const missing = await issue('owner', 'catalogue:read offline_access')
  const creator = await issue('other', 'catalogue:read offline_access')

  for (const token of [missing.access_token, creator.access_token]) {
    const list = await rpc(token, 'tools/list')
    expect(await list.json()).toMatchObject({ result: { tools: [] } })
    const denied = await rpc(token)
    expect(denied.status).toBe(200)
    expect(Schema.decodeUnknownSync(ToolEnvelope)(await denied.json()).result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('access_denied') }],
    })
  }

  const list = await rpc(admin.access_token, 'tools/list')
  expect(await list.json()).toMatchObject({
    result: {
      tools: [
        {
          name: 'get_admin_overview',
          inputSchema: { additionalProperties: false },
          outputSchema: { type: 'object' },
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
      ],
    },
  })
  expect((await rpc(admin.access_token)).status).toBe(200)

  // Defense in depth: a synthetic principal cannot bypass the live role check.
  const synthetic = async (scopes: typeof McpPrincipal.Type.scopes) =>
    Effect.runPromise(
      withTestLayer(
        Effect.flatMap(AdminReadService, (service) => service.getAdminOverview()).pipe(
          Effect.provideService(
            McpActor,
            Schema.decodeUnknownSync(McpPrincipal)({
              userId: 'owner',
              clientId: client,
              scopes,
            }),
          ),
          Effect.result,
        ),
        AdminReadServiceLayer.pipe(Layer.provide(context.base)),
      ),
    )

  expect(await synthetic(['catalogue:read'])).toMatchObject({
    failure: { code: 'access_denied' },
  })
  await fixture.db.update(user).set({ role: 'creator' }).where(eq(user.id, 'owner'))
  expect(await synthetic(['admin:read'])).toMatchObject({
    failure: { code: 'access_denied' },
  })

  for (const method of ['tools/list', 'tools/call']) {
    const denied = await rpc(admin.access_token, method)
    expect(denied.status).toBe(401)
    expect(await denied.text()).toBe('')
  }

  await fixture.db.update(user).set({ role: 'admin', banned: true }).where(eq(user.id, 'owner'))
  expect((await rpc(admin.access_token)).status).toBe(401)
  await fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'owner'))
  expect((await rpc(admin.access_token)).status).toBe(200)
  await Effect.runPromise(fixture.service.disconnect(fixture.userId, client))

  for (const method of ['tools/list', 'tools/call']) {
    const denied = await rpc(admin.access_token, method)
    expect(denied.status).toBe(401)
    expect(await denied.text()).toBe('')
  }
}, 30_000)

test('exact aggregate projection is fixed-size, empty-safe, redacted and fails closed on storage loss', async () => {
  await using context = await setup()
  const { fixture, rpc } = context
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await fixture.db
    .update(oauthResource)
    .set({ allowedScopes: JSON.stringify(['admin:read', 'posts:read', 'offline_access']) })
  const client = await fixture.register('admin:read posts:read offline_access')

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        client,
        await fixture.authorize(client, 'owner', 'admin:read posts:read offline_access'),
      )
    ).json(),
  )

  const read = async () => {
    const response = await rpc(tokens.access_token)
    expect(response.status).toBe(200)
    const result = Schema.decodeUnknownSync(ToolEnvelope)(await response.json()).result
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent) },
    ])

    return result
  }

  const empty = await read()
  const editorialResponse = await rpc(tokens.access_token, 'tools/call', {}, 'list_drafts')
  const editorial = Schema.decodeUnknownSync(ToolEnvelope)(await editorialResponse.json()).result
  expect(editorial.isError).not.toBe(true)

  const editorialEndpoint = Schema.decodeUnknownSync(
    Schema.Struct({ endpoint: AdminOverviewResult.fields.endpoint }),
  )(editorial.structuredContent)

  const adminEndpoint = Schema.decodeUnknownSync(AdminOverviewResult)(empty.structuredContent)
  expect(adminEndpoint.endpoint).toEqual(editorialEndpoint.endpoint)
  expect(empty.structuredContent).toEqual({
    endpoint: {
      environment: 'local',
      resourceUrl: fixture.config.mcp.resourceUrl,
      frontendUrl: fixture.config.urls.frontend,
    },
    generatedAt: expect.any(String),
    status: 'complete',
    publishing: {
      mixes: { published: 0, drafts: 0 },
      tracks: { published: 0, drafts: 0 },
      miscAudio: { published: 0, drafts: 0 },
      shows: { published: 0, drafts: 0 },
      posts: { published: 0, drafts: 0 },
      micros: { published: 0, drafts: 0 },
      releases: { published: 0, drafts: 0 },
    },
  })

  const content = (id: string, draft: boolean) => ({
    id,
    slug: id,
    title: 'PRIVATE_TITLE',
    content: 'PRIVATE_BODY',
    draft,
  })

  await fixture.db.insert(audioTable).values([
    { ...content('mix-p1', false), type: 'mix', url: 'https://private.invalid' },
    { ...content('mix-p2', false), type: 'mix', url: 'https://private.invalid' },
    { ...content('mix-d', true), type: 'mix', url: 'https://private.invalid' },
    { ...content('track-d', true), type: 'track', url: 'https://private.invalid' },
    { ...content('misc-p', false), type: 'misc', url: 'https://private.invalid' },
  ])
  await fixture.db.insert(postsTable).values([
    { ...content('post-p', false), type: 'post' },
    { ...content('micro-d1', true), type: 'micro' },
    { ...content('micro-d2', true), type: 'micro' },
  ])
  await fixture.db.insert(showsTable).values(content('show-d', true))
  await fixture.db
    .insert(musicLabelsTable)
    .values({ id: 'label', slug: 'label', name: 'PRIVATE_LABEL' })
  await fixture.db
    .insert(releasesTable)
    .values({ ...content('release-p', false), labelId: 'label' })
  const result = await read()

  const expected = {
    mixes: { published: 2, drafts: 1 },
    tracks: { published: 0, drafts: 1 },
    miscAudio: { published: 1, drafts: 0 },
    shows: { published: 0, drafts: 1 },
    posts: { published: 1, drafts: 0 },
    micros: { published: 0, drafts: 2 },
    releases: { published: 1, drafts: 0 },
  }

  // Assert raw output before decoding: schemas must not hide extra leaked keys.
  expect(result.structuredContent).toEqual({
    endpoint: {
      environment: 'local',
      resourceUrl: fixture.config.mcp.resourceUrl,
      frontendUrl: fixture.config.urls.frontend,
    },
    generatedAt: expect.any(String),
    status: 'complete',
    publishing: expected,
  })
  Schema.decodeUnknownSync(AdminOverviewResult)(result.structuredContent)
  const encoded = JSON.stringify(result)
  expect(encoded.length).toBeLessThan(4096)

  for (const secret of [
    'PRIVATE_',
    'private.invalid',
    'example.com',
    'session-token',
    'access_token',
  ]) {
    expect(encoded).not.toContain(secret)
  }

  for (let offset = 0; offset < 60; offset += 10) {
    await fixture.db.insert(postsTable).values(
      Array.from({ length: 10 }, (_, i) => ({
        ...content(`bulk-${offset + i}`, true),
        type: 'post' as const,
      })),
    )
  }

  const larger = await read()
  expect(larger.structuredContent).toEqual({
    endpoint: {
      environment: 'local',
      resourceUrl: fixture.config.mcp.resourceUrl,
      frontendUrl: fixture.config.urls.frontend,
    },
    generatedAt: expect.any(String),
    status: 'complete',
    publishing: { ...expected, posts: { published: 1, drafts: 60 } },
  })
  expect(JSON.stringify(larger).length).toBeLessThan(4096)
  const invalid = await rpc(tokens.access_token, 'tools/call', { dimension: 'email' })
  expect(Schema.decodeUnknownSync(ToolEnvelope)(await invalid.json()).result.isError).toBe(true)

  // Real disposable storage failure, not a mocked service or driver.
  context.logs.length = 0
  await fixture.db.$client.prepare('DROP TABLE releases').run()
  const failed = await rpc(tokens.access_token)
  const failure = Schema.decodeUnknownSync(ToolEnvelope)(await failed.json()).result
  expect(failure).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: expect.stringContaining('unavailable') }],
  })
  expect(failure.structuredContent).toBeUndefined()
  expect(JSON.stringify(failure)).not.toMatch(/PRIVATE_|SQL|releases/)
  expect(context.logs).toEqual([
    [
      'mcp.admin_read.unavailable',
      {
        operation: 'publishing.count',
        category: 'releases',
        dependency: 'database',
      },
    ],
  ])
}, 30_000)
