import type { D1Database } from '@cloudflare/workers-types'
import { REMINDER_STATUS } from '@gbfm/core/status'
import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { EmailDelivery, EmailDeliveryUnavailable } from '@/services/email-delivery.service'
import {
  claimReminder,
  processReminderJob,
  queryDueReminders,
  sendClaimedReminder,
} from '@/services/reminder-processor'
import { withTestLayer } from '@/test/effect'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { reminderClock } from '@/test/reminder-clock'

const reminder = (id: string) => ({
  id,
  userId: 'listener',
  musicTitle: 'Mix',
  artistName: 'Artist',
  musicUrl: 'https://example.test/mix',
  reminderDate: new Date(0),
  updatedAt: new Date(0),
})

const receipt = {
  deliveryLogId: 'fixture-delivery',
  provider: 'cloudflare' as const,
  providerMessageId: 'accepted',
  acceptedAt: new Date(0),
}

describe('bounded reminder recovery on local D1', () => {
  test('cron discovers due unsent pending, expired processing and cooled-down failures, at most 100', async () => {
    await using resource = await createMigratedD1Database()
    const clock = reminderClock(1_000_000)
    const queries: Array<string> = []
    const binding = resource.database

    const counted: D1Database = {
      prepare: (query) => {
        queries.push(query)

        return binding.prepare(query)
      },
      batch: (statements) => binding.batch(statements),
      exec: (query) => binding.exec(query),
      withSession: (constraint) => binding.withSession(constraint),
      dump: () => binding.dump(),
    }

    const layer = Layer.mergeAll(DatabaseLayer(counted), clock.layer)
    const database = Effect.runSync(withTestLayer(Database, layer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })

    const fixtures = [
      { ...reminder('a-failed'), status: REMINDER_STATUS.FAILED, updatedAt: new Date(700_000) },
      {
        ...reminder('b-stalled'),
        status: REMINDER_STATUS.PROCESSING,
        updatedAt: new Date(700_000),
      },
      { ...reminder('live'), status: REMINDER_STATUS.PROCESSING, updatedAt: new Date(700_001) },
      { ...reminder('backoff'), status: REMINDER_STATUS.FAILED, updatedAt: new Date(700_001) },
      { ...reminder('sent'), status: REMINDER_STATUS.SENT },
      { ...reminder('sent-flag'), isSent: true },
      { ...reminder('sent-failed'), isSent: true, status: REMINDER_STATUS.FAILED },
      { ...reminder('future'), reminderDate: new Date(1_000_001) },
      ...Array.from({ length: 105 }, (_, index) => reminder(`pending-${index}`)),
    ]

    for (const fixture of fixtures) await database.insert(musicReminder).values(fixture)
    queries.length = 0
    const due = await Effect.runPromise(withTestLayer(queryDueReminders, layer))
    expect(queries).toHaveLength(1)
    const discoveryQuery = queries[0]

    if (!discoveryQuery) throw new Error('Missing discovery query')

    const plan = await binding
      .prepare(`EXPLAIN QUERY PLAN ${discoveryQuery}`)
      .bind(
        clock.now(),
        0,
        REMINDER_STATUS.PENDING,
        REMINDER_STATUS.FAILED,
        REMINDER_STATUS.PROCESSING,
        clock.now() - 300_000,
        100,
      )
      .all<{ detail: string }>()

    expect(plan.results.some((row) => row.detail.includes('music_reminder_is_sent_idx'))).toBe(true)
    expect(due).toHaveLength(100)
    expect(due.slice(0, 2).map((row) => row.id)).toEqual(['a-failed', 'b-stalled'])
    expect(
      due.every(
        (row) => ['a-failed', 'b-stalled'].includes(row.id) || row.id.startsWith('pending-'),
      ),
    ).toBe(true)

    for (const id of ['live', 'backoff', 'sent', 'sent-flag', 'sent-failed', 'future']) {
      expect(await Effect.runPromise(withTestLayer(claimReminder(id), layer))).toEqual({
        claimed: false,
      })
    }

    await database.delete(musicReminder).where(eq(musicReminder.status, REMINDER_STATUS.PENDING))
    clock.advance(1)
    queries.length = 0
    expect(
      (await Effect.runPromise(withTestLayer(queryDueReminders, layer))).map((row) => row.id),
    ).toEqual(['a-failed', 'b-stalled', 'backoff', 'live'])
    expect(queries).toHaveLength(1)
  })

  test('a live claim is skipped, then the same persisted row is recovered at five minutes', async () => {
    await using resource = await createMigratedD1Database()
    const clock = reminderClock(1_000_000)
    let deliveries = 0

    const layer = Layer.mergeAll(
      DatabaseLayer(resource.database),
      clock.layer,
      Layer.succeed(EmailDelivery, {
        deliver: () =>
          Effect.sync(() => {
            deliveries += 1

            return receipt
          }),
      }),
    )

    const database = Effect.runSync(withTestLayer(Database, layer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
    await database.insert(musicReminder).values(reminder('crashed'))
    expect(await Effect.runPromise(withTestLayer(claimReminder('crashed'), layer))).toEqual({
      claimed: true,
    })
    const [first] = await database.select().from(musicReminder)
    clock.advance(299_999)
    expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([])
    await Effect.runPromise(withTestLayer(processReminderJob('crashed'), layer))
    expect(deliveries).toBe(0)
    clock.advance(1)
    expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toHaveLength(1)
    await Effect.runPromise(withTestLayer(processReminderJob('crashed'), layer))
    await Effect.runPromise(withTestLayer(processReminderJob('crashed'), layer))
    const [sent] = await database.select().from(musicReminder)
    expect(sent).toMatchObject({ status: REMINDER_STATUS.SENT, isSent: true })
    expect(sent?.updatedAt.getTime()).toBeGreaterThan(first?.updatedAt.getTime() ?? Infinity)
    expect(deliveries).toBe(1)

    if (!first) throw new Error('Missing claim')
    await Effect.runPromise(withTestLayer(sendClaimedReminder(first), layer))
    expect(deliveries).toBe(1)
  })

  test.each([
    ['success', 'processing'],
    ['failure', 'processing'],
    ['success', 'sent'],
    ['failure', 'sent'],
  ] as const)(
    'old %s completion cannot overwrite newer %s ownership',
    async (oldOutcome, newState) => {
      await using resource = await createMigratedD1Database()
      const clock = reminderClock(1_000_000)
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      let deliveries = 0

      const layer = Layer.mergeAll(
        DatabaseLayer(resource.database),
        clock.layer,
        Layer.succeed(EmailDelivery, {
          deliver: () =>
            Effect.gen(function* () {
              deliveries += 1

              if (deliveries === 1) {
                entered.resolve()
                yield* Effect.promise(() => released.promise)

                if (oldOutcome === 'failure') return yield* new EmailDeliveryUnavailable()
              }

              return receipt
            }),
        }),
      )

      const database = Effect.runSync(withTestLayer(Database, layer))
      await database
        .insert(user)
        .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
      await database.insert(musicReminder).values(reminder('paused'))

      const pending = Effect.runPromise(withTestLayer(processReminderJob('paused'), layer))

      const outcome = pending.then(
        () => 'success',
        () => 'failure',
      )

      try {
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw new Error('Expected provider gate')
          }),
        ])
        const [old] = await database.select().from(musicReminder)
        clock.advance(300_000)

        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            Effect.runPromise(withTestLayer(claimReminder('paused'), layer)),
          ),
        )

        expect(results.filter((result) => result.claimed)).toHaveLength(1)
        const [current] = await database.select().from(musicReminder)

        if (!current || !old) throw new Error('Missing claim')
        expect(current.updatedAt.getTime()).toBeGreaterThan(old.updatedAt.getTime())

        if (newState === 'sent')
          await Effect.runPromise(withTestLayer(sendClaimedReminder(current), layer))
        const [before] = await database.select().from(musicReminder)
        released.resolve()
        expect(await outcome).toBe(oldOutcome)
        expect((await database.select().from(musicReminder))[0]).toEqual(before)

        if (newState === 'processing')
          await Effect.runPromise(withTestLayer(sendClaimedReminder(current), layer))
        expect((await database.select().from(musicReminder))[0]).toMatchObject({
          status: REMINDER_STATUS.SENT,
          isSent: true,
        })
      } finally {
        released.resolve()
        await outcome
      }
    },
  )

  test('a post-claim read must still own the generation before delivering', async () => {
    await using resource = await createMigratedD1Database()
    const clock = reminderClock(1_000_000)
    let deliveries = 0

    const delivery = Layer.succeed(EmailDelivery, {
      deliver: () =>
        Effect.sync(() => {
          deliveries += 1

          return receipt
        }),
    })

    const layer = Layer.mergeAll(DatabaseLayer(resource.database), clock.layer, delivery)
    const database = Effect.runSync(withTestLayer(Database, layer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
    await database.insert(musicReminder).values(reminder('paused'))
    const gate = gatedPostDatabase(resource.database, 'before', /^select .*from "music_reminder"/i)

    const pending = Effect.runPromise(
      withTestLayer(
        processReminderJob('paused'),
        Layer.mergeAll(DatabaseLayer(gate.database), clock.layer, delivery),
      ),
    )

    try {
      await Promise.race([
        gate.reached,
        pending.then(() => {
          throw new Error('Expected post-claim read gate')
        }),
      ])
      clock.advance(300_000)
      await Effect.runPromise(withTestLayer(processReminderJob('paused'), layer))
      gate.release()
      await pending
      expect(deliveries).toBe(1)
      expect((await database.select().from(musicReminder))[0]).toMatchObject({
        status: REMINDER_STATUS.SENT,
        isSent: true,
      })
    } finally {
      gate.release()
      await pending
    }
  })

  test('claim generations advance even when the application clock is behind the persisted timestamp', async () => {
    await using resource = await createMigratedD1Database()
    const clock = reminderClock(1_000_000)
    const layer = Layer.mergeAll(DatabaseLayer(resource.database), clock.layer)
    const database = Effect.runSync(withTestLayer(Database, layer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
    await database
      .insert(musicReminder)
      .values({ ...reminder('pending'), updatedAt: new Date(2_000_000) })
    await Effect.runPromise(withTestLayer(claimReminder('pending'), layer))
    expect((await database.select().from(musicReminder))[0]?.updatedAt.getTime()).toBe(2_000_001)
  })
})
