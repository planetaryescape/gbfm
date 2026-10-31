import { KeyMetadata } from '@gbfm/api/personal-access-keys'
import type { KeyScope } from '@gbfm/core/personal-access-keys'
import { hashPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'
import { Clock, Effect, Layer, Redacted, Schema } from 'effect'
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

test('expiry, environment mismatch and malformed stored scopes fail closed', async () => {
  await using fixture = await setup()
  const token = await fixture.login('lifecycle', 'editor')
  const issued = await fixture.issue(token, ['posts:read'])
  const path = '/api/content/posts/manage'
  expect(
    (await fixture.request('GET', path, issued.secret.replace('_dev_', '_prod_'))).status,
  ).toBe(401)
  await fixture.db
    .update(personalAccessKeys)
    .set({ scopes: '["unknown:scope"]' })
    .where(eq(personalAccessKeys.id, issued.key.id))
  expect((await fixture.request('GET', path, issued.secret)).status).toBe(503)
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
