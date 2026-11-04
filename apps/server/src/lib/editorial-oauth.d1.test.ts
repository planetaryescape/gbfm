import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { user, verification as authVerification } from '@/db/auth.schema'
import { oauthAccessToken, oauthRefreshToken, rateLimit } from '@/db/oauth.schema'
import { hashEditorialOAuthToken } from '@/lib/editorial-oauth-token'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'

describe('editorial OAuth provider on migrated D1', () => {
  test('the next verification rejects role demotion and accepts restored editorial permission', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      clientId,
    })
    await fixture.db
      .update(user)
      .set({ role: 'user' })
      .where(eq(user.id, fixture.config.mcp.ownerUserId))
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    await fixture.db
      .update(user)
      .set({ role: 'editor' })
      .where(eq(user.id, fixture.config.mcp.ownerUserId))
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

  test('PKCE, owner-only authorization and issuance, audience and public client policy', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()
    expect(
      (
        await fixture.request(
          `/oauth2/authorize?${fixture.authorizationQuery(clientId)}`,
          undefined,
          'other',
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
      .set({ value: JSON.stringify({ userId: 'other' }) })
      .where(eq(authVerification.identifier, await hashEditorialOAuthToken(ownerCode)))
    expect((await fixture.exchange(clientId, ownerCode)).status).toBe(403)
    const response = await fixture.exchange(clientId, await fixture.authorize(clientId))
    expect(response.status).toBe(200)
    const tokens = Schema.decodeUnknownSync(OAuthTokens)(await response.json())
    expect(await Effect.runPromise(fixture.service.verify(tokens.access_token))).toMatchObject({
      userId: 'owner',
      clientId,
    })
    expect(
      await Effect.runPromise(fixture.service.listConnections(fixture.config.mcp.ownerUserId)),
    ).toHaveLength(1)
    expect(
      await Effect.runPromise(
        fixture.service
          .disconnect(Schema.decodeUnknownSync(UserId)('other'), clientId)
          .pipe(Effect.result),
      ),
    ).toHaveProperty('_tag', 'Failure')
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
    await fixture.db.update(oauthRefreshToken).set({ userId: 'other' })
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
    await Effect.runPromise(fixture.service.disconnect(fixture.config.mcp.ownerUserId, clientId))
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
    await Effect.runPromise(fixture.service.disconnect(fixture.config.mcp.ownerUserId, clientId))
    const reconnected = await fixture.exchange(clientId, await fixture.authorize(clientId))
    expect(reconnected.status).toBe(200)
    release.resolve()
    expect((await refreshing).status).toBeGreaterThanOrEqual(400)
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
