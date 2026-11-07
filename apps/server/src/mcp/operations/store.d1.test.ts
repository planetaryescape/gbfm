import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { Schema } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { mcpOperations } from '@/db/exports'
import { createMigratedD1Database } from '@/test/migrate-d1'

import {
  createMcpOperationStore,
  type ExecuteOperation,
  type OperationContext,
  type OperationDiagnostic,
  type OperationOutcome,
} from './store'

const resource = await createMigratedD1Database()

const database = resource.database

const store = createMcpOperationStore(database)

const now = 1_800_000_000_000

const actorId = 'operation-owner'

const clientId = 'operation-client'

const targetId = 'private-target'

const key = {
  actorId,
  clientId,
  resource: 'https://mcp.test/resource',
  operation: 'set_private_state',
  requestId: 'a9fc2be4-f514-43f4-b2eb-d64cd65c3371',
}

// This disposable domain deliberately has coupled rows. The public executor is
// exercised without mocking D1, the receipt store, auth reads or transactionality.
beforeAll(async () => {
  await database.batch([
    database.prepare(
      'CREATE TABLE operation_test_target (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, visible INTEGER NOT NULL, revision INTEGER NOT NULL, marker TEXT, value TEXT NOT NULL)',
    ),
    database.prepare(
      'CREATE TABLE operation_test_coupled (target_id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    ),
  ])
})

afterAll(() => resource.dispose())

beforeEach(async () => {
  await database.batch([
    database.prepare('DELETE FROM mcp_operations'),
    database.prepare('DELETE FROM operation_test_coupled'),
    database.prepare('DELETE FROM operation_test_target'),
    database.prepare('DELETE FROM oauth_client'),
    database.prepare('DELETE FROM user'),
    database
      .prepare(
        'INSERT INTO user (id,name,email,created_at,updated_at,role,banned) VALUES (?,?,?,?,?,?,?)',
      )
      .bind(actorId, 'Owner', 'operation@example.test', now, now, 'admin', 0),
    database
      .prepare('INSERT INTO oauth_client (id,client_id,redirect_uris,disabled) VALUES (?,?,?,0)')
      .bind('oauth-row', clientId, '[]'),
    database
      .prepare('INSERT INTO operation_test_target VALUES (?,?,1,0,NULL,?)')
      .bind(targetId, actorId, 'initial'),
  ])
})

const authorize = async (outcome?: OperationOutcome) => {
  const live = await database
    .prepare(`SELECT 1 FROM user u JOIN oauth_client c ON c.client_id = ?
    WHERE u.id = ? AND u.banned = 0 AND u.role = 'admin' AND coalesce(c.disabled,0) = 0`)
    .bind(clientId, actorId)
    .first()

  if (!live) return false

  if (!outcome) return true

  // A create caller learns its random target ID from the saved access evidence.
  if (!Schema.is(Schema.String)(outcome.access)) return false

  return Boolean(
    await database
      .prepare('SELECT 1 FROM operation_test_target WHERE id = ? AND owner_id = ? AND visible = 1')
      .bind(outcome.access, actorId)
      .first(),
  )
}

const command = (
  expectedRevision = 0,
  value = 'first',
  requestId = key.requestId,
): ExecuteOperation => ({
  key: { ...key, requestId },
  now,
  normalizedInput: { targetId, expectedRevision, value },
  authorize,
  build: ({ attemptId, fence, prepare }: OperationContext) => {
    const winner = sql`EXISTS (SELECT 1 FROM operation_test_target WHERE id = ${targetId} AND revision = ${expectedRevision + 1} AND marker = ${attemptId})`

    return {
      statements: [
        prepare(sql`UPDATE operation_test_target SET revision = revision + 1, marker = ${attemptId}, value = ${value}
          WHERE id = ${targetId} AND owner_id = ${actorId} AND visible = 1 AND revision = ${expectedRevision} AND ${fence}
          AND EXISTS (SELECT 1 FROM user WHERE id = ${actorId} AND banned = 0 AND role = 'admin')
          AND EXISTS (SELECT 1 FROM oauth_client WHERE client_id = ${clientId} AND coalesce(disabled,0) = 0)`),
        prepare(sql`INSERT INTO operation_test_coupled SELECT ${targetId}, ${value} WHERE ${fence} AND ${winner}
          ON CONFLICT(target_id) DO UPDATE SET value = excluded.value`),
      ],
      assertApplied: winner,
      outcome: { result: { targetId, value }, revision: expectedRevision + 1, access: targetId },
    }
  },
})

const target = () =>
  database
    .prepare('SELECT revision,value,marker FROM operation_test_target WHERE id = ?')
    .bind(targetId)
    .first()

const coupled = () =>
  database
    .prepare('SELECT value FROM operation_test_coupled WHERE target_id = ?')
    .bind(targetId)
    .first()

describe('shared durable atomic operations', () => {
  test('replays the saved original after later edits, from a new store instance', async () => {
    const first = await store.execute(command())
    expect(first.status).toBe('applied')
    expect(await store.execute(command(1, 'later', crypto.randomUUID()))).toMatchObject({
      status: 'applied',
      outcome: { revision: 2 },
    })
    const replay = await createMcpOperationStore(database).execute(command())
    expect(replay).toEqual({ ...first, status: 'replayed' })
    expect(await target()).toMatchObject({ revision: 2, value: 'later' })
    expect(await coupled()).toEqual({ value: 'later' })
  })

  test('hashes normalized key order but distinguishes expected revision, null, omission and array order', async () => {
    const initial = {
      ...command(),
      normalizedInput: { expectedRevision: 0, nested: { b: 2, a: 1 }, list: [2, 1] },
    }

    expect((await store.execute(initial)).status).toBe('applied')
    expect(
      (
        await store.execute({
          ...initial,
          normalizedInput: { list: [2, 1], nested: { a: 1, b: 2 }, expectedRevision: 0 },
        })
      ).status,
    ).toBe('replayed')

    for (const normalizedInput of [
      { expectedRevision: 1, nested: { b: 2, a: 1 }, list: [2, 1] },
      { expectedRevision: 0, nested: { b: 2, a: 1 }, list: [1, 2] },
      { expectedRevision: 0, nested: { b: 2, a: 1 }, list: [2, 1], optional: null },
    ])
      expect((await store.execute({ ...initial, normalizedInput })).status).toBe('conflict')
    expect(await target()).toMatchObject({ revision: 1 })
  })

  test('concurrent identical keys apply once and return the same original result', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createMcpOperationStore(database).execute(command())),
    )

    expect(results.filter((result) => result.status === 'applied')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'replayed')).toHaveLength(5)

    for (const result of results)
      expect(result).toMatchObject({ outcome: { revision: 1, result: { value: 'first' } } })
    expect(await target()).toMatchObject({ revision: 1, value: 'first' })
    expect(await database.prepare('SELECT count(*) AS count FROM mcp_operations').first()).toEqual({
      count: 1,
    })
  })

  test('concurrent competing keys lose CAS without any coupled writes or receipt', async () => {
    const results = await Promise.all([
      store.execute(command(0, 'alpha', crypto.randomUUID())),
      store.execute(command(0, 'beta', crypto.randomUUID())),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['applied', 'conflict'])
    const applied = results.find((result) => result.status === 'applied')

    if (!applied || applied.status !== 'applied') throw new Error('Missing successful operation')
    expect(await target()).toMatchObject({ revision: 1 })

    const saved = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }))(
      applied.outcome.result,
    )

    expect(await coupled()).toEqual({ value: saved.value })
    expect(await database.prepare('SELECT count(*) AS count FROM mcp_operations').first()).toEqual({
      count: 1,
    })
  })

  test('database assertion ABORTS the whole batch after zero-CAS and deliberately unconditional coupled DML', async () => {
    expect((await store.execute(command())).status).toBe('applied')
    const stale = command(0, 'must-rollback', crypto.randomUUID())

    const brokenPlan: ExecuteOperation = {
      ...stale,
      build: (ctx) => {
        const plan = stale.build(ctx)

        return {
          ...plan,
          statements: [
            ...plan.statements,
            ctx.prepare(sql`UPDATE operation_test_coupled SET value = 'unguarded-bug'`),
          ],
        }
      },
    }

    expect(await store.execute(brokenPlan)).toEqual({ status: 'conflict' })
    expect(await target()).toMatchObject({ revision: 1, value: 'first' })
    expect(await coupled()).toEqual({ value: 'first' })
    expect(await database.prepare('SELECT count(*) AS count FROM mcp_operations').first()).toEqual({
      count: 1,
    })
  })

  test('statement failure rolls domain and receipt back, identical key can retry', async () => {
    const input = command()
    const events: Array<OperationDiagnostic> = []
    const observed = createMcpOperationStore(database, (event) => events.push(event))
    expect(
      await observed.execute({
        ...input,
        build: (ctx) => {
          const plan = input.build(ctx)

          return {
            ...plan,
            statements: [
              ...plan.statements,
              ctx.prepare(sql`INSERT INTO operation_test_target (id) VALUES ('invalid')`),
            ],
          }
        },
      }),
    ).toEqual({ status: 'unavailable' })
    expect(events).toEqual([
      { operation: 'receipt.batch', dependency: 'database', code: 'storage_failed' },
    ])
    expect(await target()).toMatchObject({ revision: 0, value: 'initial' })
    expect(await coupled()).toBeNull()
    expect((await store.execute(input)).status).toBe('applied')
  })

  test('reports only safe categories for real lookup, decode, authorization and cleanup failures', async () => {
    const events: Array<OperationDiagnostic> = []

    const report = (event: OperationDiagnostic) => {
      events.push(event)
    }

    await using empty = await createMigratedD1Database([])
    const missing = createMcpOperationStore(empty.database, report)
    const input = { ...command(), authorize: async () => true }
    expect(await missing.execute(input)).toEqual({ status: 'unavailable' })
    expect(await missing.pruneExpired(now)).toEqual({ status: 'unavailable' })
    const observed = createMcpOperationStore(database, report)
    expect(
      await observed.execute({
        ...input,
        authorize: async () => {
          throw new Error('PRIVATE_AUTH SQL actor token')
        },
      }),
    ).toEqual({ status: 'unavailable' })
    await observed.execute(command())
    await database
      .prepare('UPDATE mcp_operations SET outcome = ?')
      .bind(JSON.stringify({ private: 'PRIVATE_OUTCOME' }))
      .run()
    expect(await observed.execute(command())).toEqual({ status: 'unavailable' })
    await database
      .prepare(
        "CREATE TRIGGER operation_test_cleanup_failure BEFORE UPDATE ON mcp_operations WHEN NEW.state = 'expired' BEGIN SELECT RAISE(ABORT, 'PRIVATE_CLEANUP_SQL'); END",
      )
      .run()

    try {
      expect(await observed.pruneExpired(now + 86400000)).toEqual({ status: 'unavailable' })
    } finally {
      await database.prepare('DROP TRIGGER operation_test_cleanup_failure').run()
    }

    expect(events).toEqual([
      { operation: 'receipt.lookup', dependency: 'database', code: 'storage_failed' },
      { operation: 'receipt.prune', dependency: 'database', code: 'storage_failed' },
      { operation: 'receipt.authorize', dependency: 'authorization', code: 'authorization_failed' },
      { operation: 'receipt.decode', dependency: 'codec', code: 'decode_failed' },
      { operation: 'receipt.prune', dependency: 'database', code: 'storage_failed' },
    ])
    expect(JSON.stringify(events)).not.toMatch(
      /PRIVATE|SELECT|mcp_operations|operation-owner|operation-client|private-target|a9fc2be4/,
    )
  })

  test('rechecks live role, ban, client and saved target access before replay disclosure', async () => {
    expect((await store.execute(command())).status).toBe('applied')

    for (const [deny, restore] of [
      ['UPDATE user SET banned = 1', 'UPDATE user SET banned = 0'],
      ["UPDATE user SET role = 'user'", "UPDATE user SET role = 'admin'"],
      ['UPDATE oauth_client SET disabled = 1', 'UPDATE oauth_client SET disabled = 0'],
      [
        'UPDATE operation_test_target SET visible = 0',
        'UPDATE operation_test_target SET visible = 1',
      ],
      [
        "UPDATE operation_test_target SET owner_id = 'other'",
        `UPDATE operation_test_target SET owner_id = '${actorId}'`,
      ],
    ] as const) {
      await database.prepare(deny).run()
      expect(await store.execute(command())).toEqual({ status: 'access_denied' })
      await database.prepare(restore).run()
    }

    await database.prepare('DELETE FROM operation_test_target').run()
    expect(await store.execute(command())).toEqual({ status: 'access_denied' })
    expect(
      await store.execute({
        ...command(),
        authorize: async () => {
          throw new Error('private auth details')
        },
      }),
    ).toEqual({ status: 'unavailable' })
  })

  test('postcommit authority loss withholds result but does not claim mutation rolled back', async () => {
    const input = command()

    const result = await store.execute({
      ...input,
      authorize: async (outcome) => outcome === undefined,
    })

    expect(result).toEqual({ status: 'access_denied' })
    expect(await target()).toMatchObject({ revision: 1 })
    expect((await store.execute(input)).status).toBe('replayed')
  })

  test('expires exactly at 24h, redacts and never reapplies even with changed input', async () => {
    expect((await store.execute(command())).status).toBe('applied')
    expect((await store.execute({ ...command(), now: now + 86_400_000 - 1 })).status).toBe(
      'replayed',
    )
    expect(await store.execute({ ...command(), now: now + 86_400_000 })).toEqual({
      status: 'expired',
    })
    expect(await store.execute({ ...command(1, 'changed'), now: now + 86_400_001 })).toEqual({
      status: 'expired',
    })
    expect(await target()).toMatchObject({ revision: 1, value: 'first' })
    const [receipt] = await drizzle(database).select().from(mcpOperations)
    expect(receipt).toMatchObject({
      state: 'expired',
      outcome: null,
      actorId: null,
      clientId: null,
      attemptId: null,
    })
    expect(receipt?.inputHash).toHaveLength(64)
  })

  test('maintenance redacts unvisited expired receipts, not just replayed ones', async () => {
    await store.execute(command())
    expect(await store.pruneExpired(now + 86_400_000 - 1)).toEqual({ status: 'pruned' })
    expect(await database.prepare('SELECT state FROM mcp_operations').first()).toEqual({
      state: 'complete',
    })
    expect(await store.pruneExpired(now + 86_400_000)).toEqual({ status: 'pruned' })
    expect(
      await database.prepare('SELECT state,outcome,actor_id,client_id FROM mcp_operations').first(),
    ).toEqual({ state: 'expired', outcome: null, actor_id: null, client_id: null })
    expect((await store.execute(command())).status).toBe('expired')
  })

  test.each(['actor', 'client'])(
    '%s deletion immediately redacts, namespace recreation cannot resurrect the key',
    async (kind) => {
      await store.execute(command())
      await database
        .prepare(kind === 'actor' ? 'DELETE FROM user' : 'DELETE FROM oauth_client')
        .run()
      expect(
        await database
          .prepare('SELECT state,outcome,actor_id,client_id,attempt_id FROM mcp_operations')
          .first(),
      ).toEqual({
        state: 'expired',
        outcome: null,
        actor_id: null,
        client_id: null,
        attempt_id: null,
      })
      expect(await store.execute(command())).toEqual({ status: 'access_denied' })

      if (kind === 'actor')
        await database
          .prepare(
            'INSERT INTO user (id,name,email,created_at,updated_at,role,banned) VALUES (?,?,?,?,?,?,?)',
          )
          .bind(actorId, 'New owner', 'new@example.test', now, now, 'admin', 0)
          .run()
      else
        await database
          .prepare(
            'INSERT INTO oauth_client (id,client_id,redirect_uris,disabled) VALUES (?,?,?,0)',
          )
          .bind('replacement', clientId, '[]')
          .run()
      expect(await store.execute(command())).toEqual({ status: 'expired' })
      expect(await target()).toMatchObject({ revision: 1 })
    },
  )

  test('each trusted key dimension isolates receipts, UUID case is canonical', async () => {
    await store.execute(command())
    expect(
      (
        await store.execute({
          ...command(),
          key: { ...key, requestId: key.requestId.toUpperCase() },
        })
      ).status,
    ).toBe('replayed')

    for (const changed of [
      { clientId: 'other-client' },
      { resource: 'https://other.test/mcp' },
      { operation: 'other-operation' },
      { actorId: 'other-actor' },
    ]) {
      // False assertion proves there was no receipt replay from another namespace.
      expect(
        await store.execute({
          ...command(),
          key: { ...key, ...changed },
          build: () => ({
            statements: [],
            assertApplied: sql`0`,
            outcome: { result: null, revision: null, access: null },
          }),
        }),
      ).toMatchObject({ status: changed.actorId ? 'unavailable' : 'conflict' })
    }
  })

  test('rejects invalid IDs and oversized UTF8 outcomes BEFORE committing anything', async () => {
    expect(await store.execute({ ...command(), key: { ...key, requestId: 'not-a-uuid' } })).toEqual(
      { status: 'invalid_input' },
    )
    expect(
      await store.execute({
        ...command(),
        build: (ctx) => ({
          ...command().build(ctx),
          outcome: { result: '界'.repeat(22000), revision: 1, access: targetId },
        }),
      }),
    ).toEqual({ status: 'invalid_input' })
    expect(await target()).toMatchObject({ revision: 0 })
    expect(await database.prepare('SELECT count(*) AS count FROM mcp_operations').first()).toEqual({
      count: 0,
    })
  })

  test('schema exports match migrated columns, indexes, FK and enforce receipt bounds', async () => {
    const config = getTableConfig(mcpOperations)

    const columns = await database
      .prepare('PRAGMA table_info(mcp_operations)')
      .all<{ name: string }>()

    expect(columns.results.map((column) => column.name)).toEqual(
      config.columns.map((column) => column.name),
    )

    const indexes = await database
      .prepare('PRAGMA index_list(mcp_operations)')
      .all<{ name: string }>()

    for (const index of config.indexes)
      expect(indexes.results.map((entry) => entry.name)).toContain(index.config.name)
    expect(await database.prepare('PRAGMA foreign_key_list(mcp_operations)').first()).toMatchObject(
      { table: 'user', from: 'actor_id', on_delete: 'SET NULL' },
    )
    await store.execute(command())
    await expect(
      database.prepare("UPDATE mcp_operations SET outcome = 'not JSON'").run(),
    ).rejects.toThrow()
    await expect(
      database
        .prepare('UPDATE mcp_operations SET outcome = ?')
        .bind(JSON.stringify({ result: 'x'.repeat(65537) }))
        .run(),
    ).rejects.toThrow()
    await expect(
      database.prepare('UPDATE mcp_operations SET attempt_id = NULL').run(),
    ).rejects.toThrow()
    await expect(
      database.prepare('UPDATE mcp_operations SET expires_at = expires_at + 1').run(),
    ).rejects.toThrow()
  })
})
