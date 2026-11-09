import { sql } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { afterAll, beforeEach, expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { session, user } from '@/db/auth.schema'
import { DatabaseLayer, makeDatabaseClient } from '@/db/layer'
import { showsTable } from '@/db/show.schema'
import { FavoriteService, FavoriteServiceLayer } from '@/services/favorite.service'
import {
  ShowSubscriptionService,
  ShowSubscriptionServiceLayer,
} from '@/services/show-subscription.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { createMcpOperationStore, McpOperationStoreLayer } from '../operations/store'
import type { SetFavoriteInput } from './contracts'
import { executeMembership as execute, type MembershipAuthority } from './membership'

const resource = await createMigratedD1Database()

const database = resource.database

const db = makeDatabaseClient(database)

const store = createMcpOperationStore(database)

const now = 1_800_000_000_000

const executeMembership = (
  operationStore: typeof store,
  context: MembershipAuthority,
  operation: 'favorite' | 'subscription',
  input: typeof SetFavoriteInput.Type,
) => execute(db, operationStore, context, operation, input)

afterAll(() => resource.dispose())

beforeEach(async () => {
  await database.batch([
    database.prepare('DELETE FROM mcp_operations'),
    database.prepare('DELETE FROM user'),
    database.prepare('DELETE FROM audio'),
    database.prepare('DELETE FROM shows'),
  ])
  await db.insert(user).values([
    { id: 'owner', name: 'Owner', email: 'owner@example.test' },
    { id: 'other', name: 'Other', email: 'other@example.test' },
  ])
  await db.insert(session).values({
    id: 'credential',
    userId: 'owner',
    token: 'disposable-token',
    expiresAt: new Date(now + 60_000),
    updatedAt: new Date(now),
  })
  await db.insert(showsTable).values([
    { id: 'public-show', title: 'Public', slug: 'public', content: '' },
    { id: 'draft-show', title: 'Private', slug: 'draft', content: '', draft: true },
  ])
  await db.insert(audioTable).values({
    id: 'public-audio',
    title: 'Audio',
    slug: 'audio',
    content: '',
    type: 'mix',
    url: 'https://example.test/mix',
  })
})

const authority: MembershipAuthority = {
  actorId: 'owner',
  clientId: 'gbfm:session',
  resource: 'https://example.test/api',
  now,
  live: sql`EXISTS (SELECT 1 FROM session WHERE id = 'credential' AND user_id = 'owner' AND expires_at > ${now})`,
  authorize: async () =>
    Boolean(
      await database
        .prepare(`SELECT 1 FROM session s JOIN user u ON s.user_id = u.id
    WHERE s.id = 'credential' AND u.id = 'owner' AND u.banned = 0 AND s.expires_at > ?`)
        .bind(now)
        .first(),
    ),
}

const command = (
  expectedRevision: number,
  desiredState: boolean,
  targetKind: 'show' | 'audio' = 'show',
) => ({
  expectedRevision,
  desiredState,
  targetKind,
  targetId: targetKind === 'show' ? 'public-show' : 'public-audio',
  requestId: crypto.randomUUID(),
})

const state = async () => ({
  revision: await database
    .prepare("SELECT revision FROM listener_membership_revisions WHERE user_id = 'owner'")
    .first('revision'),
  favorites: await database
    .prepare("SELECT count(*) AS n FROM favorites WHERE user_id = 'owner'")
    .first('n'),
  subscriptions: await database
    .prepare("SELECT count(*) AS n FROM show_subscriptions WHERE userId = 'owner'")
    .first('n'),
  receipts: await database.prepare('SELECT count(*) AS n FROM mcp_operations').first('n'),
})

test('coupled desired-state writes, exact replay, no-op revisions and empty-library ABA protection', async () => {
  const add = command(0, true)
  const applied = await executeMembership(store, authority, 'favorite', add)
  expect(applied.status).toBe('applied')
  expect(await state()).toEqual({ revision: 1, favorites: 1, subscriptions: 1, receipts: 1 })
  const replay = await executeMembership(store, authority, 'favorite', add)
  expect(replay.status).toBe('replayed')

  if (applied.status !== 'applied' || replay.status !== 'replayed')
    throw new Error('Expected committed membership receipts')
  expect(replay.outcome).toEqual(applied.outcome)
  expect(replay.outcome.result).toMatchObject({ revision: 1, notifications: 'not_sent' })

  expect(
    (await executeMembership(store, authority, 'favorite', { ...add, desiredState: false })).status,
  ).toBe('conflict')
  expect(
    (await executeMembership(store, authority, 'subscription', command(1, false))).status,
  ).toBe('applied')
  expect(await state()).toEqual({ revision: 2, favorites: 1, subscriptions: 0, receipts: 2 })
  expect((await executeMembership(store, authority, 'favorite', command(2, false))).status).toBe(
    'applied',
  )
  expect(await state()).toEqual({ revision: 3, favorites: 0, subscriptions: 0, receipts: 3 })
  expect((await executeMembership(store, authority, 'favorite', command(0, true))).status).toBe(
    'conflict',
  )
  expect((await executeMembership(store, authority, 'favorite', command(3, false))).status).toBe(
    'applied',
  )
  expect(await state()).toEqual({ revision: 4, favorites: 0, subscriptions: 0, receipts: 4 })
  const historical = await executeMembership(store, authority, 'favorite', add)
  expect(historical.status).toBe('replayed')

  if (historical.status !== 'replayed') throw new Error('Expected original receipt replay')
  expect(historical.outcome.result).toMatchObject({ desiredState: true, revision: 1 })
  expect(await state()).toEqual({ revision: 4, favorites: 0, subscriptions: 0, receipts: 4 })
}, 30_000)

test('competing intents share one owner CAS across target types and do not leak partial coupled writes', async () => {
  const outcomes = await Promise.all([
    executeMembership(store, authority, 'subscription', command(0, true)),
    executeMembership(store, authority, 'favorite', command(0, true, 'audio')),
  ])

  expect(outcomes.map((result) => result.status).sort()).toEqual(['applied', 'conflict'])
  const observed = await state()
  expect(observed).toMatchObject({ revision: 1, favorites: 1, receipts: 1 })
  expect(observed.subscriptions).toBe(outcomes[0]?.status === 'applied' ? 1 : 0)
  expect(
    await database
      .prepare("SELECT count(*) AS n FROM favorites WHERE user_id = 'other'")
      .first('n'),
  ).toBe(0)
}, 30_000)

test('live SQL rejects stale credential authority and private targets without creating receipts or revision rows', async () => {
  const privateInput = { ...command(0, true), targetId: 'draft-show' }
  expect((await executeMembership(store, authority, 'favorite', privateInput)).status).toBe(
    'access_denied',
  )
  expect(await state()).toEqual({ revision: null, favorites: 0, subscriptions: 0, receipts: 0 })
  await database.prepare("DELETE FROM session WHERE id = 'credential'").run()
  expect(
    (
      await executeMembership(
        store,
        { ...authority, authorize: async () => true },
        'favorite',
        command(0, true),
      )
    ).status,
  ).toBe('access_denied')
  expect(await state()).toEqual({ revision: null, favorites: 0, subscriptions: 0, receipts: 0 })
}, 30_000)

test('same-key concurrent retries produce one transition; revoked credentials cannot read committed receipt', async () => {
  const input = command(0, true)

  const results = await Promise.all([
    executeMembership(store, authority, 'subscription', input),
    executeMembership(store, authority, 'subscription', input),
  ])

  expect(
    results.every((result) => result.status === 'applied' || result.status === 'replayed'),
  ).toBe(true)
  expect(await state()).toEqual({ revision: 1, favorites: 1, subscriptions: 1, receipts: 1 })
  await database.prepare("DELETE FROM session WHERE id = 'credential'").run()
  expect((await executeMembership(store, authority, 'subscription', input)).status).toBe(
    'access_denied',
  )
  expect(await state()).toEqual({ revision: 1, favorites: 1, subscriptions: 1, receipts: 1 })
}, 30_000)

test('all six existing service writers participate in one revision and receipt history', async () => {
  const context = (expectedRevision: number) => ({
    ...authority,
    expectedRevision,
    requestId: crypto.randomUUID(),
  })

  const layer = Layer.mergeAll(
    Layer.mergeAll(FavoriteServiceLayer, ShowSubscriptionServiceLayer).pipe(
      Layer.provide(DatabaseLayer(database)),
    ),
    McpOperationStoreLayer(database),
  )

  const results = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const favorites = yield* FavoriteService
        const subscriptions = yield* ShowSubscriptionService

        return [
          yield* favorites.addFavorite(context(0), 'public-audio'),
          yield* favorites.addShowFavorite(context(1), 'public-show'),
          yield* subscriptions.unsubscribe(context(2), 'public-show'),
          yield* subscriptions.subscribe(context(3), 'public-show'),
          yield* favorites.removeShowFavorite(context(4), 'public-show'),
          yield* favorites.removeFavorite(context(5), 'public-audio'),
        ]
      }),
      layer,
    ),
  )

  expect(results.map((result) => result.status)).toEqual(Array(6).fill('applied'))
  expect(await state()).toEqual({ revision: 6, favorites: 0, subscriptions: 0, receipts: 6 })
}, 30_000)

test('revocation after authority read aborts revision, receipt and both memberships in the batch', async () => {
  // A disposable SQL trigger makes the precheck/batch race deterministic; rollback must restore everything.
  await database
    .prepare(`CREATE TRIGGER revoke_membership_credential AFTER INSERT ON mcp_operations
    BEGIN DELETE FROM session WHERE id = 'credential'; END`)
    .run()

  try {
    expect((await executeMembership(store, authority, 'favorite', command(0, true))).status).toBe(
      'conflict',
    )
    expect(await state()).toEqual({ revision: null, favorites: 0, subscriptions: 0, receipts: 0 })
    expect(
      await database.prepare("SELECT id FROM session WHERE id = 'credential'").first('id'),
    ).toBe('credential')
  } finally {
    await database.prepare('DROP TRIGGER revoke_membership_credential').run()
  }
}, 30_000)

test('receipt replay rechecks target visibility and live account, not only the original credential', async () => {
  const input = command(0, true)
  expect((await executeMembership(store, authority, 'favorite', input)).status).toBe('applied')
  await database.prepare("UPDATE shows SET draft = 1 WHERE id = 'public-show'").run()
  expect((await executeMembership(store, authority, 'favorite', input)).status).toBe(
    'access_denied',
  )
  await database.prepare("UPDATE shows SET draft = 0 WHERE id = 'public-show'").run()
  await database.prepare("UPDATE user SET banned = 1 WHERE id = 'owner'").run()
  expect(
    (
      await executeMembership(
        store,
        { ...authority, authorize: async () => true },
        'favorite',
        input,
      )
    ).status,
  ).toBe('access_denied')
  expect(await state()).toEqual({ revision: 1, favorites: 1, subscriptions: 1, receipts: 1 })
}, 30_000)
