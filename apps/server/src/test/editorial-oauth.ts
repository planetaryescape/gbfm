import { EditorialOAuthSettings, OAuthClientId } from '@gbfm/core/editorial-mcp'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer } from 'better-auth/plugins'
import { Effect, Layer, Schema } from 'effect'

import * as schema from '@/db/exports'
import { Database, makeDatabaseClient } from '@/db/layer'
import { editorialOAuthPlugins } from '@/lib/editorial-oauth'
import { ConfigService, createConfig } from '@/services/config.service'
import { EditorialOAuth, EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

export const OAuthTokens = Schema.Struct({
  access_token: Schema.RedactedFromValue(Schema.String),
  refresh_token: Schema.RedactedFromValue(Schema.String),
})

export const createEditorialOAuthFixture = async () => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)

  const config = {
    ...createConfig(),
    urls: { ...createConfig().urls, frontend: 'https://editorial-test.localhost' },
    mcp: Schema.decodeUnknownSync(EditorialOAuthSettings)({
      ownerUserId: 'owner',
      resourceUrl: 'https://editorial-test.localhost/mcp',
      issuer: 'https://editorial-test.localhost/auth',
    }),
  }

  let beforeRefreshInsert: (() => Promise<void>) | undefined
  const adapterFactory = drizzleAdapter(db, { provider: 'sqlite', schema })

  const makeAuth = () =>
    betterAuth({
      baseURL: config.mcp.issuer,
      basePath: '/auth',
      secret: 'disposable-test-secret-with-at-least-32-chars',
      database: (options) => {
        const adapter = adapterFactory(options)

        const create: typeof adapter.create = async (input) => {
          if (input.model === 'oauthRefreshToken' && beforeRefreshInsert)
            await beforeRefreshInsert()

          return adapter.create(input)
        }

        return { ...adapter, create }
      },
      rateLimit: { enabled: true, storage: 'database', max: 1000, window: 60 },
      advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
      plugins: [bearer(), ...editorialOAuthPlugins(config, db)],
    })

  let auth = makeAuth()

  const now = new Date()

  for (const id of ['owner', 'other']) {
    await db.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      role: id === 'owner' ? 'editor' : 'user',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(schema.session).values({
      id: `${id}-session`,
      token: `${id}-session-token`,
      userId: id,
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: now,
      updatedAt: now,
    })
  }

  const service = await Effect.runPromise(
    withTestLayer(
      EditorialOAuth,
      EditorialOAuthLive.pipe(
        Layer.provide(
          Layer.mergeAll(Layer.succeed(Database, db), Layer.succeed(ConfigService, config)),
        ),
      ),
    ),
  )

  const request = (
    path: string,
    body?: Record<string, string | ReadonlyArray<string> | boolean>,
    owner?: string,
  ) => {
    const headers = new Headers({ 'cf-connecting-ip': '192.0.2.79' })

    if (owner) headers.set('authorization', `Bearer ${owner}-session-token`)
    const options: RequestInit = { method: body ? 'POST' : 'GET', headers }

    if (body) {
      const form = ['/oauth2/token', '/oauth2/revoke'].includes(path)
      headers.set('content-type', form ? 'application/x-www-form-urlencoded' : 'application/json')
      options.body = form
        ? new URLSearchParams(
            Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(body),
          ).toString()
        : JSON.stringify(body)
    }

    return auth.handler(new Request(`https://editorial-test.localhost/auth${path}`, options))
  }

  const register = async () => {
    const response = await request('/oauth2/register', {
      client_name: 'Disposable native client',
      token_endpoint_auth_method: 'none',
      redirect_uris: ['http://127.0.0.1:38479/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })

    if (response.status !== 201) throw new Error(`Registration failed: ${response.status}`)

    return Schema.decodeUnknownSync(Schema.Struct({ client_id: OAuthClientId }))(
      await response.json(),
    ).client_id
  }

  const verifier = 'a'.repeat(64)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))

  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

  const authorizationQuery = (clientId: OAuthClientId) =>
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:38479/callback',
      response_type: 'code',
      scope: 'posts:read offline_access',
      resource: config.mcp.resourceUrl,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'disposable-state',
    })

  const authorize = async (clientId: OAuthClientId) => {
    const authorization = await request(
      `/oauth2/authorize?${authorizationQuery(clientId)}`,
      undefined,
      'owner',
    )

    const location = authorization.headers.get('location')

    if (!location) throw new Error('Missing authorization redirect')
    const url = new URL(location)

    if (url.searchParams.has('code'))
      return Schema.decodeUnknownSync(Schema.String)(url.searchParams.get('code'))

    const consent = await request(
      '/oauth2/consent',
      { accept: true, oauth_query: url.searchParams.toString() },
      'owner',
    )

    const result = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(
      await consent.json(),
    )

    return Schema.decodeUnknownSync(Schema.String)(new URL(result.url).searchParams.get('code'))
  }

  const exchange = (clientId: OAuthClientId, code: string, codeVerifier = verifier) =>
    request('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: 'http://127.0.0.1:38479/callback',
      code_verifier: codeVerifier,
      resource: config.mcp.resourceUrl,
    })

  return {
    db,
    config,
    service,
    request,
    register,
    authorize,
    authorizationQuery,
    exchange,
    recreateAuth: () => {
      auth = makeAuth()
    },
    beforeRefresh: (callback: (() => Promise<void>) | undefined) => {
      beforeRefreshInsert = callback
    },
    [Symbol.asyncDispose]: () => resource.dispose(),
  }
}
