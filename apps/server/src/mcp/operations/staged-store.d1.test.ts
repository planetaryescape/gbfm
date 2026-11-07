import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

import { mcpOperationArtwork } from '@/db/exports'
import { createMigratedD1Database } from '@/test/migrate-d1'

import {
  createArtworkStageStatement,
  createMcpArtworkStore,
  type ArtworkAssociationContext,
  type ArtworkDiagnostic,
  type ArtworkLease,
  type ArtworkRequest,
  type ArtworkStage,
  type ArtworkStageSeed,
} from './staged-store'
import { createMcpOperationStore, type ExecuteOperation } from './store'

const resource = await createMigratedD1Database()

const database = resource.database

const atomic = createMcpOperationStore(database)

const store = createMcpArtworkStore(database)

const now = 1_800_000_000_000

const key = {
  actorId: 'artwork-owner',
  clientId: 'artwork-client',
  resource: 'https://api.test',
  operation: 'import_music',
  requestId: 'a9fc2be4-f514-43f4-b2eb-d64cd65c3371',
}

const seed: ArtworkStageSeed = {
  disposition: 'created',
  entityType: 'album',
  entityId: 'album-id',
  catalogueRevision: 7,
  sourceIdentityKey: 'spotify:album:A123',
  artworkPolicy: 'required',
}

const normalizedInput = {
  source: seed.sourceIdentityKey,
  policy: seed.artworkPolicy,
  expectedRevision: 6,
}

const artifact = { sha256: 'a'.repeat(64), contentType: 'image/png', byteLength: 1234 } as const

const liveGuard = sql`EXISTS (SELECT 1 FROM user WHERE id = ${key.actorId} AND banned = 0) AND EXISTS (SELECT 1 FROM artwork_target WHERE id = ${seed.entityId} AND visible = 1)`

beforeAll(async () => {
  await database.batch([
    database.prepare(
      'CREATE TABLE artwork_target (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, marker TEXT, visible INTEGER NOT NULL, object_key TEXT)',
    ),
    database.prepare('CREATE TABLE artwork_coupled (id TEXT PRIMARY KEY, value TEXT NOT NULL)'),
  ])
})

afterAll(() => resource.dispose())

beforeEach(async () => {
  await database.batch([
    database.prepare('DELETE FROM mcp_operation_artwork'),
    database.prepare('DELETE FROM mcp_operations'),
    database.prepare('DELETE FROM artwork_coupled'),
    database.prepare('DELETE FROM artwork_target'),
    database.prepare('DELETE FROM oauth_client'),
    database.prepare('DELETE FROM user'),
    database
      .prepare('INSERT INTO user (id,name,email,created_at,updated_at,banned) VALUES (?,?,?,?,?,0)')
      .bind(key.actorId, 'Owner', 'artwork@example.test', now, now),
    database
      .prepare('INSERT INTO oauth_client (id,client_id,redirect_uris) VALUES (?,?,?)')
      .bind('artwork-oauth', key.clientId, '[]'),
    database.prepare('INSERT INTO artwork_target VALUES (?,6,NULL,1,NULL)').bind(seed.entityId),
  ])
})

const authorize = async (stage?: ArtworkStage) =>
  Boolean(
    await database
      .prepare('SELECT 1 FROM user WHERE id = ? AND banned = 0')
      .bind(key.actorId)
      .first(),
  ) &&
  (!stage ||
    Boolean(
      await database
        .prepare('SELECT 1 FROM artwork_target WHERE id = ? AND visible = 1')
        .bind(stage.original.entityId)
        .first(),
    ))

const request = (time = now): ArtworkRequest => ({
  key,
  normalizedInput,
  now: time,
  authorize,
  liveGuard,
})

const catalogue = (stageSeed = seed): ExecuteOperation => ({
  key,
  normalizedInput,
  now,
  authorize: () => authorize(),
  build: (ctx) => ({
    statements: [
      ctx.prepare(
        sql`UPDATE artwork_target SET revision = 7, marker = ${ctx.attemptId} WHERE id = ${seed.entityId} AND revision = 6 AND ${ctx.fence} AND (${liveGuard})`,
      ),
      createArtworkStageStatement(ctx, stageSeed),
    ],
    assertApplied: sql`EXISTS (SELECT 1 FROM artwork_target WHERE id = ${seed.entityId} AND revision = 7 AND marker = ${ctx.attemptId})`,
    outcome: {
      result: { disposition: 'created', entityId: seed.entityId },
      revision: 7,
      access: seed.entityId,
    },
  }),
})

const target = () =>
  database.prepare('SELECT revision, marker, object_key FROM artwork_target').first()

const associatePlan = (ctx: ArtworkAssociationContext) => ({
  statements: [
    ctx.prepare(sql`UPDATE artwork_target SET revision = revision + 1, marker = ${ctx.attemptId}, object_key = ${ctx.stage.artifact?.objectKey ?? null}
    WHERE id = ${seed.entityId} AND revision = ${ctx.stage.original.catalogueRevision} AND ${ctx.fence}`),
  ],
  assertApplied: sql`EXISTS (SELECT 1 FROM artwork_target WHERE id = ${seed.entityId} AND revision = 8 AND marker = ${ctx.attemptId} AND object_key = ${ctx.stage.artifact?.objectKey ?? null})`,
})

const pendingAssociation = async () => {
  expect((await atomic.execute(catalogue())).status).toBe('applied')
  const acquired = await store.acquire(request())

  if (acquired.status !== 'leased') throw new Error('Lease fixture failed')
  expect(
    (
      await store.transition({
        ...request(),
        lease: acquired.lease,
        transition: { phase: 'uploading', artifact },
      })
    ).status,
  ).toBe('ready')
  expect(
    (
      await store.transition({
        ...request(),
        lease: acquired.lease,
        transition: { phase: 'association_pending' },
      })
    ).status,
  ).toBe('ready')

  return acquired.lease
}

test('catalogue outcome and pending seed commit together; duplicate and changed input never recreate', async () => {
  const applied = await atomic.execute(catalogue())
  expect(applied.status).toBe('applied')
  expect(await store.read(request())).toMatchObject({
    status: 'ready',
    stage: {
      phase: 'pending',
      original: {
        disposition: 'created',
        entityType: 'album',
        entityId: 'album-id',
        catalogueRevision: 7,
      },
      sourceIdentityKey: seed.sourceIdentityKey,
      artworkPolicy: 'required',
      lease: null,
    },
  })
  expect((await atomic.execute(catalogue())).status).toBe('replayed')
  expect(
    await store.read({
      ...request(),
      normalizedInput: { ...normalizedInput, expectedRevision: 5 },
    }),
  ).toEqual({ status: 'conflict' })
  expect(await target()).toMatchObject({ revision: 7 })
})

test('zero catalogue CAS aborts receipt and stage together; raw and signed source URLs cannot persist', async () => {
  await database.prepare('UPDATE artwork_target SET revision = 8').run()
  expect(await atomic.execute(catalogue())).toEqual({ status: 'conflict' })
  expect(await database.prepare('SELECT count(*) AS n FROM mcp_operation_artwork').first()).toEqual(
    { n: 0 },
  )
  expect(await database.prepare('SELECT count(*) AS n FROM mcp_operations').first()).toEqual({
    n: 0,
  })

  for (const sourceIdentityKey of [
    'https://provider.test/cover?token=PRIVATE',
    'spotify:album:bad/key',
    'url:sha256:abc',
  ]) {
    expect(await atomic.execute(catalogue({ ...seed, sourceIdentityKey }))).toEqual({
      status: 'invalid_input',
    })
  }
})

test('concurrent acquisition, renewal and exact-expiry takeover enforce fresh physical generation', async () => {
  await atomic.execute(catalogue())
  const results = await Promise.all([store.acquire(request()), store.acquire(request())])
  expect(results.map((entry) => entry.status).sort()).toEqual(['busy', 'leased'])
  const first = results.find((entry) => entry.status === 'leased')

  if (first?.status !== 'leased') throw new Error('Missing winner')
  expect(first.lease.generation).toBe(1)
  expect(await store.renew({ ...request(now + 20000), lease: first.lease })).toMatchObject({
    status: 'ready',
    stage: { lease: { expiresAt: now + 80000 } },
  })
  expect(await store.acquire(request(now + 79999))).toEqual({ status: 'busy' })
  const takeover = await store.acquire(request(now + 80000))

  if (takeover.status !== 'leased') throw new Error('Missing takeover')
  expect(takeover.lease.generation).toBe(2)
  expect(takeover.lease.attemptId).not.toBe(first.lease.attemptId)
  expect(await store.renew({ ...request(now + 80000), lease: first.lease })).toEqual({
    status: 'conflict',
  })
  expect(
    await store.transition({
      ...request(now + 80000),
      lease: first.lease,
      transition: { phase: 'uploading', artifact },
    }),
  ).toEqual({ status: 'conflict' })
  expect(await store.renew({ ...request(now + 140000), lease: takeover.lease })).toEqual({
    status: 'conflict',
  })
})

test('descriptor is frozen across takeover, phase cannot regress, ambiguous work stays recoverable', async () => {
  const lease = await pendingAssociation()
  const takeover = await store.acquire(request(now + 60000))

  if (takeover.status !== 'leased') throw new Error('Missing takeover')
  expect(takeover.stage.artifact).toEqual({
    ...artifact,
    objectKey: `music/album/album-id/imports/${takeover.stage.operationId}/${artifact.sha256}/cover`,
  })
  expect(
    await store.transition({
      ...request(now + 60000),
      lease: takeover.lease,
      transition: { phase: 'uploading', artifact: { ...artifact, sha256: 'b'.repeat(64) } },
    }),
  ).toEqual({ status: 'conflict' })
  expect(
    await store.transition({
      ...request(now + 60000),
      lease,
      transition: { phase: 'failed', failureCode: 'stale_revision' },
    }),
  ).toEqual({ status: 'conflict' })
  expect(await store.read(request(now + 60000))).toMatchObject({
    status: 'ready',
    stage: { phase: 'association_pending', original: { catalogueRevision: 7 } },
  })
})

test('association CAS plus final phase are atomic, replay preserves original catalogue revision', async () => {
  const lease = await pendingAssociation()
  expect(await store.associate({ ...request(), lease, build: associatePlan })).toMatchObject({
    status: 'ready',
    stage: {
      phase: 'delivered',
      associatedRevision: 8,
      original: { catalogueRevision: 7 },
      lease: null,
    },
  })
  expect(await target()).toMatchObject({ revision: 8 })
  expect(
    await store.associate({
      ...request(),
      lease,
      build: () => {
        throw new Error('Do not reapply')
      },
    }),
  ).toMatchObject({ status: 'ready', stage: { phase: 'delivered' } })
  expect(await atomic.execute(catalogue())).toMatchObject({
    status: 'replayed',
    outcome: { revision: 7 },
  })
})

test('concurrent association of one durable phase advances entity exactly once', async () => {
  const lease = await pendingAssociation()

  const results = await Promise.all([
    store.associate({ ...request(), lease, build: associatePlan }),
    store.associate({ ...request(), lease, build: associatePlan }),
  ])

  expect(results).toEqual([
    expect.objectContaining({ status: 'ready' }),
    expect.objectContaining({ status: 'ready' }),
  ])
  expect(await target()).toMatchObject({ revision: 8 })
})

test('real batch failure leaves association recoverable and reports only safe diagnostics', async () => {
  const lease = await pendingAssociation()
  await database
    .prepare(
      "CREATE TRIGGER artwork_test_failure BEFORE UPDATE ON mcp_operation_artwork WHEN NEW.phase = 'delivered' BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQL_PROVIDER_TOKEN'); END",
    )
    .run()
  const events: Array<ArtworkDiagnostic> = []
  const observed = createMcpArtworkStore(database, (event) => events.push(event))

  try {
    expect(await observed.associate({ ...request(), lease, build: associatePlan })).toEqual({
      status: 'unavailable',
    })
    expect(await target()).toMatchObject({ revision: 7, object_key: null })
    expect(await store.read(request())).toMatchObject({
      status: 'ready',
      stage: { phase: 'association_pending' },
    })
    expect(events).toEqual([
      { operation: 'artwork.write', dependency: 'database', code: 'storage_failed' },
    ])
  } finally {
    await database.prepare('DROP TRIGGER artwork_test_failure').run()
  }

  expect(await store.associate({ ...request(), lease, build: associatePlan })).toMatchObject({
    status: 'ready',
    stage: { phase: 'delivered' },
  })
})

test('zero association CAS and lost lease abort even deliberately unconditional coupled DML', async () => {
  const lease = await pendingAssociation()
  await database.prepare('UPDATE artwork_target SET revision = 9').run()

  const build = (ctx: ArtworkAssociationContext) => ({
    ...associatePlan(ctx),
    statements: [
      ...associatePlan(ctx).statements,
      ctx.prepare(sql`INSERT INTO artwork_coupled VALUES ('coupled','MUST_ROLL_BACK')`),
    ],
  })

  expect(await store.associate({ ...request(), lease, build })).toEqual({ status: 'conflict' })
  expect(await database.prepare('SELECT * FROM artwork_coupled').first()).toBeNull()
  expect(await target()).toMatchObject({ revision: 9, object_key: null })
  expect(await store.read(request())).toMatchObject({
    status: 'ready',
    stage: { phase: 'association_pending' },
  })
  const forgedLease: ArtworkLease = { attemptId: crypto.randomUUID(), generation: 1 }
  expect(
    await store.associate({
      ...request(),
      lease: forgedLease,
      build: (ctx) => ({
        statements: [
          ctx.prepare(sql`INSERT INTO artwork_coupled VALUES ('coupled','MUST_ROLL_BACK')`),
        ],
        assertApplied: sql`1`,
      }),
    }),
  ).toEqual({ status: 'conflict' })
  expect(await database.prepare('SELECT * FROM artwork_coupled').first()).toBeNull()
})

test('fresh authority and live SQL predicates gate reads and every idempotent transition', async () => {
  const lease = await pendingAssociation()
  expect(await store.read({ ...request(), authorize: async () => false })).toEqual({
    status: 'access_denied',
  })
  expect(await store.renew({ ...request(), lease, liveGuard: sql`0` })).toEqual({
    status: 'conflict',
  })
  expect(
    await store.transition({
      ...request(),
      lease,
      liveGuard: sql`0`,
      transition: { phase: 'association_pending' },
    }),
  ).toEqual({ status: 'conflict' })
  await database.prepare('UPDATE artwork_target SET visible = 0').run()
  expect(await store.read(request())).toEqual({ status: 'access_denied' })
})

test('24h receipt redaction leaves in-flight lease/descriptor recoverable; terminal cleanup retains asset safety evidence', async () => {
  await pendingAssociation()
  const later = now + 86400000
  expect(await atomic.pruneExpired(later)).toEqual({ status: 'pruned' })
  expect(await store.pruneTerminal(later)).toEqual({ status: 'pruned' })
  expect(await atomic.execute({ ...catalogue(), now: later })).toEqual({ status: 'expired' })
  const takeover = await store.acquire(request(later))

  if (takeover.status !== 'leased') throw new Error('In-flight work expired incorrectly')
  expect(
    await store.associate({ ...request(later), lease: takeover.lease, build: associatePlan }),
  ).toMatchObject({ status: 'ready', stage: { phase: 'delivered' } })
  expect(await store.read(request(later))).toEqual({ status: 'expired' })
  await store.pruneTerminal(later)
  expect(
    await database
      .prepare(
        'SELECT retired, disposition, actor_id, client_id, source_identity_key, lease_attempt_id, phase, entity_id, associated_revision, artifact FROM mcp_operation_artwork',
      )
      .first(),
  ).toMatchObject({
    retired: 1,
    disposition: null,
    actor_id: null,
    client_id: null,
    source_identity_key: null,
    lease_attempt_id: null,
    phase: 'delivered',
    entity_id: seed.entityId,
    associated_revision: 8,
    artifact: expect.stringContaining(artifact.sha256),
  })
  expect(await target()).toMatchObject({
    revision: 8,
    object_key: expect.stringContaining(artifact.sha256),
  })
})

test.each(['actor', 'client'] as const)(
  'deleting %s after receipt expiry retires recovery but preserves frozen artifact',
  async (kind) => {
    await pendingAssociation()
    await atomic.pruneExpired(now + 86400000)
    await database.prepare(kind === 'actor' ? 'DELETE FROM user' : 'DELETE FROM oauth_client').run()
    expect(
      await database
        .prepare(
          'SELECT retired, disposition, actor_id, client_id, source_identity_key, lease_attempt_id, phase, artifact FROM mcp_operation_artwork',
        )
        .first(),
    ).toMatchObject({
      retired: 1,
      disposition: null,
      actor_id: null,
      client_id: null,
      source_identity_key: null,
      lease_attempt_id: null,
      phase: 'failed',
      artifact: expect.stringContaining(artifact.sha256),
    })
    expect(await atomic.execute(catalogue())).toMatchObject({
      status: kind === 'actor' ? 'access_denied' : 'expired',
    })
  },
)

test('trusted non-OAuth client retirement redacts receipt and recoverable arguments atomically', async () => {
  const clientId = 'gbfm:pat:persisted-key'
  const input = catalogue()
  expect((await atomic.execute({ ...input, key: { ...key, clientId } })).status).toBe('applied')
  expect(await store.retireClient(clientId)).toEqual({ status: 'retired' })
  expect(
    await database
      .prepare('SELECT state, actor_id, client_id, outcome FROM mcp_operations')
      .first(),
  ).toEqual({ state: 'expired', actor_id: null, client_id: null, outcome: null })
  expect(
    await database
      .prepare(
        'SELECT retired, source_identity_key, lease_attempt_id, phase FROM mcp_operation_artwork',
      )
      .first(),
  ).toEqual({ retired: 1, source_identity_key: null, lease_attempt_id: null, phase: 'failed' })
  expect(await atomic.execute({ ...input, key: { ...key, clientId } })).toEqual({
    status: 'expired',
  })
})

test('definitive failure is terminal; safe diagnostics never expose private source/errors', async () => {
  const lease = await pendingAssociation()
  expect(
    await store.transition({
      ...request(),
      lease,
      transition: { phase: 'failed', failureCode: 'source_unavailable' },
    }),
  ).toMatchObject({
    status: 'ready',
    stage: { phase: 'failed', failureCode: 'source_unavailable', lease: null },
  })
  expect(await store.acquire(request())).toMatchObject({
    status: 'ready',
    stage: { phase: 'failed' },
  })
  expect(
    await store.transition({ ...request(), lease, transition: { phase: 'association_pending' } }),
  ).toEqual({ status: 'conflict' })
  const events: Array<ArtworkDiagnostic> = []
  const observed = createMcpArtworkStore(database, (event) => events.push(event))
  expect(
    await observed.read({
      ...request(),
      authorize: async () => {
        throw new Error('PRIVATE_TOKEN SQL source')
      },
    }),
  ).toEqual({ status: 'unavailable' })
  expect(events).toEqual([
    { operation: 'artwork.authorize', dependency: 'authorization', code: 'authorization_failed' },
  ])
})

test('exported schema matches migrated columns and receipt/actor foreign keys', async () => {
  const config = getTableConfig(mcpOperationArtwork)

  const columns = await database
    .prepare('PRAGMA table_info(mcp_operation_artwork)')
    .all<{ name: string }>()

  expect(columns.results.map((row) => row.name)).toEqual(
    config.columns.map((column) => column.name),
  )
  const foreign = await database.prepare('PRAGMA foreign_key_list(mcp_operation_artwork)').all()
  expect(foreign.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: 'mcp_operations', on_delete: 'RESTRICT' }),
      expect.objectContaining({ table: 'user', on_delete: 'SET NULL' }),
    ]),
  )

  const indexes = await database
    .prepare('PRAGMA index_list(mcp_operation_artwork)')
    .all<{ name: string }>()

  for (const index of config.indexes)
    expect(indexes.results.map((row) => row.name)).toContain(index.config.name)
})
