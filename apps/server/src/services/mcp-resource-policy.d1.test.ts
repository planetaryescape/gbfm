import { Effect, Result, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { Database } from '@/db/layer'
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
} from '@/db/oauth.schema'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'

import {
  applyMcpPolicy,
  inspectMcpPolicy,
  planMcpPolicy,
  planMcpPolicyRollback,
  PolicyPlan,
  PolicyTarget,
} from './mcp-resource-policy'

describe('explicit MCP resource-policy rollout', () => {
  test('preview, activation, fresh consent, replay and rollback preserve other policy fields and existing grants', async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const old = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    await fixture.db.update(oauthResource).set({
      allowedScopes: JSON.stringify(['posts:read', 'offline_access']),
      metadata: JSON.stringify({ unrelated: { preserved: true } }),
      accessTokenTtl: 1234,
    })

    const target = PolicyTarget.make({
      environment: 'local',
      databaseId: 'disposable',
      resourceUrl: fixture.config.mcp.resourceUrl,
    })

    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, fixture.db)))

    const before = await fixture.db.select().from(oauthResource)
    const clients = await fixture.db.select().from(oauthClient)
    const grants = await fixture.db.select().from(oauthAccessToken)
    const refresh = await fixture.db.select().from(oauthRefreshToken)
    const consents = await fixture.db.select().from(oauthConsent)

    const plan = await run(
      planMcpPolicy({
        operationId: crypto.randomUUID(),
        target,
        actor: 'local-operator',
        reason: 'Enable editorial draft tools',
        approval: 'local-test-approval',
        expectedVersion: 1,
        scopes: ['posts:read', 'offline_access', 'drafts:write'],
      }),
    )

    expect(await fixture.db.select().from(oauthResource)).toEqual(before)
    const applied = await run(applyMcpPolicy(target, plan))
    expect(applied).toMatchObject({
      replayed: false,
      current: { version: 2, scopes: ['drafts:write', 'offline_access', 'posts:read'] },
    })
    const [row] = await fixture.db.select().from(oauthResource)
    expect(row).toMatchObject({ accessTokenTtl: 1234, disabled: false, name: before[0]?.name })
    expect(JSON.parse(row?.metadata ?? '{}')).toMatchObject({
      unrelated: { preserved: true },
      mcpPolicyHistory: [{ operationId: plan.operationId, approval: 'local-test-approval' }],
    })
    expect(await fixture.db.select().from(oauthClient)).toEqual(clients)
    expect(await fixture.db.select().from(oauthAccessToken)).toEqual(grants)
    expect(await fixture.db.select().from(oauthRefreshToken)).toEqual(refresh)
    expect(await fixture.db.select().from(oauthConsent)).toEqual(consents)
    expect(
      (await Effect.runPromise(fixture.service.verify(old.access_token))).scopes,
    ).not.toContain('drafts:write')

    const authorization = await fixture.request(
      `/oauth2/authorize?${fixture.authorizationQuery(clientId, 'posts:read drafts:write offline_access')}`,
      undefined,
      'owner',
    )

    expect(new URL(authorization.headers.get('location') ?? '').pathname).toBe(
      '/connect/gbfm/consent',
    )

    const write = Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(
          clientId,
          await fixture.authorize(clientId, 'owner', 'posts:read drafts:write offline_access'),
        )
      ).json(),
    )

    expect((await Effect.runPromise(fixture.service.verify(write.access_token))).scopes).toContain(
      'drafts:write',
    )
    const replay = await run(applyMcpPolicy(target, plan))
    expect(replay).toMatchObject({ replayed: true, current: { version: 2 } })

    const rollback = await run(
      planMcpPolicyRollback({
        operationId: crypto.randomUUID(),
        rollbackOperationId: plan.operationId,
        target,
        actor: 'local-operator',
        reason: 'Rollback local rollout',
        approval: 'local-rollback-approval',
        expectedVersion: 2,
      }),
    )

    expect((await run(inspectMcpPolicy(target))).version).toBe(2)
    await run(applyMcpPolicy(target, rollback))
    expect(await run(inspectMcpPolicy(target))).toMatchObject({
      version: 3,
      scopes: ['offline_access', 'posts:read'],
      history: [{ operationId: plan.operationId }, { operationId: rollback.operationId }],
    })
    expect(
      await Effect.runPromise(fixture.service.verify(write.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
    expect(
      (await Effect.runPromise(fixture.service.verify(old.access_token))).scopes,
    ).not.toContain('drafts:write')
    expect(await run(applyMcpPolicy(target, plan))).toMatchObject({
      replayed: true,
      current: { version: 3 },
    })
    expect((await run(inspectMcpPolicy(target))).version).toBe(3)
  }, 15_000)

  test('stale, raced, retargeted and changed retry plans cannot overwrite policy', async () => {
    await using fixture = await createEditorialOAuthFixture()
    await fixture.register()

    const target = PolicyTarget.make({
      environment: 'local',
      databaseId: 'disposable',
      resourceUrl: fixture.config.mcp.resourceUrl,
    })

    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, fixture.db)))

    const plan = await run(
      planMcpPolicy({
        operationId: crypto.randomUUID(),
        target,
        actor: 'operator',
        reason: 'Local content reads',
        approval: 'local-only',
        expectedVersion: 1,
        scopes: ['posts:read', 'offline_access', 'drafts:write', 'content:read'],
      }),
    )

    const competitor = PolicyPlan.make({
      ...plan,
      operationId: crypto.randomUUID(),
      after: { version: 2, scopes: ['posts:read', 'offline_access'] },
    })

    const outcomes = await Promise.all(
      [plan, competitor].map((p) => run(applyMcpPolicy(target, p).pipe(Effect.result))),
    )

    expect(outcomes.filter(Result.isSuccess)).toHaveLength(1)
    expect(outcomes.filter(Result.isFailure)).toHaveLength(1)
    expect((await run(inspectMcpPolicy(target))).history).toHaveLength(1)
    const winner = (await run(inspectMcpPolicy(target))).history[0]
    expect(winner).toBeDefined()

    if (!winner) throw new Error('Missing local policy receipt')

    const changed = PolicyPlan.make({
      ...winner,
      reason: 'Changed request with the same operation ID',
    })

    expect(await run(applyMcpPolicy(target, changed).pipe(Effect.result))).toMatchObject({
      failure: { reason: 'conflict' },
    })
    expect(
      await run(applyMcpPolicy({ ...target, databaseId: 'other' }, winner).pipe(Effect.result)),
    ).toMatchObject({ failure: { reason: 'target_mismatch' } })
    expect(
      await run(
        planMcpPolicy({ ...plan, scopes: plan.after.scopes, expectedVersion: 1 }).pipe(
          Effect.result,
        ),
      ),
    ).toMatchObject({ failure: { reason: 'conflict' } })
    expect(
      await run(
        planMcpPolicyRollback({
          ...winner,
          rollbackOperationId: plan.operationId,
          expectedVersion: 1,
        }).pipe(Effect.result),
      ),
    ).toMatchObject({ failure: { reason: 'conflict' } })
  })

  test('unrestricted, malformed, disabled and full-history policies fail closed', async () => {
    await using fixture = await createEditorialOAuthFixture()
    await fixture.register()

    const target = PolicyTarget.make({
      environment: 'local',
      databaseId: 'disposable',
      resourceUrl: fixture.config.mcp.resourceUrl,
    })

    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, fixture.db)))

    const plan = await run(
      planMcpPolicy({
        operationId: crypto.randomUUID(),
        target,
        actor: 'operator',
        reason: 'Test policy',
        approval: 'local-only',
        expectedVersion: 1,
        scopes: ['posts:read'],
      }),
    )

    for (const allowedScopes of [null, 'not-json', '["unknown:scope"]']) {
      await fixture.db.update(oauthResource).set({ allowedScopes })
      expect(await run(applyMcpPolicy(target, plan).pipe(Effect.result))).toMatchObject({
        failure: { reason: 'invalid_policy' },
      })
    }

    await fixture.db
      .update(oauthResource)
      .set({ allowedScopes: JSON.stringify(plan.before.scopes), disabled: true })
    expect(await run(applyMcpPolicy(target, plan).pipe(Effect.result))).toMatchObject({
      failure: { reason: 'disabled' },
    })
    await fixture.db.update(oauthResource).set({
      disabled: false,
      metadata: JSON.stringify({
        mcpPolicyHistory: Array.from({ length: 50 }, () => ({
          ...plan,
          operationId: crypto.randomUUID(),
          appliedAt: '2026-11-09T00:00:00.000Z',
        })),
      }),
    })
    expect(await run(applyMcpPolicy(target, plan).pipe(Effect.result))).toMatchObject({
      failure: { reason: 'history_full' },
    })
    expect((await run(inspectMcpPolicy(target))).version).toBe(1)
  })
})
