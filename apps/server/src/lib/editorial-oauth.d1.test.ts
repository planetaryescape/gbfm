import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { session, user, verification as authVerification } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  oauthAccessToken,
  oauthClient,
  oauthRefreshToken,
  oauthResource,
  rateLimit,
} from '@/db/oauth.schema'
import { hashEditorialOAuthToken } from '@/lib/editorial-oauth-token'
import { ConfigService, createConfig } from '@/services/config.service'
import { EditorialOAuth, EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

describe('editorial OAuth provider on migrated D1', () => {
  test('the provider downscopes issuance to an existing read-only resource policy', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    await fixture.db
      .update(oauthResource)
      .set({ allowedScopes: JSON.stringify(['posts:read', 'offline_access']) })
      .where(eq(oauthResource.identifier, fixture.config.mcp.resourceUrl))
    fixture.recreateAuth()

    const code = await fixture.authorize(
      clientId,
      'owner',
      'posts:read offline_access drafts:write',
    )

    const exchange = await fixture.exchange(clientId, code)
    expect(exchange.status).toBe(200)
    const tokens = Schema.decodeUnknownSync(OAuthTokens)(await exchange.json())
    expect((await Effect.runPromise(fixture.service.verify(tokens.access_token))).scopes).toEqual([
      'posts:read',
      'offline_access',
    ])
  })
  test('draft-write scope is explicit, requires new consent and never expands existing tokens', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const scope = 'posts:read offline_access drafts:write'
    const clientId = await fixture.register()

    const readTokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    expect(
      (await Effect.runPromise(fixture.service.verify(readTokens.access_token))).scopes,
    ).toEqual(['posts:read', 'offline_access'])

    const authorize = await fixture.request(
      `/oauth2/authorize?${fixture.authorizationQuery(clientId, scope)}`,
      undefined,
      'owner',
    )

    const continuation = new URL(authorize.headers.get('location') ?? '')
    expect(continuation.pathname).toBe('/connect/gbfm/consent')
    expect(continuation.searchParams.get('scope')).toContain('drafts:write')
    expect(continuation.searchParams.has('code')).toBe(false)

    const consent = await fixture.request(
      '/oauth2/consent',
      { accept: true, oauth_query: continuation.searchParams.toString() },
      'owner',
    )

    const accepted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(
      await consent.json(),
    )

    const code = new URL(accepted.url).searchParams.get('code')
    expect(code).toBeTruthy()

    const writeTokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, code ?? '')).json(),
    )

    expect(
      (await Effect.runPromise(fixture.service.verify(writeTokens.access_token))).scopes,
    ).toContain('drafts:write')
    expect(
      (await Effect.runPromise(fixture.service.verify(readTokens.access_token))).scopes,
    ).not.toContain('drafts:write')

    const escalatedRefresh = await fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: Redacted.value(readTokens.refresh_token),
      resource: fixture.config.mcp.resourceUrl,
      scope,
    })

    expect(escalatedRefresh.status).toBe(400)
    expect(await escalatedRefresh.json()).toMatchObject({ error: 'invalid_scope' })
    const connections = await Effect.runPromise(fixture.service.listConnections(fixture.userId))
    expect(connections[0]?.scopes).toContain('drafts:write')

    await fixture.db
      .update(oauthResource)
      .set({ allowedScopes: JSON.stringify(['posts:read', 'offline_access']) })
      .where(eq(oauthResource.identifier, fixture.config.mcp.resourceUrl))
    fixture.recreateAuth()
    await fixture.request('/.well-known/oauth-authorization-server')

    const [policy] = await fixture.db
      .select()
      .from(oauthResource)
      .where(eq(oauthResource.identifier, fixture.config.mcp.resourceUrl))

    expect(JSON.parse(policy?.allowedScopes ?? 'null')).toEqual(['posts:read', 'offline_access'])
    expect(
      await Effect.runPromise(fixture.service.verify(writeTokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    expect(
      (await Effect.runPromise(fixture.service.verify(readTokens.access_token))).scopes,
    ).not.toContain('drafts:write')
  })

  test('existing read-only client registration cannot obtain draft-write tokens', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    await fixture.db
      .update(oauthClient)
      .set({ scopes: JSON.stringify(['posts:read', 'offline_access']) })
      .where(eq(oauthClient.clientId, clientId))

    const [client] = await fixture.db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))

    expect(JSON.parse(client?.scopes ?? 'null')).toEqual(['posts:read', 'offline_access'])

    const response = await fixture.request(
      `/oauth2/authorize?${fixture.authorizationQuery(clientId, 'posts:read drafts:write')}`,
      undefined,
      'owner',
    )

    const location = response.headers.get('location')

    expect(location).toBeTruthy()
    expect(new URL(location ?? 'https://invalid.test').searchParams.get('error')).toBe(
      'invalid_scope',
    )
  })
  test.each(['http://gbfm.localhost', 'https://user:synthetic-private@invalid.test'])(
    'users can revoke grants while MCP configuration is disabled or invalid: %s',
    async (shareUrl) => {
      await using fixture = await createEditorialOAuthFixture()
      const clientId = await fixture.register()

      const tokens = Schema.decodeUnknownSync(OAuthTokens)(
        await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
      )

      const unavailableConfig = {
        ...fixture.config,
        mcp: createConfig({
          APP_STAGE: 'test',
          SHARE_URL: shareUrl,
          USER_CONTENT_BUCKET_NAME: 'disposable',
          MIXES_BUCKET_NAME: 'disposable',
          StorageRegion: 'auto',
          BETTER_AUTH_SECRET: '',
          BETTER_AUTH_URL: '',
          SpotifyClientId: '',
          SpotifyClientSecret: '',
          SENTRY_BACKEND_DSN: '',
          VITE_PUBLIC_SENTRY_DSN: '',
          CloudflareAnalyticsApiToken: '',
        }).mcp,
      }

      const service = await Effect.runPromise(
        withTestLayer(
          EditorialOAuth,
          EditorialOAuthLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Database, fixture.db),
                Layer.succeed(ConfigService, unavailableConfig),
              ),
            ),
          ),
        ),
      )

      expect(unavailableConfig.mcp).toBeUndefined()
      expect(await Effect.runPromise(service.listConnections(fixture.userId))).toMatchObject([
        { clientId },
      ])
      await Effect.runPromise(
        service.disconnect(Schema.decodeUnknownSync(UserId)('other'), clientId),
      )
      expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
        userId: 'owner',
        clientId,
      })
      await Effect.runPromise(service.disconnect(fixture.userId, clientId))
      expect(await Effect.runPromise(service.listConnections(fixture.userId))).toEqual([])
      expect(
        await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
      ).toHaveProperty('_tag', 'Failure')

      const refresh = await fixture.request('/oauth2/token', {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: Redacted.value(tokens.refresh_token),
        resource: fixture.config.mcp.resourceUrl,
      })

      expect(refresh.status).toBe(400)
      expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })
    },
  )

  test('two eligible users independently connect the same client and disconnect only their own grants', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const first = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    const second = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId, 'other'))).json(),
    )

    const otherId = Schema.decodeUnknownSync(UserId)('other')

    expect(await Effect.runPromise(fixture.service.verify(first.access_token))).toMatchObject({
      userId: 'owner',
      clientId,
    })
    expect(await Effect.runPromise(fixture.service.verify(second.access_token))).toMatchObject({
      userId: 'other',
      clientId,
    })
    expect(await Effect.runPromise(fixture.service.listConnections(fixture.userId))).toMatchObject([
      { clientId },
    ])
    expect(
      (await Effect.runPromise(fixture.service.listConnections(otherId)))
        .map((connection) => connection.clientId)
        .toSorted(),
    ).toEqual([clientId])
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    expect(await Effect.runPromise(fixture.service.listConnections(fixture.userId))).toEqual([])
    expect(
      await Effect.runPromise(fixture.service.verify(first.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    expect(await Effect.runPromise(fixture.service.verify(second.access_token))).toMatchObject({
      userId: 'other',
    })

    const refreshed = await fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: Redacted.value(second.refresh_token),
      resource: fixture.config.mcp.resourceUrl,
    })

    expect(refreshed.status).toBe(200)
    expect(
      await Effect.runPromise(
        fixture.service.verify(
          Schema.decodeUnknownSync(OAuthTokens)(await refreshed.json()).access_token,
        ),
      ),
    ).toMatchObject({ userId: 'other' })
  })

  test('another user cannot list or revoke an exclusive app and role demotion does not prevent managing grants', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    const otherId = Schema.decodeUnknownSync(UserId)('other')

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId, 'other'))).json(),
    )

    expect(await Effect.runPromise(fixture.service.listConnections(fixture.userId))).toEqual([])
    expect(
      await Effect.runPromise(
        fixture.service.listConnections(Schema.decodeUnknownSync(UserId)('reader')),
      ),
    ).toEqual([])
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      userId: 'other',
      clientId,
    })
    await fixture.db.update(user).set({ role: 'user' }).where(eq(user.id, otherId))
    expect(
      (await Effect.runPromise(fixture.service.listConnections(otherId)))
        .map((connection) => connection.clientId)
        .toSorted(),
    ).toEqual([clientId])
    await Effect.runPromise(fixture.service.disconnect(otherId, clientId))
    expect(await Effect.runPromise(fixture.service.listConnections(otherId))).toEqual([])
  })

  test('disconnecting one user preserves another user pending code for the same client', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const first = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    const secondCode = await fixture.authorize(clientId, 'other')
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    const exchanged = await fixture.exchange(clientId, secondCode)
    expect(exchanged.status).toBe(200)
    const second = Schema.decodeUnknownSync(OAuthTokens)(await exchanged.json())
    expect(await Effect.runPromise(fixture.service.verify(second.access_token))).toMatchObject({
      userId: 'other',
      clientId,
    })
    expect(
      await Effect.runPromise(fixture.service.verify(first.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
  })

  test('impersonated sessions cannot authorize an editorial connection', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    await fixture.db
      .update(session)
      .set({ impersonatedBy: 'other' })
      .where(eq(session.userId, 'owner'))

    const response = await fixture.request(
      `/oauth2/authorize?${fixture.authorizationQuery(clientId)}`,
      undefined,
      'owner',
    )

    expect(response.status).toBe(403)
  })

  test('malformed persisted authorization grants produce OAuth invalid_grant without leaking data', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    const code = await fixture.authorize(clientId)
    await fixture.db
      .update(authVerification)
      .set({ value: '{"private":"synthetic-private-grant"}' })
      .where(eq(authVerification.identifier, await hashEditorialOAuthToken(code)))
    const response = await fixture.exchange(clientId, code)
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({
      error: 'invalid_grant',
      error_description: 'Invalid editorial grant',
    })
    expect(body).not.toContain('synthetic-private-grant')
  })

  test('migrated token foreign keys have usable lookup indexes', async () => {
    await using fixture = await createEditorialOAuthFixture()

    for (const { table, column } of [
      { table: 'oauth_refresh_token', column: 'client_id' },
      { table: 'oauth_refresh_token', column: 'session_id' },
      { table: 'oauth_access_token', column: 'client_id' },
      { table: 'oauth_access_token', column: 'session_id' },
      { table: 'oauth_access_token', column: 'refresh_id' },
    ]) {
      const plan = await fixture.db.$client
        .prepare(`EXPLAIN QUERY PLAN SELECT id FROM ${table} WHERE ${column} = ?`)
        .bind('disposable')
        .all()

      const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ detail: Schema.String })))(
        plan.results,
      )

      expect(rows.some(({ detail }) => detail.includes(`${table}_${column}_idx`))).toBe(true)
    }
  })

  test('the next verification rejects role demotion and accepts restored editorial permission', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      clientId,
    })
    await fixture.db.update(user).set({ role: 'user' }).where(eq(user.id, fixture.userId))
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    await fixture.db.update(user).set({ role: 'editor' }).where(eq(user.id, fixture.userId))
    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      clientId,
    })
  })

  test('opaque refresh rotation, strict replay and provider token revocation', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    expect(
      (
        await fixture.request('/oauth2/token', {
          grant_type: 'client_credentials',
          client_id: clientId,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await fixture.request('/oauth2/token', {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: Redacted.value(tokens.refresh_token),
          scope: 'offline_access',
          resource: fixture.config.mcp.resourceUrl,
        })
      ).status,
    ).toBe(400)

    const refreshed = await fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: Redacted.value(tokens.refresh_token),
      resource: fixture.config.mcp.resourceUrl,
    })

    expect(refreshed.status).toBe(200)
    const rotated = Schema.decodeUnknownSync(OAuthTokens)(await refreshed.json())
    expect(await Effect.runPromise(fixture.service.verify(rotated.access_token))).toMatchObject({
      clientId,
    })
    expect(Redacted.value(rotated.refresh_token)).not.toBe(Redacted.value(tokens.refresh_token))

    const revoked = await fixture.request('/oauth2/revoke', {
      client_id: clientId,
      token: Redacted.value(rotated.access_token),
      token_type_hint: 'access_token',
    })

    expect(revoked.status).toBe(200)
    expect(
      await Effect.runPromise(fixture.service.verify(rotated.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')

    const replay = await fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: Redacted.value(tokens.refresh_token),
      resource: fixture.config.mcp.resourceUrl,
    })

    expect(replay.status).toBe(400)
  })

  test('PKCE, editorial permission, audience and public client policy', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    expect(
      (
        await fixture.request(
          `/oauth2/authorize?${fixture.authorizationQuery(clientId)}`,
          undefined,
          'reader',
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await fixture.request('/oauth2/register', {
          token_endpoint_auth_method: 'client_secret_post',
          redirect_uris: ['https://external.example.com/callback'],
        })
      ).status,
    ).toBe(400)

    const invalidPkce = await fixture.exchange(
      clientId,
      await fixture.authorize(clientId),
      'b'.repeat(64),
    )

    expect(invalidPkce.status).toBe(400)
    const ownerCode = await fixture.authorize(clientId)
    await fixture.db
      .update(authVerification)
      .set({ value: JSON.stringify({ userId: 'reader' }) })
      .where(eq(authVerification.identifier, await hashEditorialOAuthToken(ownerCode)))
    expect((await fixture.exchange(clientId, ownerCode)).status).toBe(403)
    const response = await fixture.exchange(clientId, await fixture.authorize(clientId))
    expect(response.status).toBe(200)
    const tokens = Schema.decodeUnknownSync(OAuthTokens)(await response.json())
    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      userId: 'owner',
      clientId,
    })
    expect(await Effect.runPromise(fixture.service.listConnections(fixture.userId))).toHaveLength(1)
    await Effect.runPromise(
      fixture.service.disconnect(Schema.decodeUnknownSync(UserId)('other'), clientId),
    )
    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      userId: 'owner',
      clientId,
    })
    await fixture.db
      .update(oauthAccessToken)
      .set({ resources: JSON.stringify(['https://other.example.com/mcp']) })
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    expect(
      (
        await fixture.request('/oauth2/token', {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: Redacted.value(tokens.refresh_token),
          resource: 'https://other.example.com/mcp',
        })
      ).status,
    ).toBe(400)
    await fixture.db.update(oauthRefreshToken).set({ userId: 'reader' })
    expect(
      (
        await fixture.request('/oauth2/token', {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: Redacted.value(tokens.refresh_token),
          resource: fixture.config.mcp.resourceUrl,
        })
      ).status,
    ).toBe(403)
  })

  test('disconnect rejects stale codes and old tokens while reconnection and other clients work', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    const otherClient = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    const otherTokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(otherClient, await fixture.authorize(otherClient))).json(),
    )

    const staleCode = await fixture.authorize(clientId)
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    expect(await Effect.runPromise(fixture.service.verify(otherTokens.access_token))).toMatchObject(
      { clientId: otherClient },
    )
    expect(
      (
        await fixture.request('/oauth2/token', {
          grant_type: 'refresh_token',
          client_id: otherClient,
          refresh_token: Redacted.value(otherTokens.refresh_token),
          resource: fixture.config.mcp.resourceUrl,
        })
      ).status,
    ).toBe(200)
    const staleExchange = await fixture.exchange(clientId, staleCode)
    expect(staleExchange.status).toBeGreaterThanOrEqual(400)
    const reconnected = await fixture.exchange(clientId, await fixture.authorize(clientId))
    expect(reconnected.status).toBe(200)
    const newTokens = Schema.decodeUnknownSync(OAuthTokens)(await reconnected.json())
    expect(await Effect.runPromise(fixture.service.verify(newTokens.access_token))).toMatchObject({
      clientId,
    })
    expect(
      (
        await fixture.request('/oauth2/token', {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: Redacted.value(tokens.refresh_token),
          resource: fixture.config.mcp.resourceUrl,
        })
      ).status,
    ).toBe(400)
  })

  test('a refresh claimed before disconnect cannot insert its successor after reconnection', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    fixture.beforeRefresh(async () => {
      started.resolve()
      await release.promise
    })

    const refreshing = fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: Redacted.value(tokens.refresh_token),
      resource: fixture.config.mcp.resourceUrl,
    })

    await started.promise
    fixture.beforeRefresh(undefined)
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    const reconnected = await fixture.exchange(clientId, await fixture.authorize(clientId))
    expect(reconnected.status).toBe(200)
    release.resolve()
    const rejected = await refreshing
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ error: 'invalid_grant' })
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    const newTokens = Schema.decodeUnknownSync(OAuthTokens)(await reconnected.json())
    expect(await Effect.runPromise(fixture.service.verify(newTokens.access_token))).toMatchObject({
      clientId,
    })
  })

  test('registration is durably rate limited', async () => {
    await using fixture = await createEditorialOAuthFixture()

    for (let index = 0; index < 5; index++) await fixture.register()
    fixture.recreateAuth()

    const rejected = await fixture.request('/oauth2/register', {
      token_endpoint_auth_method: 'none',
      redirect_uris: ['http://127.0.0.1:38479/callback'],
    })

    expect(rejected.status).toBe(429)
    expect(await fixture.db.select().from(rateLimit)).not.toEqual([])
  })

  test('account deletion removes grants without blocking the existing account lifecycle', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    await fixture.db.delete(user).where(eq(user.id, 'owner'))
    expect(await fixture.db.select().from(oauthAccessToken)).toEqual([])
    expect(await fixture.db.select().from(oauthRefreshToken)).toEqual([])
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
  })
})
