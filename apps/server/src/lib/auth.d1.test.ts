import type { D1Database } from '@cloudflare/workers-types'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Clock, Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { emailDeliveryLogsTable } from '@/db/email.schema'
import * as databaseSchema from '@/db/exports'
import { Database, DatabaseLayer } from '@/db/layer'
import { ConfigService, createConfig, type WorkerConfigBindings } from '@/services/config.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { EmailTransport, type OutboundEmailMessage } from '@/services/email-transport.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { Auth, AuthLive } from './auth'

const workerBindings = (): WorkerConfigBindings => ({
  APP_STAGE: 'test',
  USER_CONTENT_BUCKET_NAME: 'user-content',
  MIXES_BUCKET_NAME: 'mixes',
  EMAIL_SENDER: 'noreply@mail.goosebumps.fm',
  SpotifyClientId: 'configured',
  SpotifyClientSecret: 'configured',
  SENTRY_BACKEND_DSN: 'configured',
  VITE_PUBLIC_SENTRY_DSN: 'configured',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'configured',
  OTEL_EXPORTER_OTLP_HEADERS: 'configured',
  CloudflareAnalyticsApiToken: 'test-analytics-token',
  BETTER_AUTH_SECRET: 'configured',
  BETTER_AUTH_URL: 'http://localhost',
  StorageProvider: 'aws',
  StorageEndpoint: 'configured',
  StorageRegion: 'configured',
  StorageAccessKeyId: 'configured',
  StorageSecretAccessKey: 'configured',
  StorageSigningEndpoint: 'configured',
})

const makeDeferredTransport = () => {
  const messages: Array<OutboundEmailMessage> = []
  let resolveStarted: (() => void) | undefined
  let resolveDelivery: (() => void) | undefined

  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })

  const delivered = new Promise<void>((resolve) => {
    resolveDelivery = resolve
  })

  return {
    messages,
    started,
    release: () => {
      if (resolveDelivery === undefined) throw new Error('Email delivery did not start')
      resolveDelivery()
    },
    layer: Layer.succeed(EmailTransport, {
      send: (message) =>
        Effect.promise(async () => {
          messages.push(message)

          if (resolveStarted === undefined) throw new Error('Email delivery started more than once')
          resolveStarted()
          await delivered

          return { provider: 'cloudflare' as const, messageId: 'password-reset-receipt' }
        }),
    }),
  }
}

const authLayer = (
  d1: D1Database,
  transport: ReturnType<typeof makeDeferredTransport>['layer'],
  queries?: Array<string>,
  bindings: WorkerConfigBindings = workerBindings(),
) => {
  const database =
    queries === undefined
      ? DatabaseLayer(d1)
      : Layer.succeed(
          Database,
          drizzle(d1, {
            schema: databaseSchema,
            logger: {
              logQuery: (query) => {
                queries.push(query)
              },
            },
          }),
        )

  const config = Layer.succeed(ConfigService, createConfig(bindings))

  const clock = Layer.succeed(Clock.Clock, {
    currentTimeMillis: Effect.sync(Date.now),
    currentTimeMillisUnsafe: Date.now,
    currentTimeNanos: Effect.sync(() => BigInt(Date.now()) * 1_000_000n),
    currentTimeNanosUnsafe: () => BigInt(Date.now()) * 1_000_000n,
    monotonicTimeNanos: Effect.sync(() => BigInt(Date.now()) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => BigInt(Date.now()) * 1_000_000n,
    sleep: () => Effect.void,
  })

  const delivery = EmailDeliveryLive.pipe(
    Layer.provide(Layer.mergeAll(database, config, transport, clock)),
  )

  return AuthLive.pipe(Layer.provide(Layer.mergeAll(database, config, delivery, clock)))
}

describe('AuthLive password-reset delivery', () => {
  test('awaits the Better Auth reset callback until delivery persists its receipt', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const transport = makeDeferredTransport()
    const auth = await Effect.runPromise(withTestLayer(Auth, authLayer(d1, transport.layer)))

    await database.insert(user).values({
      id: crypto.randomUUID(),
      name: 'Reset listener',
      email: 'reset-listener@example.com',
    })

    const response = auth.handler(
      new Request('http://localhost/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({
          email: 'reset-listener@example.com',
          redirectTo: 'http://localhost/reset-password',
        }),
      }),
    )

    await transport.started
    await expect(
      Promise.race([response.then(() => 'resolved' as const), Promise.resolve('pending' as const)]),
    ).resolves.toBe('pending')

    transport.release()
    await expect(response).resolves.toMatchObject({ status: 200 })

    const [log] = await database.select().from(emailDeliveryLogsTable)
    expect(transport.messages).toHaveLength(1)
    expect(log).toMatchObject({
      status: 'SENT',
      provider: 'cloudflare',
      providerMessageId: 'password-reset-receipt',
    })
  })
})

test('AuthLive uses the explicit MCP issuer, durable rate limits and only trusted IP headers', async () => {
  await using resource = await createMigratedD1Database()

  const transport = Layer.succeed(EmailTransport, {
    send: () => Effect.succeed({ provider: 'cloudflare' as const, messageId: 'local-receipt' }),
  })

  const auth = await Effect.runPromise(
    withTestLayer(
      Auth,
      authLayer(resource.database, transport, undefined, {
        ...workerBindings(),
        MCP_OWNER_USER_ID: 'owner',
        MCP_RESOURCE_URL: 'https://editorial-test.localhost/mcp',
      }),
    ),
  )

  expect(auth.options.baseURL).toBe('https://editorial-test.localhost/auth')
  expect(auth.options.basePath).toBe('/auth')
  expect(auth.options.rateLimit).toEqual({ enabled: true, storage: 'database' })
  expect(auth.options.advanced?.ipAddress).toEqual({ ipAddressHeaders: ['cf-connecting-ip'] })

  const registration = await auth.handler(
    new Request('https://editorial-test.localhost/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.79' },
      body: JSON.stringify({
        token_endpoint_auth_method: 'none',
        redirect_uris: ['http://127.0.0.1:38479/callback'],
      }),
    }),
  )

  expect(registration.status).toBe(201)
})

test('joined cookie sessions read current roles, renew cookies and reject immediate revocation', async () => {
  await using d1Resource = await createMigratedD1Database()
  const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1Resource.database)))

  const transport = Layer.succeed(EmailTransport, {
    send: () => Effect.succeed({ provider: 'cloudflare' as const, messageId: 'local-receipt' }),
  })

  const queries: Array<string> = []

  const auth = await Effect.runPromise(
    withTestLayer(Auth, authLayer(d1Resource.database, transport, queries)),
  )

  const signup = await auth.handler(
    new Request('http://localhost/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({
        name: 'Revocation fixture',
        email: 'revocation@example.test',
        password: 'LocalTest123!',
      }),
    }),
  )

  expect(signup.status).toBe(200)

  const identity = Schema.decodeUnknownSync(
    Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }),
  )(await signup.json())

  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')

  const read = () =>
    auth.handler(new Request('http://localhost/auth/get-session', { headers: { cookie } }))

  const sessionIdentity = Schema.Struct({ user: Schema.Struct({ role: Schema.String }) })
  queries.length = 0
  expect(Schema.decodeUnknownSync(sessionIdentity)(await (await read()).json()).user.role).toBe(
    'user',
  )
  expect(queries).toHaveLength(1)
  expect(queries[0]).toContain('json_array')
  expect(queries[0]).toContain('"session"')
  expect(queries[0]).toContain('"user"')
  await database.update(user).set({ role: 'creator' }).where(eq(user.id, identity.user.id))
  queries.length = 0
  expect(Schema.decodeUnknownSync(sessionIdentity)(await (await read()).json()).user.role).toBe(
    'creator',
  )
  expect(queries).toHaveLength(1)
  expect((await read()).headers.getSetCookie()).toHaveLength(0)
  const previousExpiry = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 - 60_000)
  await database
    .update(session)
    .set({ expiresAt: previousExpiry })
    .where(eq(session.userId, identity.user.id))
  queries.length = 0

  const renewed = await auth.api.getSession({
    headers: new Headers({ cookie }),
    returnHeaders: true,
  })

  const renewedIdentity = renewed.response
  expect(renewedIdentity).not.toBeNull()

  if (renewedIdentity === null) throw new Error('Session did not renew')
  expect(renewedIdentity.user.role).toBe('creator')
  expect(renewedIdentity.session.expiresAt.getTime()).toBeGreaterThan(previousExpiry.getTime())
  expect(
    renewed.headers.getSetCookie().some((value) => value.startsWith('better-auth.session_token=')),
  ).toBe(true)
  expect(queries).toHaveLength(2)

  const [persistedSession] = await database
    .select()
    .from(session)
    .where(eq(session.userId, identity.user.id))

  expect(persistedSession?.expiresAt.toISOString()).toBe(
    renewedIdentity.session.expiresAt.toISOString(),
  )
  expect(persistedSession).toBeDefined()

  if (persistedSession === undefined) throw new Error('Renewed session was not persisted')
  queries.length = 0
  const bearerHeaders = new Headers({ authorization: `Bearer ${persistedSession.token}` })
  const bearerIdentity = await auth.api.getSession({ headers: bearerHeaders })
  expect(bearerIdentity?.user.role).toBe('creator')
  expect(queries).toHaveLength(1)
  await database.update(user).set({ role: 'user' }).where(eq(user.id, identity.user.id))
  queries.length = 0
  expect(Schema.decodeUnknownSync(sessionIdentity)(await (await read()).json()).user.role).toBe(
    'user',
  )
  expect(queries).toHaveLength(1)
  await database.delete(session).where(eq(session.userId, identity.user.id))
  queries.length = 0
  expect((await (await read()).json()) === null).toBe(true)
  expect(queries).toHaveLength(1)
  expect(await auth.api.getSession({ headers: bearerHeaders })).toBeNull()
})

test('joined session reads isolate users and reject missing or expired tokens', async () => {
  await using d1Resource = await createMigratedD1Database()
  const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1Resource.database)))

  const transport = Layer.succeed(EmailTransport, {
    send: () => Effect.succeed({ provider: 'cloudflare' as const, messageId: 'local-receipt' }),
  })

  const queries: Array<string> = []

  const auth = await Effect.runPromise(
    withTestLayer(Auth, authLayer(d1Resource.database, transport, queries)),
  )

  const now = Date.now()
  await database.insert(user).values([
    {
      id: 'session-owner',
      name: 'Session owner',
      email: 'owner@example.test',
      role: 'creator',
      username: 'session-owner',
      displayUsername: 'Session-Owner',
    },
    { id: 'other-user', name: 'Other user', email: 'other@example.test', role: 'admin' },
  ])
  await database.insert(session).values([
    {
      id: 'owner-session',
      userId: 'session-owner',
      token: 'owner-token',
      expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(now),
      impersonatedBy: 'other-user',
    },
    {
      id: 'expired-session',
      userId: 'other-user',
      token: 'expired-token',
      expiresAt: new Date(now - 60_000),
      updatedAt: new Date(now),
    },
  ])

  const read = (token: string) =>
    auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })

  queries.length = 0
  const identity = await read('owner-token')
  expect(identity?.user).toMatchObject({
    id: 'session-owner',
    role: 'creator',
    username: 'session-owner',
    displayUsername: 'Session-Owner',
  })
  expect(identity?.session).toMatchObject({
    id: 'owner-session',
    userId: 'session-owner',
    impersonatedBy: 'other-user',
  })
  expect(identity?.session.expiresAt).toBeInstanceOf(Date)
  expect(identity?.user.createdAt).toBeInstanceOf(Date)
  expect(queries).toHaveLength(1)
  queries.length = 0
  expect(await auth.api.getSession({ headers: new Headers() })).toBeNull()
  expect(queries).toHaveLength(0)
  expect(await read('missing-token')).toBeNull()
  expect(queries).toHaveLength(1)
  expect(await read('expired-token')).toBeNull()
  expect(
    await database.select().from(session).where(eq(session.id, 'expired-session')),
  ).toHaveLength(0)
  expect((await read('owner-token'))?.user.id).toBe('session-owner')
})
