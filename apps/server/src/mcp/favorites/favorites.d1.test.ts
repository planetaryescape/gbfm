import { OAuthClientId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { DatabaseLayer } from '@/db/layer'
import { oauthClient, oauthResource } from '@/db/oauth.schema'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { makeRecordingEmailTransport } from '@/services/email-transport.service'
import { FavoriteService, FavoriteServiceLayer } from '@/services/favorite.service'
import { PostServiceLayer } from '@/services/post.service'
import { ShowSubscriptionServiceLayer } from '@/services/show-subscription.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import { McpActor, McpAuthorizationLive } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { composeMcpToolkits, EditorialToolkit } from '../server'
import { ListFavoritesResult, type ListOwnedInput, ListShowSubscriptionsResult } from './contracts'
import { FavoritesMcpService, FavoritesMcpServiceLayer } from './service'
import { FavoritesToolHandlersLayer, FavoritesToolkit } from './toolkit'

const setup = (fixture: Awaited<ReturnType<typeof createEditorialOAuthFixture>>) => {
  const recording = makeRecordingEmailTransport()

  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    Layer.succeed(
      EditorialMcpConfig,
      Schema.decodeUnknownSync(EditorialMcpSettings)({
        readScope: 'posts:read',
        environment: 'test',
        resourceUrl: fixture.config.mcp.resourceUrl,
        frontendUrl: fixture.config.urls.frontend,
      }),
    ),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
  ).pipe(Layer.provideMerge(DatabaseLayer(fixture.db.$client)))

  const domain = Layer.mergeAll(FavoriteServiceLayer, ShowSubscriptionServiceLayer).pipe(
    Layer.provide(base),
  )

  const reads = FavoritesMcpServiceLayer.pipe(
    Layer.provide(domain),
    Layer.provide(McpAuthorizationLive.pipe(Layer.provide(base))),
    Layer.provide(base),
  )

  const email = EmailDeliveryLive.pipe(Layer.provide(recording.layer), Layer.provide(base))

  const services = Layer.mergeAll(
    base,
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
  )

  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(composeMcpToolkits(EditorialToolkit, FavoritesToolkit)).pipe(
      Layer.provide(FavoritesToolHandlersLayer.pipe(Layer.provide(reads))),
      Layer.provide(services),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )

  const rpc = (
    token: typeof OAuthTokens.Type.access_token,
    method: string,
    name?: string,
    args: Schema.Json = {},
  ) =>
    app.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          'mcp-name': name ?? '',
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

  return { app, rpc, reads, domain, recording }
}

const seed = async (fixture: Awaited<ReturnType<typeof createEditorialOAuthFixture>>) => {
  for (const [id, draft] of [
    ['public', false],
    ['dual-show', false],
    ['private', true],
    ['other-only', false],
  ] as const) {
    await fixture.db.insert(showsTable).values({
      id,
      title: id,
      slug: id,
      draft,
      content: `SECRET BODY ${id}`,
      thumbnailUrl: draft ? 'https://private.example/secret' : null,
    })
  }

  for (const [id, type, draft] of [
    ['mix', 'mix', false],
    ['track', 'track', false],
    ['misc', 'misc', false],
    ['hidden-audio', 'mix', true],
    ['dual-audio', 'mix', true],
  ] as const) {
    await fixture.db.insert(audioTable).values({
      id,
      title: id,
      slug: id,
      type,
      draft,
      content: 'SECRET AUDIO BODY',
      url: 'https://media.example/secret',
      showId: 'private',
    })
  }

  const createdAt = new Date('2026-01-01')
  await fixture.db.insert(favoritesTable).values([
    ...['mix', 'track', 'misc', 'hidden-audio'].map((audioId) => ({
      id: `f-${audioId}`,
      userId: 'reader',
      audioId,
      createdAt,
    })),
    { id: 'f-show', userId: 'reader', showId: 'public', createdAt },
    { id: 'f-private', userId: 'reader', showId: 'private', createdAt },
    { id: 'f-dual', userId: 'reader', audioId: 'dual-audio', showId: 'dual-show', createdAt },
    { id: 'f-other', userId: 'other', showId: 'other-only', createdAt },
  ])
  await fixture.db.insert(showSubscriptionsTable).values([
    { id: 's-public', userId: 'reader', showId: 'public', createdAt },
    { id: 's-private', userId: 'reader', showId: 'private', createdAt },
    { id: 's-other', userId: 'other', showId: 'other-only', createdAt },
  ])
}

test('persisted OAuth → composed MCP → real services: bounded owner-only public projections and revocation', async () => {
  await using fixture = await createEditorialOAuthFixture()
  await seed(fixture)
  const scope = 'favorites:read subscriptions:read offline_access'
  const client = await fixture.register(scope)
  await fixture.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scope.split(' ')) })

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(client, await fixture.authorize(client, 'reader', scope))).json(),
  )

  const favoriteOnly = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        client,
        await fixture.authorize(client, 'other', 'favorites:read offline_access'),
      )
    ).json(),
  )

  const { app, rpc, domain, recording } = setup(fixture)

  const SavedFavorites = Schema.Struct({
    result: Schema.Struct({ structuredContent: ListFavoritesResult }),
  })

  const SavedSubscriptions = Schema.Struct({
    result: Schema.Struct({ structuredContent: ListShowSubscriptionsResult }),
  })

  try {
    const listing = await (await rpc(tokens.access_token, 'tools/list')).json()
    expect(listing).toMatchObject({
      result: { tools: [{ name: 'list_favorites' }, { name: 'list_show_subscriptions' }] },
    })
    expect(await (await rpc(favoriteOnly.access_token, 'tools/list')).json()).toMatchObject({
      result: { tools: [{ name: 'list_favorites' }] },
    })
    expect(
      await (await rpc(favoriteOnly.access_token, 'tools/call', 'list_show_subscriptions')).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })

    for (const name of ['set_favorite', 'set_show_subscription']) {
      expect(await (await rpc(tokens.access_token, 'tools/call', name)).json()).toMatchObject({
        error: { code: -32602 },
      })
    }

    const results = await Promise.all(
      [0, 1, 2, 3].map(async (offset) => {
        const response = await rpc(tokens.access_token, 'tools/call', 'list_favorites', {
          limit: 1,
          offset,
        })

        expect(response.headers.get('cache-control')).toBe('private, no-store')

        return Schema.decodeUnknownSync(SavedFavorites)(await response.json()).result
          .structuredContent
      }),
    )

    expect(results.flatMap((r) => r.favorites.map((f) => f.target.id))).toEqual([
      'track',
      'public',
      'mix',
      'misc',
    ])
    expect(results.map((r) => r.pagination.hasMore)).toEqual([true, true, true, false])
    const all = await (await rpc(tokens.access_token, 'tools/call', 'list_favorites')).json()
    expect(
      Schema.decodeUnknownSync(SavedFavorites)(all)
        .result.structuredContent.favorites.map((f) => f.kind)
        .toSorted(),
    ).toEqual(['misc', 'mix', 'show', 'track'])
    expect(JSON.stringify(all)).not.toMatch(
      /SECRET|private|hidden-audio|dual-audio|other-only|thumbnail|media\.example|userId/,
    )

    const subscriptions = Schema.decodeUnknownSync(SavedSubscriptions)(
      await (await rpc(tokens.access_token, 'tools/call', 'list_show_subscriptions')).json(),
    ).result.structuredContent

    expect(subscriptions.subscriptions).toEqual([
      { show: { id: 'public', title: 'public', slug: 'public' } },
    ])
    expect(subscriptions.pagination).toEqual({ limit: 20, offset: 0, hasMore: false })

    for (const args of [
      { limit: 0 },
      { limit: 51 },
      { offset: -1 },
      { offset: 10001 },
      { limit: 1.5 },
    ]) {
      expect(
        await (await rpc(tokens.access_token, 'tools/call', 'list_favorites', args)).json(),
      ).not.toHaveProperty('result.structuredContent')
    }

    // Shared-service regression: a public audio's private parent cannot supply artwork.
    const shared = await Effect.runPromise(
      withTestLayer(
        Effect.flatMap(FavoriteService, (service) => service.getFavorites('reader')),
        domain,
      ),
    )

    expect(shared.find((f) => f.audioId === 'mix')?.audio?.thumbnailUrl).toBeNull()
    expect(shared.map((f) => f.id)).not.toContain('f-dual')
    expect(recording.messages).toHaveLength(0)
    await fixture.db.update(oauthResource).set({ disabled: true })
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401)
    await fixture.db.update(oauthResource).set({ disabled: false })
    await fixture.db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, client))
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401)
    await fixture.db
      .update(oauthClient)
      .set({ disabled: false })
      .where(eq(oauthClient.clientId, client))
    await fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'reader'))
    expect((await rpc(tokens.access_token, 'tools/call', 'list_favorites')).status).toBe(401)
    await fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'reader'))
    await Effect.runPromise(
      fixture.service.disconnect(Schema.decodeUnknownSync(UserId)('reader'), client),
    )
    expect((await rpc(tokens.access_token, 'tools/call', 'list_show_subscriptions')).status).toBe(
      401,
    )
  } finally {
    await app.dispose()
  }
})

test('service checks scopes and live account, rejects caller-selected owner and bounds', async () => {
  await using fixture = await createEditorialOAuthFixture()
  await seed(fixture)
  const { app, reads } = setup(fixture)

  const run = (
    scopes: ReadonlyArray<'favorites:read' | 'subscriptions:read'>,
    input: typeof ListOwnedInput.Type & { readonly userId?: string },
  ) =>
    Effect.runPromise(
      withTestLayer(
        Effect.flatMap(FavoritesMcpService, (service) => service.listFavorites(input)).pipe(
          Effect.provideService(McpActor, {
            userId: Schema.decodeUnknownSync(UserId)('reader'),
            clientId: Schema.decodeUnknownSync(OAuthClientId)('fixture-client'),
            scopes,
          }),
          Effect.result,
        ),
        reads,
      ),
    )

  try {
    expect(await run(['subscriptions:read'], {})).toHaveProperty('failure.code', 'access_denied')
    expect(await run(['favorites:read'], { userId: 'other' })).toHaveProperty(
      'failure.code',
      'invalid_input',
    )
    expect(await run(['favorites:read'], { limit: 51 })).toHaveProperty(
      'failure.code',
      'invalid_input',
    )
    await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'reader'))
    const admin = await run(['favorites:read'], {})
    expect(admin).toHaveProperty('success.favorites')
    expect(JSON.stringify(admin)).not.toContain('other-only')
    await fixture.db.delete(user).where(eq(user.id, 'reader'))
    expect(await run(['favorites:read'], {})).toHaveProperty('failure.code', 'access_denied')
  } finally {
    await app.dispose()
  }
})

test('both lists enforce defaults, maximum page, stable ties and visibility before pagination', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const { app, reads } = setup(fixture)
  const ids = Array.from({ length: 53 }, (_, index) => `page-${String(index).padStart(2, '0')}`)

  for (const id of ids) {
    await fixture.db
      .insert(showsTable)
      .values({ id, title: id, slug: id, content: '', draft: id === 'page-52' })
    await fixture.db
      .insert(favoritesTable)
      .values({ id, userId: 'reader', showId: id, createdAt: new Date('2026-01-01') })
    await fixture.db
      .insert(showSubscriptionsTable)
      .values({ id, userId: 'reader', showId: id, createdAt: new Date('2026-01-01') })
  }

  const run = (input: { limit?: number; offset?: number }) =>
    Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const service = yield* FavoritesMcpService

          return {
            favorites: yield* service.listFavorites(input),
            subscriptions: yield* service.listShowSubscriptions(input),
          }
        }).pipe(
          Effect.provideService(McpActor, {
            userId: Schema.decodeUnknownSync(UserId)('reader'),
            clientId: Schema.decodeUnknownSync(OAuthClientId)('fixture-client'),
            scopes: ['favorites:read', 'subscriptions:read'],
          }),
        ),
        reads,
      ),
    )

  try {
    const defaults = await run({})
    expect(defaults.favorites.favorites).toHaveLength(20)
    expect(defaults.subscriptions.subscriptions).toHaveLength(20)
    const maximum = await run({ limit: 50 })
    const expected = ids.slice(2, 52).reverse()
    expect(maximum.favorites.favorites.map((item) => item.target.id)).toEqual(expected)
    expect(maximum.subscriptions.subscriptions.map((item) => item.show.id)).toEqual(expected)
    expect(maximum.favorites.pagination.hasMore).toBe(true)
    expect(maximum.subscriptions.pagination.hasMore).toBe(true)
    const last = await run({ limit: 50, offset: 50 })
    expect(last.favorites.favorites.map((item) => item.target.id)).toEqual(['page-01', 'page-00'])
    expect(last.subscriptions.subscriptions.map((item) => item.show.id)).toEqual([
      'page-01',
      'page-00',
    ])
    expect(last.favorites.pagination.hasMore).toBe(false)
    expect(last.subscriptions.pagination.hasMore).toBe(false)
    const empty = await run({ offset: 10000 })
    expect(empty.favorites.favorites).toEqual([])
    expect(empty.subscriptions.subscriptions).toEqual([])
  } finally {
    await app.dispose()
  }
})
