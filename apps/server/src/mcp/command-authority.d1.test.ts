import { AuthenticatedActor, Credential, PersonalAccessKeyActor } from '@gbfm/api/middleware/actor'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { UserId } from '@gbfm/core/identity'
import { KeyEnvironment, KeyId } from '@gbfm/core/personal-access-keys'
import { eq, sql } from 'drizzle-orm'
import { Effect, Predicate, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  editorialOAuthRevokedGrant,
  oauthAccessToken,
  oauthClient,
  oauthResource,
} from '@/db/oauth.schema'
import { personalAccessKeys } from '@/db/personal-access-key.schema'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth } from '@/services/editorial-oauth.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createComposedMcpFixture } from '@/test/mcp-catalogue-fixture'

import {
  makeActorCommandAuthority,
  makeOAuthCommandAuthority,
  makeSessionCommandAuthority,
} from './command-authority'
import { createMcpOperationStore } from './operations/store'

test('real OAuth HTTP composition supplies request-scoped command authority', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register()

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        clientId,
        await fixture.authorize(clientId, 'owner', 'posts:read drafts:write offline_access'),
      )
    ).json(),
  )

  const handler = createComposedMcpFixture(fixture)

  const call = () =>
    handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'fixture_command_checkpoint',
          authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'fixture_command_checkpoint',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )

  try {
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: { structuredContent: { actorId: 'owner', clientId } },
    })
    await fixture.db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, clientId))
    expect((await call()).status).toBe(401)
  } finally {
    await handler.dispose()
  }
}, 15_000)

test('persisted OAuth guards fail closed after preflight and replay never discloses revoked results', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register()

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        clientId,
        await fixture.authorize(clientId, 'owner', 'posts:read drafts:write offline_access'),
      )
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

  const checkpoint = await Effect.runPromise(authority.checkpoint(['drafts:write']))
  const raw = fixture.db

  const token = Schema.decodeUnknownSync(
    Schema.Struct({
      scopes: Schema.String,
      resources: Schema.String,
      referenceId: Schema.String,
    }),
  )((await raw.select().from(oauthAccessToken))[0])

  // The guard is evaluated against the actual persisted authority, even when a
  // caller still holds a previously successful callback/checkpoint.
  const assertGuard = async (allowed: number) =>
    expect(
      await raw.get(sql`SELECT CASE WHEN ${checkpoint.liveGuard} THEN 1 ELSE 0 END AS allowed`),
    ).toEqual({ allowed })

  await assertGuard(1)
  await raw.update(oauthClient).set({ disabled: true }).where(eq(oauthClient.clientId, clientId))
  await assertGuard(0)
  await raw.update(oauthClient).set({ disabled: false }).where(eq(oauthClient.clientId, clientId))
  await raw.update(oauthResource).set({ allowedScopes: JSON.stringify(['posts:read']) })
  await assertGuard(0)
  await raw.update(oauthResource).set({ allowedScopes: token.scopes })
  await raw.update(oauthAccessToken).set({ resources: JSON.stringify(['https://wrong.test/mcp']) })
  await assertGuard(0)
  await raw.update(oauthAccessToken).set({ resources: token.resources })
  await raw.update(oauthAccessToken).set({ scopes: JSON.stringify(['posts:read']) })
  await assertGuard(0)
  await raw.update(oauthAccessToken).set({ scopes: token.scopes })
  await raw.update(user).set({ banned: true }).where(eq(user.id, principal.userId))
  await assertGuard(0)
  await raw.update(user).set({ banned: false, role: 'user' }).where(eq(user.id, principal.userId))
  await assertGuard(0)
  await raw.update(user).set({ role: 'editor' }).where(eq(user.id, principal.userId))
  await raw
    .update(session)
    .set({ expiresAt: new Date(0) })
    .where(eq(session.id, 'owner-session'))
  await assertGuard(0)
  await raw
    .update(session)
    .set({ expiresAt: new Date(Date.now() + 60_000) })
    .where(eq(session.id, 'owner-session'))
  await raw.update(oauthAccessToken).set({ expiresAt: new Date(0) })
  await assertGuard(0)
  await raw.update(oauthAccessToken).set({ expiresAt: new Date(Date.now() + 60_000) })
  await assertGuard(1)

  // Use an existing domain row and the real common store; no substitute ledger.
  const store = createMcpOperationStore(fixture.database)
  const requestId = crypto.randomUUID()

  const execute = (authorize: () => Promise<boolean>) =>
    store.execute({
      key: { ...checkpoint, operation: 'authority.probe', requestId },
      normalizedInput: { title: 'Authority probe' },
      now: Date.now(),
      authorize,
      build: ({ fence, prepare, attemptId }) => ({
        statements: [
          prepare(sql`UPDATE user SET name = ${attemptId}
        WHERE id = ${principal.userId} AND ${fence} AND ${checkpoint.liveGuard}`),
        ],
        assertApplied: sql`EXISTS (SELECT 1 FROM user WHERE id = ${principal.userId} AND name = ${attemptId}) AND ${checkpoint.liveGuard}`,
        outcome: { result: { title: 'Authority probe' }, revision: 1, access: null },
      }),
    })

  await raw.update(oauthAccessToken).set({ revoked: new Date() })
  expect(await execute(async () => true)).toEqual({ status: 'conflict' })
  expect(await raw.select().from(user).where(eq(user.id, principal.userId))).toMatchObject([
    { name: 'owner' },
  ])
  await raw.update(oauthAccessToken).set({ revoked: null })
  expect(await execute(async () => true)).toHaveProperty('status', 'applied')
  await raw.insert(editorialOAuthRevokedGrant).values({
    id: crypto.randomUUID(),
    referenceId: token.referenceId,
    clientId,
  })
  await assertGuard(0)
  expect(
    await execute(async () => {
      const result = await Effect.runPromise(
        authority.checkpoint(['drafts:write']).pipe(Effect.result),
      )

      return Predicate.isTagged(result, 'Success')
    }),
  ).toEqual({ status: 'access_denied' })
}, 15_000)

test('browser namespace is actor-stable but every guard remains bound to its live session', async () => {
  await using fixture = await createEditorialOAuthFixture()

  const make = (sessionId: string) =>
    Effect.runPromise(
      makeSessionCommandAuthority.pipe(
        Effect.provideService(AuthSession, {
          user: { id: 'owner', name: 'owner', email: 'owner@example.com' },
          session: { id: sessionId, createdAt: new Date() },
        }),
        Effect.provideService(Database, fixture.db),
        Effect.provideService(ConfigService, fixture.config),
      ),
    )

  await fixture.db.insert(session).values({
    id: 'owner-other-session',
    token: 'disposable-other-session',
    userId: 'owner',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const first = await make('owner-session')
  const second = await make('owner-other-session')
  const a = await Effect.runPromise(first.checkpoint(['drafts:write']))
  const b = await Effect.runPromise(second.checkpoint(['drafts:write']))
  expect([a.actorId, a.clientId, a.resource]).toEqual([b.actorId, b.clientId, b.resource])
  expect(a.clientId).toBe('gbfm:session')
  expect(a.resource).toBe(new URL('/api', fixture.config.urls.share).href)
  await fixture.db.delete(session).where(eq(session.id, 'owner-session'))
  expect(
    await fixture.db.get(sql`SELECT CASE WHEN ${a.liveGuard} THEN 1 ELSE 0 END AS allowed`),
  ).toEqual({ allowed: 0 })
  expect(
    await fixture.db.get(sql`SELECT CASE WHEN ${b.liveGuard} THEN 1 ELSE 0 END AS allowed`),
  ).toEqual({ allowed: 1 })
  expect(
    await Effect.runPromise(first.checkpoint(['drafts:write']).pipe(Effect.result)),
  ).toHaveProperty('_tag', 'Failure')
  expect(
    await Effect.runPromise(second.checkpoint(['catalogue:write']).pipe(Effect.result)),
  ).toHaveProperty('_tag', 'Failure')
}, 10_000)

test('PAT namespaces bind the persisted key and never extend key scopes to catalogue commands', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const keyId = crypto.randomUUID()
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await fixture.db.insert(personalAccessKeys).values({
    id: keyId,
    ownerUserId: 'owner',
    issuanceRequestId: crypto.randomUUID(),
    name: 'Disposable',
    environment: fixture.config.app.stage,
    scopes: JSON.stringify(['posts:update']),
    secretHash: 'a'.repeat(64),
    displayPrefix: 'gbfm_pat_v1_dev_abcdef',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  })

  const actor = Schema.decodeUnknownSync(PersonalAccessKeyActor)({
    user: { id: UserId.make('owner'), name: 'owner', email: 'owner@example.com', role: 'admin' },
    credential: Credential.PersonalAccessKey({
      keyId: KeyId.make(keyId),
      environment: Schema.decodeUnknownSync(KeyEnvironment)(fixture.config.app.stage),
      scopes: ['posts:update'],
    }),
  })

  const authority = await Effect.runPromise(
    makeActorCommandAuthority(['posts:update']).pipe(
      Effect.provideService(AuthenticatedActor, actor),
      Effect.provideService(Database, fixture.db),
      Effect.provideService(ConfigService, fixture.config),
    ),
  )

  const checkpoint = await Effect.runPromise(authority.checkpoint(['drafts:write']))
  expect(checkpoint.clientId).toBe(`gbfm:pat:${keyId}`)
  expect(
    await Effect.runPromise(authority.checkpoint(['catalogue:write']).pipe(Effect.result)),
  ).toHaveProperty('_tag', 'Failure')
  expect(
    await Effect.runPromise(authority.checkpoint(['content:publish']).pipe(Effect.result)),
  ).toHaveProperty('_tag', 'Failure')
  await fixture.db
    .update(personalAccessKeys)
    .set({ scopes: JSON.stringify(['posts:read']) })
    .where(eq(personalAccessKeys.id, keyId))
  expect(
    await fixture.db.get(
      sql`SELECT CASE WHEN ${checkpoint.liveGuard} THEN 1 ELSE 0 END AS allowed`,
    ),
  ).toEqual({ allowed: 0 })
  await fixture.db
    .update(personalAccessKeys)
    .set({ scopes: JSON.stringify(['posts:update']), revokedAt: new Date() })
    .where(eq(personalAccessKeys.id, keyId))
  expect(
    await Effect.runPromise(authority.checkpoint(['drafts:write']).pipe(Effect.result)),
  ).toHaveProperty('_tag', 'Failure')
}, 10_000)
