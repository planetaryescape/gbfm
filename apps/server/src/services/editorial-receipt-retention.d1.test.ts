import { EDITORIAL_DRAFT_RETRY_WINDOW_MS } from '@gbfm/core/editorial-mcp'
import { eq, isNotNull } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import { Database } from '@/db/layer'
import { db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { expireEditorialReceipts } from './editorial-receipt-retention'

const actorId = 'receipt-retention-owner'

beforeAll(() =>
  db.insert(user).values({ id: actorId, name: 'Fixture', email: 'receipt@example.test' }),
)

afterEach(() => db.delete(editorialOperations).where(eq(editorialOperations.actorId, actorId)))

const sweep = (now: number) =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        yield* TestClock.setTime(now)

        return yield* expireEditorialReceipts()
      }),
      Layer.mergeAll(Layer.succeed(Database, db), TestClock.layer()),
    ),
  )

test('clears expired response bodies at the retry boundary but preserves tombstones and current receipts', async () => {
  await db.insert(editorialOperations).values([
    {
      id: 'expired',
      actorId,
      postId: 'deleted-post',
      inputHash: 'hash',
      result: 'old private text',
      createdAt: new Date(0),
    },
    {
      id: 'current',
      actorId,
      postId: 'current-post',
      inputHash: 'hash',
      result: 'current text',
      createdAt: new Date(1),
    },
  ])
  expect(await sweep(EDITORIAL_DRAFT_RETRY_WINDOW_MS)).toEqual({ expired: 1 })
  const rows = await db.select().from(editorialOperations)
  expect(rows.find((row) => row.id === 'expired')).toMatchObject({
    postId: 'deleted-post',
    inputHash: 'hash',
    result: null,
  })
  expect(rows.find((row) => row.id === 'current')?.result).toBe('current text')
  expect(await sweep(EDITORIAL_DRAFT_RETRY_WINDOW_MS)).toEqual({ expired: 0 })
})

test('bounds each sweep to 1000 bodies and resumes the backlog on the next sweep', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    id: `backlog-${index}`,
    actorId,
    postId: 'post',
    inputHash: 'hash',
    result: 'private text',
    createdAt: new Date(0),
  }))

  for (let offset = 0; offset < rows.length; offset += 10)
    await db.insert(editorialOperations).values(rows.slice(offset, offset + 10))
  expect(await sweep(EDITORIAL_DRAFT_RETRY_WINDOW_MS)).toEqual({ expired: 1000 })
  expect(
    await db.select().from(editorialOperations).where(isNotNull(editorialOperations.result)),
  ).toHaveLength(1)
  expect(await sweep(EDITORIAL_DRAFT_RETRY_WINDOW_MS)).toEqual({ expired: 1 })
  expect(await db.select().from(editorialOperations)).toHaveLength(1001)
})
