import { OtelTracer, Resource } from '@effect/opentelemetry'
import { IssueKeyInput, KeyMetadata } from '@gbfm/api/personal-access-keys'
import { UserId } from '@gbfm/core/identity'
import type { KeyScope } from '@gbfm/core/personal-access-keys'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { hashPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'
import { Clock, Crypto, Effect, Layer, Logger, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { account, session, user } from '@/db/auth.schema'
import { readEntityLabels } from '@/db/labels'
import { DatabaseLayer, makeDatabaseClient } from '@/db/layer'
import { personalAccessKeys } from '@/db/personal-access-key.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { labelsTable } from '@/db/tags.schema'
import { uploadAssetsTable } from '@/db/upload-asset.schema'
import { CryptoLive } from '@/lib/crypto'
import { ConfigServiceLayer } from '@/services/config.service'
import { PersonalAccessKeys, PersonalAccessKeysLive } from '@/services/personal-access-keys'
import { withTestLayer } from '@/test/effect'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

const Issued = Schema.Struct({ key: KeyMetadata, secret: Schema.String })

const SignedIn = Schema.Struct({ token: Schema.String })

test('session lookup infrastructure failure is not reported as invalid credentials', async () => {
  await using f = await setup()
  const token = await f.login('session-outage', 'editor')
  await f.db.run(sql`DROP TABLE session`)
  const response = await f.request('GET', '/api/content/posts/manage', token)
  expect(response.status).toBe(500)
  expect((await response.text()).includes(token)).toBe(false)
})

test('a concurrent minute rollover is admitted, but a genuinely future stored window fails closed', async () => {
  await using f = await setup()
  const token = await f.login('rollover', 'editor')
  const issued = await f.issue(token, ['posts:read'])
  const minute = (Math.floor(Date.now() / 60000) + 1) * 60000
  let now = minute - 1

  const clock = Layer.succeed(Clock.Clock, {
    currentTimeMillis: Effect.sync(() => now),
    currentTimeMillisUnsafe: () => now,
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1000000n),
    currentTimeNanosUnsafe: () => BigInt(now) * 1000000n,
    monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1000000n),
    monotonicTimeNanosUnsafe: () => BigInt(now) * 1000000n,
    sleep: () => Effect.void,
  })

  const gate = gatedPostDatabase(
    f.database,
    'before',
    /^select .*personal_access_keys.*inner join/i,
  )

  const live = PersonalAccessKeysLive.pipe(
    Layer.provide(
      Layer.mergeAll(DatabaseLayer(gate.database), ConfigServiceLayer, CryptoLive, clock),
    ),
  )

  const authenticate = () =>
    Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const keys = yield* PersonalAccessKeys

          return yield* keys.authenticate(Redacted.make(issued.secret)).pipe(Effect.result)
        }),
        live,
      ),
    )

  const pending = authenticate()

  try {
    await gate.reached
    await f.db
      .update(personalAccessKeys)
      .set({ rateWindowStart: minute, rateRequestCount: 1 })
      .where(eq(personalAccessKeys.id, issued.key.id))
    now = minute + 1
    gate.release()
    expect(await pending).toHaveProperty('_tag', 'Success')
    expect((await f.db.select().from(personalAccessKeys))[0]?.rateRequestCount).toBe(2)
    await f.db
      .update(personalAccessKeys)
      .set({ rateWindowStart: minute + 60000 })
      .where(eq(personalAccessKeys.id, issued.key.id))
    expect(await authenticate()).toHaveProperty('failure._tag', 'KeyStoreUnavailable')
  } finally {
    gate.release()
    await pending
  }
})

test('transport rejects malformed, ambiguous and oversized PATs without anonymous fallback', async () => {
  await using f = await setup()

  for (const [token, path, status] of [
    ['gbfm_pat_bad!', '/api/content/posts/manage', 401],
    ['gbfm_pat_bad, Bearer other', '/api/content/posts/manage', 400],
    [`gbfm_pat_${'x'.repeat(1008)}`, '/api/content/posts/manage', 401],
    [`gbfm_pat_${'x'.repeat(1009)}`, '/api/content/posts/manage', 431],
    ['gbfm_pat_bad', '/health', 403],
    ['gbfm_pat_bad', '/unknown', 403],
  ] as const) {
    const response = await f.request('GET', path, token)
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  }
})

test('HTTP rate-limit header matches the remaining window in the error body', async () => {
  await using f = await setup()
  const token = await f.login('rate-header', 'editor')
  const issued = await f.issue(token, ['posts:read'])
  let response: Response | undefined

  // If the minute turns between seeding and HTTP dispatch, seed the new minute once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.db
      .update(personalAccessKeys)
      .set({ rateWindowStart: Math.floor(Date.now() / 60000) * 60000, rateRequestCount: 60 })
      .where(eq(personalAccessKeys.id, issued.key.id))
    response = await f.request('GET', '/api/content/posts/manage', issued.secret)

    if (response.status === 429) break
  }

  expect(response?.status).toBe(429)

  const body = Schema.decodeUnknownSync(Schema.Struct({ retryAfterSeconds: Schema.Number }))(
    await response?.json(),
  )

  expect(response?.headers.get('retry-after')).toBe(String(body.retryAfterSeconds))
  expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  expect(body.retryAfterSeconds).toBeLessThanOrEqual(60)
})

test('PAT slug validation and collision guards leave existing posts and labels intact', async () => {
  await using f = await setup()
  const token = await f.login('slug-owner', 'editor')
  const key = await f.issue(token, ['posts:create', 'posts:update'])
  const body = { type: 'micro', content: 'Original', draft: true }

  for (const slug of ['first', 'second'])
    expect(
      (await f.request('POST', '/api/content/post', key.secret, { ...body, slug })).status,
    ).toBe(200)

  const duplicate = await f.request('POST', '/api/content/post', key.secret, {
    ...body,
    slug: 'first',
  })

  expect(duplicate.status).toBe(409)
  expect(await duplicate.json()).toHaveProperty('_tag', 'Conflict')

  for (const slug of ['Bad-Slug', 'bad/slug', 'bad slug'])
    expect(
      (await f.request('PATCH', '/api/content/posts/first', key.secret, { slug })).status,
    ).toBe(422)
  expect(
    (
      await f.request('PATCH', '/api/content/posts/first', key.secret, {
        slug: 'second',
        tags: ['must-not-attach'],
      })
    ).status,
  ).toBe(409)
  expect(
    await f.db.select().from(labelsTable).where(eq(labelsTable.name, 'must-not-attach')),
  ).toHaveLength(0)
  expect(
    (await f.request('PATCH', '/api/content/posts/first', key.secret, { slug: 'renamed' })).status,
  ).toBe(200)
  expect((await f.db.select().from(postsTable)).map((p) => p.slug).sort()).toEqual([
    'renamed',
    'second',
  ])
})

test('guarded PAT writes advance future revisions and attach only owned Markdown uploads', async () => {
  await using f = await setup()
  const token = await f.login('asset-owner', 'editor')
  await f.login('asset-other', 'editor')
  const key = await f.issue(token, ['posts:create', 'posts:update'])
  expect(
    (
      await f.request('POST', '/api/content/post', key.secret, {
        slug: 'assets',
        type: 'micro',
        content: 'Original',
        draft: true,
      })
    ).status,
  ).toBe(200)
  const future = Date.now() + 3600000
  await f.db
    .update(postsTable)
    .set({ updatedAt: new Date(future) })
    .where(eq(postsTable.slug, 'assets'))
  await f.db.insert(uploadAssetsTable).values(
    ['owner', 'other'].map((suffix) => ({
      userId: `asset-${suffix}`,
      key: `${suffix}.png`,
      bucket: 'user-content-dev',
      assetType: 'image' as const,
      status: 'uploaded' as const,
      expiresAt: new Date(future),
    })),
  )
  expect(
    (
      await f.request('PATCH', '/api/content/posts/assets', key.secret, {
        content:
          '![own](https://cdn.goosebumps.fm/user-content/owner.png)\n![foreign](https://cdn.goosebumps.fm/user-content/other.png)',
      })
    ).status,
  ).toBe(200)
  const [post] = await f.db.select().from(postsTable).where(eq(postsTable.slug, 'assets'))
  expect(post?.updatedAt.getTime()).toBe(future + 1)
  const assets = await f.db.select().from(uploadAssetsTable)
  expect(assets.find((a) => a.userId === 'asset-owner')).toMatchObject({
    status: 'attached',
    attachedToId: post?.id,
  })
  expect(assets.find((a) => a.userId === 'asset-other')).toMatchObject({
    status: 'uploaded',
    attachedToId: null,
  })
})

test('D1 rejects invalid key expiry, rate bounds and mismatched window/count pairs', async () => {
  await using f = await setup()
  const token = await f.login('constraints', 'editor')
  await f.issue(token, ['posts:read'])
  const [row] = await f.db.select().from(personalAccessKeys)
  expect(row).toBeDefined()

  if (!row) return

  for (const changes of [
    { expiresAt: new Date(row.createdAt.getTime()) },
    { expiresAt: new Date(row.createdAt.getTime() + 7776000001) },
    { rateRequestCount: -1 },
    { rateRequestCount: 61 },
    { rateWindowStart: null, rateRequestCount: 1 },
    { rateWindowStart: 60000, rateRequestCount: 0 },
  ]) {
    const query = f.db
      .insert(personalAccessKeys)
      .values({
        ...row,
        id: crypto.randomUUID(),
        issuanceRequestId: crypto.randomUUID(),
        secretHash: crypto.randomUUID(),
        ...changes,
      })
      .toSQL()

    await expect(
      f.database
        .prepare(query.sql)
        .bind(...query.params)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/)
  }

  expect(await f.db.select().from(personalAccessKeys)).toHaveLength(1)
})

test('role changes during issuance report access denial rather than a key limit', async () => {
  await using f = await setup()
  await f.login('issuance-race', 'editor')

  const cryptoLive = Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
      digest: (algorithm, data) =>
        Effect.promise(async () => {
          // Real persistence change at the crypto seam, after the owner read and before INSERT.
          await f.db.update(user).set({ role: 'user' }).where(eq(user.id, 'issuance-race'))

          return new Uint8Array(await crypto.subtle.digest(algorithm, data))
        }),
    }),
  )

  const live = PersonalAccessKeysLive.pipe(
    Layer.provide(Layer.mergeAll(DatabaseLayer(f.database), ConfigServiceLayer, cryptoLive)),
  )

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const keys = yield* PersonalAccessKeys

        return yield* keys
          .issue(
            yield* Schema.decodeUnknownEffect(UserId)('issuance-race'),
            yield* Schema.decodeUnknownEffect(IssueKeyInput)({
              requestId: crypto.randomUUID(),
              name: 'Race',
              scopes: ['posts:read'],
            }),
          )
          .pipe(Effect.result)
      }),
      live,
    ),
  )

  expect(result).toHaveProperty('failure._tag', 'KeyAccessDenied')
  expect(await f.db.select().from(personalAccessKeys)).toHaveLength(0)
})

test('key lifecycle logs and exported spans never contain credentials or their hashes', async () => {
  await using f = await setup()
  await f.login('telemetry-owner', 'editor')
  const logs: Array<unknown> = []
  const exporter = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  provider.register()

  const live = PersonalAccessKeysLive.pipe(
    Layer.provide(Layer.mergeAll(DatabaseLayer(f.database), ConfigServiceLayer, CryptoLive)),
  )

  try {
    const result = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const keys = yield* PersonalAccessKeys
          const owner = yield* Schema.decodeUnknownEffect(UserId)('telemetry-owner')

          const issued = yield* keys.issue(
            owner,
            yield* Schema.decodeUnknownEffect(IssueKeyInput)({
              requestId: crypto.randomUUID(),
              name: 'Telemetry fixture',
              scopes: ['posts:read'],
            }),
          )

          yield* keys.authenticate(issued.secret)
          yield* keys.list(owner, 20, 0)
          yield* keys.revoke(owner, issued.key.id)
          yield* keys.authenticate(issued.secret).pipe(Effect.ignore)

          return issued
        }),
        Layer.mergeAll(
          live,
          Logger.layer([Logger.make(({ message }) => logs.push(message))]),
          OtelTracer.layerGlobal.pipe(
            Layer.provide(Resource.layer({ serviceName: 'key-security-test' })),
          ),
        ),
      ),
    )

    await provider.forceFlush()
    expect(logs.flat().join(' ')).toContain('key.issued')
    const spans = exporter.getFinishedSpans()
    expect(spans.some((span) => span.name === 'keys.issue')).toBe(true)

    const captured = JSON.stringify({
      logs,
      spans: spans.map((s) => ({
        name: s.name,
        attributes: s.attributes,
        events: s.events,
        status: s.status,
      })),
    })

    const [row] = await f.db.select().from(personalAccessKeys)

    for (const sensitive of [
      Redacted.value(result.secret),
      `Bearer ${Redacted.value(result.secret)}`,
      row?.secretHash ?? 'missing-hash',
    ])
      expect(captured.includes(sensitive)).toBe(false)
  } finally {
    await provider.shutdown()
  }
})

test('session and key actors reject malformed persisted identity values before authorizing reads', async () => {
  await using fixture = await setup()
  const token = await fixture.login('identity-owner', 'editor')
  const issued = await fixture.issue(token, ['posts:read'])
  const path = '/api/content/posts/manage'

  for (const credential of [token, issued.secret]) {
    expect((await fixture.request('GET', path, credential)).status).toBe(200)
  }

  for (const malformed of [{ role: 'superuser' }, { email: 'not-an-email' }]) {
    await fixture.db.update(user).set(malformed).where(eq(user.id, 'identity-owner'))

    for (const credential of [token, issued.secret]) {
      const response = await fixture.request('GET', path, credential)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        _tag: credential === token ? 'Unauthorized' : 'InvalidKeyCredential',
      })
    }

    await fixture.db
      .update(user)
      .set({ role: 'editor', email: 'identity-owner@example.test' })
      .where(eq(user.id, 'identity-owner'))
  }

  for (const credential of [token, issued.secret]) {
    expect((await fixture.request('GET', path, credential)).status).toBe(200)
  }
})

test('a failed PAT post write rolls back tags, new label definitions and attachment state', async () => {
  await using fixture = await setup()
  const token = await fixture.login('rollback-owner', 'editor')
  const issued = await fixture.issue(token, ['posts:update'])
  expect(
    (
      await fixture.request('POST', '/api/content/post', token, {
        slug: 'rollback-post',
        type: 'micro',
        content: 'Original',
        draft: true,
        tags: ['original'],
      })
    ).status,
  ).toBe(200)
  await fixture.db.insert(uploadAssetsTable).values({
    userId: 'rollback-owner',
    key: 'rollback-image.jpg',
    bucket: 'user-content-dev',
    assetType: 'image',
    status: 'uploaded',
    expiresAt: new Date(Date.now() + 3600000),
  })

  const [original] = await fixture.db
    .select()
    .from(postsTable)
    .where(eq(postsTable.slug, 'rollback-post'))

  await fixture.db.run(
    sql`CREATE TRIGGER reject_pat_update BEFORE UPDATE ON posts BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`,
  )
  expect(
    (
      await fixture.request('PATCH', '/api/content/posts/rollback-post', issued.secret, {
        content: 'Changed',
        tags: ['new-tag'],
        thumbnailUrl: 'https://cdn.goosebumps.fm/user-content/rollback-image.jpg',
      })
    ).status,
  ).toBe(500)
  expect(
    (await fixture.db.select().from(postsTable).where(eq(postsTable.slug, 'rollback-post')))[0],
  ).toEqual(original)
  expect((await readEntityLabels(fixture.db, 'post', original?.id ?? 'missing')).tags).toEqual([
    'original',
  ])
  expect(
    await fixture.db.select().from(labelsTable).where(eq(labelsTable.name, 'new-tag')),
  ).toHaveLength(0)
  expect((await fixture.db.select().from(uploadAssetsTable))[0]).toMatchObject({
    status: 'uploaded',
    attachedToId: null,
    attachedToTable: null,
  })
  await fixture.db.run(sql`DROP TRIGGER reject_pat_update`)
  expect(
    (
      await fixture.request('PATCH', '/api/content/posts/rollback-post', issued.secret, {
        tags: [],
      })
    ).status,
  ).toBe(200)
  expect((await readEntityLabels(fixture.db, 'post', original?.id ?? 'missing')).tags).toBeNull()
})

test.each([
  { phase: 'before', change: 'publish' },
  { phase: 'after', change: 'publish' },
  { phase: 'before', change: 'ownership' },
  { phase: 'after', change: 'ownership' },
] as const)(
  'PAT tags and attachments stay atomic when $change wins $phase the batch',
  async ({ phase, change }) => {
    await using fixture = await setup()
    const token = await fixture.login('race-owner', 'editor')
    await fixture.login('race-other', 'editor')
    const issued = await fixture.issue(token, ['posts:update'])
    expect(
      (
        await fixture.request('POST', '/api/content/post', token, {
          slug: 'race-post',
          type: 'micro',
          content: 'Original',
          draft: true,
          tags: ['original'],
        })
      ).status,
    ).toBe(200)
    await fixture.db.insert(uploadAssetsTable).values({
      userId: 'race-owner',
      key: 'race-image.jpg',
      bucket: 'user-content-dev',
      assetType: 'image',
      status: 'uploaded',
      expiresAt: new Date(Date.now() + 3600000),
    })
    const gate = gatedPostDatabase(fixture.database, phase)
    const keyWeb = createTestWebHandler(gate.database)

    const pending = keyWeb.handler(
      new Request('http://localhost/api/content/posts/race-post', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${issued.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          tags: ['pat-tag', 'pat-tag', 'second-tag'],
          thumbnailUrl: 'https://cdn.goosebumps.fm/user-content/race-image.jpg',
        }),
      }),
    )

    try {
      await Promise.race([
        gate.reached,
        pending.then(() => {
          throw new Error('PAT finished without reaching the D1 write gate')
        }),
      ])

      const [post] = await fixture.db
        .select()
        .from(postsTable)
        .where(eq(postsTable.slug, 'race-post'))

      expect(post).toBeDefined()
      const id = post?.id ?? 'missing'
      expect((await readEntityLabels(fixture.db, 'post', id)).tags).toEqual(
        phase === 'after' ? ['pat-tag', 'second-tag'] : ['original'],
      )
      expect((await fixture.db.select().from(uploadAssetsTable))[0]?.status).toBe(
        phase === 'after' ? 'attached' : 'uploaded',
      )

      const sessionChange =
        change === 'publish'
          ? {
              draft: false,
              tags: ['session-tag'],
              thumbnailUrl: 'https://example.test/session.jpg',
            }
          : {
              creatorIds: ['race-other'],
              tags: ['session-tag'],
              thumbnailUrl: 'https://example.test/session.jpg',
            }

      const sessionResponse = await fixture.web.handler(
        new Request('http://localhost/api/content/posts/race-post', {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(sessionChange),
        }),
      )

      expect(sessionResponse.status).toBe(200)
      gate.release()
      expect((await pending).status).toBe(phase === 'after' ? 200 : 409)
      expect((await readEntityLabels(fixture.db, 'post', id)).tags).toEqual(['session-tag'])
      const [final] = await fixture.db.select().from(postsTable).where(eq(postsTable.id, id))
      expect(final?.thumbnailUrl).toBe('https://example.test/session.jpg')
      expect(final?.draft).toBe(change !== 'publish')
      expect(
        (await fixture.db.select().from(postCreators).where(eq(postCreators.postId, id))).map(
          (row) => row.creatorId,
        ),
      ).toEqual([change === 'ownership' ? 'race-other' : 'race-owner'])
      expect((await fixture.db.select().from(uploadAssetsTable))[0]?.status).toBe(
        phase === 'after' ? 'attached' : 'uploaded',
      )
    } finally {
      gate.release()
      await pending
      await keyWeb.dispose()
    }
  },
)

test('atomic D1 rate claims allow sixty concurrent uses in a fixed window', async () => {
  await using fixture = await setup()
  const token = await fixture.login('rate', 'editor')
  const issued = await fixture.issue(token, ['posts:read'])
  const now = Date.now()

  const clock = Layer.succeed(Clock.Clock, {
    currentTimeMillis: Effect.succeed(now),
    currentTimeMillisUnsafe: () => now,
    currentTimeNanos: Effect.succeed(BigInt(now) * 1000000n),
    currentTimeNanosUnsafe: () => BigInt(now) * 1000000n,
    monotonicTimeNanos: Effect.succeed(BigInt(now) * 1000000n),
    monotonicTimeNanosUnsafe: () => BigInt(now) * 1000000n,
    sleep: () => Effect.void,
  })

  const live = PersonalAccessKeysLive.pipe(
    Layer.provide(
      Layer.mergeAll(DatabaseLayer(fixture.database), ConfigServiceLayer, CryptoLive, clock),
    ),
  )

  const results = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const keys = yield* PersonalAccessKeys

        return yield* Effect.forEach(
          Array.from({ length: 70 }),
          () =>
            keys.authenticate(Redacted.make(issued.secret)).pipe(
              Effect.as('allowed'),
              Effect.catchTag('KeyRateLimited', () => Effect.succeed('limited')),
            ),
          { concurrency: 'unbounded' },
        )
      }),
      live,
    ),
  )

  expect(results.filter((result) => result === 'allowed')).toHaveLength(60)
  expect(results.filter((result) => result === 'limited')).toHaveLength(10)
  expect((await fixture.db.select().from(personalAccessKeys))[0]?.rateRequestCount).toBe(60)
})

test('concurrent issuance enforces the active-key cap and retry identity in D1', async () => {
  await using fixture = await setup()
  const token = await fixture.login('concurrent', 'editor')

  const responses = await Promise.all(
    Array.from({ length: 14 }, () =>
      fixture.request('POST', '/api/user/api-keys', token, {
        requestId: crypto.randomUUID(),
        name: 'Concurrent fixture',
        scopes: ['posts:read'],
      }),
    ),
  )

  expect(responses.filter((response) => response.status === 201)).toHaveLength(10)
  expect(responses.filter((response) => response.status === 409)).toHaveLength(4)
  expect(await fixture.db.select().from(personalAccessKeys)).toHaveLength(10)
})

test('expiry, environment mismatch and malformed stored key metadata fail closed', async () => {
  await using fixture = await setup()
  const token = await fixture.login('lifecycle', 'editor')
  const issued = await fixture.issue(token, ['posts:read'])
  const path = '/api/content/posts/manage'
  expect(
    (await fixture.request('GET', path, issued.secret.replace('_dev_', '_prod_'))).status,
  ).toBe(401)

  for (const malformed of [
    { scopes: '["unknown:scope"]' },
    { id: 'not-a-key-uuid' },
    { name: 'Hidden\ncontrol character' },
  ]) {
    await fixture.db
      .update(personalAccessKeys)
      .set(malformed)
      .where(eq(personalAccessKeys.ownerUserId, 'lifecycle'))

    for (const response of [
      await fixture.request('GET', path, issued.secret),
      await fixture.request('GET', '/api/user/api-keys', token),
    ]) {
      expect(response.status).toBe(503)
      expect(await response.json()).toHaveProperty('_tag', 'KeyStoreUnavailable')
    }

    await fixture.db
      .update(personalAccessKeys)
      .set({ id: issued.key.id, name: issued.key.name, scopes: '["posts:read"]' })
      .where(eq(personalAccessKeys.ownerUserId, 'lifecycle'))
  }

  expect((await fixture.request('GET', path, issued.secret)).status).toBe(200)
  expect((await fixture.request('GET', '/api/user/api-keys', token)).status).toBe(200)
  expect((await fixture.request('DELETE', '/api/user/api-keys/not-a-uuid', token)).status).toBe(400)
  expect(
    (await fixture.request('DELETE', `/api/user/api-keys/${crypto.randomUUID()}`, token)).status,
  ).toBe(404)
  const now = Date.now()
  await fixture.db
    .update(personalAccessKeys)
    .set({
      scopes: '["posts:read"]',
      createdAt: new Date(now - 7200000),
      expiresAt: new Date(now - 3600000),
    })
    .where(eq(personalAccessKeys.id, issued.key.id))
  expect((await fixture.request('GET', path, issued.secret)).status).toBe(401)
})

test('issuance rejects excess fields, unsupported scopes, stale and impersonated sessions', async () => {
  await using fixture = await setup()
  const token = await fixture.login('bootstrap', 'editor')
  const input = { requestId: crypto.randomUUID(), name: 'Fixture', scopes: ['posts:read'] }
  expect(
    (await fixture.request('POST', '/api/user/api-keys', token, { ...input, ownerUserId: 'other' }))
      .status,
  ).toBe(422)
  expect(
    (
      await fixture.request('POST', '/api/user/api-keys', token, {
        ...input,
        scopes: ['images:upload'],
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await fixture.request('POST', '/api/user/api-keys', token, input, {
        origin: 'https://untrusted.example',
      })
    ).status,
  ).toBe(403)
  await fixture.db
    .update(session)
    .set({ impersonatedBy: 'another-user' })
    .where(eq(session.userId, 'bootstrap'))
  expect((await fixture.request('POST', '/api/user/api-keys', token, input)).status).toBe(403)
  await fixture.db
    .update(session)
    .set({ impersonatedBy: null, createdAt: new Date(Date.now() - 660000) })
    .where(eq(session.userId, 'bootstrap'))
  expect((await fixture.request('POST', '/api/user/api-keys', token, input)).status).toBe(403)
  expect(await fixture.db.select().from(personalAccessKeys)).toHaveLength(0)
})

const setup = async () => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  const web = createTestWebHandler(resource.database)

  const request = (
    method: string,
    path: string,
    token?: string,
    body?: Record<string, string | number | boolean | ReadonlyArray<string>>,
    extra?: Record<string, string>,
  ) => {
    const headers = new Headers(extra)

    if (token) headers.set('authorization', `Bearer ${token}`)

    if (body !== undefined) headers.set('content-type', 'application/json')

    return web.handler(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : null,
      }),
    )
  }

  const login = async (id: string, role: string) => {
    const password = 'disposable-local-password-123'
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, role })
    await db.insert(account).values({
      id: `${id}-account`,
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: await hashPassword(password),
    })

    const response = await request('POST', '/auth/sign-in/email', undefined, {
      email: `${id}@example.test`,
      password,
    })

    expect(response.status).toBe(200)

    return Schema.decodeUnknownSync(SignedIn)(await response.json()).token
  }

  const issue = async (
    token: string,
    scopes: ReadonlyArray<KeyScope>,
    requestId = crypto.randomUUID(),
  ) => {
    const response = await request('POST', '/api/user/api-keys', token, {
      requestId,
      name: 'Local fixture',
      scopes,
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')

    return Schema.decodeUnknownSync(Issued)(await response.json())
  }

  return {
    db,
    database: resource.database,
    web,
    request,
    login,
    issue,
    async [Symbol.asyncDispose]() {
      await web.dispose()
      await resource[Symbol.asyncDispose]()
    },
  }
}

test('real session bootstrap issues hash-only credentials and revocation stops independent requests', async () => {
  await using fixture = await setup()
  const { db, request, login, issue } = fixture
  const token = await login('editor', 'editor')
  const requestId = crypto.randomUUID()

  const issued = await issue(
    token,
    ['posts:read', 'posts:create', 'posts:update', 'posts:publish'],
    requestId,
  )

  const [stored] = await db.select().from(personalAccessKeys)
  expect(stored?.secretHash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(stored)).not.toContain(issued.secret)
  const list = await request('GET', '/api/user/api-keys', token)
  const listText = await list.text()
  expect(listText).toContain(issued.key.id)
  expect(listText).not.toContain(issued.secret)
  expect(listText).not.toContain(stored?.secretHash)
  expect(
    (
      await request('POST', '/api/user/api-keys', token, {
        requestId,
        name: 'Retry',
        scopes: ['posts:create'],
      })
    ).status,
  ).toBe(409)

  const created = await request('POST', '/api/content/post', issued.secret, {
    slug: 'key-published',
    type: 'micro',
    content: 'Local published fixture',
    draft: false,
  })

  expect(created.status).toBe(200)
  expect(created.headers.get('cache-control')).toBe('private, no-store')
  const [post] = await db.select().from(postsTable).where(eq(postsTable.slug, 'key-published'))
  expect(post?.draft).toBe(false)

  const creators = await db
    .select()
    .from(postCreators)
    .where(eq(postCreators.postId, post?.id ?? 'missing'))

  expect(creators.map((creator) => creator.creatorId)).toEqual(['editor'])
  expect(
    (await request('GET', '/api/content/posts/key-published/edit', issued.secret)).status,
  ).toBe(200)
  expect(
    (
      await request('PATCH', '/api/content/posts/key-published', issued.secret, {
        content: 'Edited fixture',
      })
    ).status,
  ).toBe(200)
  expect((await request('POST', '/auth/sign-out', token, {})).status).toBe(200)
  expect((await request('GET', '/api/user/api-keys', token)).status).toBe(401)
  expect(
    (await request('GET', '/api/content/posts/key-published/edit', issued.secret)).status,
  ).toBe(200)

  const fresh = await request('POST', '/auth/sign-in/email', undefined, {
    email: 'editor@example.test',
    password: 'disposable-local-password-123',
  })

  const freshToken = Schema.decodeUnknownSync(SignedIn)(await fresh.json()).token
  expect((await request('DELETE', `/api/user/api-keys/${issued.key.id}`, freshToken)).status).toBe(
    204,
  )
  const [revoked] = await db.select().from(personalAccessKeys)
  expect((await request('DELETE', `/api/user/api-keys/${issued.key.id}`, freshToken)).status).toBe(
    204,
  )
  expect((await db.select().from(personalAccessKeys))[0]?.revokedAt).toEqual(revoked?.revokedAt)
  expect(
    (await request('GET', '/api/content/posts/key-published/edit', issued.secret)).status,
  ).toBe(401)
})

test('keys cannot publish through defaults, rewrite creators, or bypass current role and ownership', async () => {
  await using fixture = await setup()
  const { db, request, login, issue } = fixture
  const creatorSession = await login('creator', 'creator')
  const editorSession = await login('editor', 'editor')
  const adminSession = await login('admin', 'admin')
  const creator = await issue(creatorSession, ['posts:create', 'posts:update', 'posts:read'])
  const editor = await issue(editorSession, ['posts:create', 'posts:update', 'posts:read'])

  const admin = await issue(adminSession, [
    'posts:create',
    'posts:update',
    'posts:read',
    'posts:publish',
  ])

  const body = { type: 'micro', content: 'Private fixture', slug: 'private-fixture', draft: true }
  expect(
    (await request('POST', '/api/content/post', creator.secret, { ...body, draft: false })).status,
  ).toBe(403)
  expect(
    (
      await request('POST', '/api/content/post', creator.secret, {
        type: 'micro',
        content: 'Default-public fixture',
        slug: 'default-public',
      })
    ).status,
  ).toBe(403)
  expect(
    (await request('POST', '/api/content/post', editor.secret, { ...body, draft: false })).status,
  ).toBe(403)
  expect(
    (
      await request('POST', '/api/content/post', creator.secret, {
        ...body,
        creatorIds: ['editor'],
      })
    ).status,
  ).toBe(403)
  expect((await request('POST', '/api/content/post', creator.secret, body)).status).toBe(200)
  expect((await request('POST', '/api/content/post', creator.secret, body)).status).toBe(409)
  expect(
    (
      await request('PATCH', '/api/content/posts/private-fixture', creator.secret, {
        creatorIds: [],
      })
    ).status,
  ).toBe(403)
  expect(
    (await request('PATCH', '/api/content/posts/private-fixture', creator.secret, { draft: false }))
      .status,
  ).toBe(403)
  expect(
    (await request('GET', '/api/content/posts/private-fixture/edit', admin.secret)).status,
  ).toBe(404)
  expect(
    (
      await request('PATCH', '/api/content/posts/private-fixture', admin.secret, {
        content: 'Foreign write',
      })
    ).status,
  ).toBe(404)
  const list = await request('GET', '/api/content/posts/manage', admin.secret)
  expect(await list.json()).toMatchObject({ data: [], pagination: { total: 0 } })
  await db.update(user).set({ role: 'user' }).where(eq(user.id, 'creator'))
  expect(
    (
      await request('PATCH', '/api/content/posts/private-fixture', creator.secret, {
        content: 'Demoted',
      })
    ).status,
  ).toBe(403)
  await db.update(user).set({ role: 'creator', banned: true }).where(eq(user.id, 'creator'))
  expect((await request('GET', '/api/content/posts/manage', creator.secret)).status).toBe(401)
  expect((await db.select().from(postsTable)).map((post) => post.slug)).toEqual(['private-fixture'])
})

test('key attempts cannot fall through to sessions, raw auth, optional identity, or excluded APIs', async () => {
  await using fixture = await setup()
  const { db, request, login, issue } = fixture
  const token = await login('editor', 'editor')
  const issued = await issue(token, ['posts:read', 'posts:create'])

  for (const [method, path] of [
    ['GET', '/auth/get-session'],
    ['POST', '/auth/sign-out'],
    ['POST', '/auth/api-key/create'],
    ['GET', '/api/internal/whoami'],
    ['GET', '/api/user/api-keys'],
    ['POST', '/api/user/api-keys'],
    ['GET', '/api/admin/overview'],
    ['POST', '/api/content/posts/micro/anything/seen'],
    ['POST', '/api/content/posts/micro/anything/replies'],
    ['POST', '/api/music/resolve'],
    ['POST', '/api/upload/image/presign'],
    ['POST', '/api/upload/preview'],
    ['POST', '/api/content/posts/anything/resolve-music-entity'],
  ]) {
    const response = await request(method ?? '', path ?? '', issued.secret)
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  }

  expect(
    (
      await request('GET', '/api/content/posts/manage', issued.secret, undefined, {
        cookie: `better-auth.session_token=${token}`,
      })
    ).status,
  ).toBe(400)
  expect((await request('GET', '/api/content/posts/manage', 'gbfm_pat_broken')).status).toBe(401)
  expect(
    (
      await request('GET', '/api/content/posts/manage', undefined, undefined, {
        'x-api-key': issued.secret,
      })
    ).status,
  ).toBe(400)
  expect((await db.select().from(session)).length).toBe(1)
})
