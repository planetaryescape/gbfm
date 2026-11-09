import { and, eq, sql } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { Database } from '@/db/layer'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { type McpOperationStore, McpOperationStoreLayer } from '@/mcp/operations/store'
import { db, d1 } from '@/test/d1'
import { withTestLayer } from '@/test/effect'

import { FavoriteService, FavoriteServiceLayer } from './favorite.service'

const CONCURRENCY = 20

const TestFavoriteServiceLayer = Layer.mergeAll(
  FavoriteServiceLayer.pipe(Layer.provide(Layer.succeed(Database)(db))),
  McpOperationStoreLayer(d1),
)

const context = (actorId: string) => ({
  actorId,
  clientId: 'gbfm:session',
  resource: 'https://example.test/api',
  requestId: crypto.randomUUID(),
  expectedRevision: 0,
  now: Date.now(),
  authorize: async () => true,
  live: sql`1`,
})

const runFavoriteEffect = <A>(
  fn: (svc: FavoriteService) => Effect.Effect<A, never, McpOperationStore>,
) =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const svc = yield* FavoriteService

        return yield* fn(svc)
      }),
      TestFavoriteServiceLayer,
    ),
  )

describe('D1 concurrent favorites', () => {
  test('20 concurrent addFavorite calls for the same user+audio create exactly one row', async () => {
    const userId = 'concurrent-favorite-user'
    const audioId = 'concurrent-favorite-audio'

    await db
      .insert(user)
      .values({ id: userId, name: 'Concurrent User', email: `${userId}@test.dev` })
    await db.insert(audioTable).values({
      id: audioId,
      title: 'Concurrent Mix',
      slug: 'concurrent-favorite-mix',
      content: 'test content',
      type: 'mix',
      url: 'https://example.com/concurrent.mp3',
    })

    const exits = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        runFavoriteEffect((svc) => svc.addFavorite(context(userId), audioId)),
      ),
    )

    const succeeded = exits.filter((result) => result.status === 'applied')
    const failed = exits.filter((result) => result.status === 'conflict')

    expect(succeeded.length).toBe(1)
    expect(failed.length).toBe(CONCURRENCY - 1)

    const rows = await db
      .select()
      .from(favoritesTable)
      .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.audioId, audioId)))

    expect(rows.length).toBe(1)
  })

  test('20 concurrent addShowFavorite calls create exactly one favorite and one subscription', async () => {
    const userId = 'concurrent-show-favorite-user'
    const showId = 'concurrent-show-favorite-show'

    await db
      .insert(user)
      .values({ id: userId, name: 'Concurrent Show User', email: `${userId}@test.dev` })
    await db.insert(showsTable).values({
      id: showId,
      title: 'Concurrent Show',
      slug: 'concurrent-favorite-show',
      content: 'test content',
    })

    const exits = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        runFavoriteEffect((svc) => svc.addShowFavorite(context(userId), showId)),
      ),
    )

    const succeeded = exits.filter((result) => result.status === 'applied')
    const failed = exits.filter((result) => result.status === 'conflict')

    expect(succeeded.length).toBe(1)
    expect(failed.length).toBe(CONCURRENCY - 1)

    const favoriteRows = await db
      .select()
      .from(favoritesTable)
      .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.showId, showId)))

    expect(favoriteRows.length).toBe(1)

    const subscriptionRows = await db
      .select()
      .from(showSubscriptionsTable)
      .where(
        and(eq(showSubscriptionsTable.userId, userId), eq(showSubscriptionsTable.showId, showId)),
      )

    expect(subscriptionRows.length).toBe(1)
  })
})
