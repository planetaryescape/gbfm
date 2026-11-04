import { REMINDER_STATUS } from '@gbfm/core/status'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { EmailDelivery, EmailDeliveryUnavailable } from '@/services/email-delivery.service'
import { MusicReminderService, MusicReminderServiceLayer } from '@/services/music-reminder.service'
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

const fixture = {
  id: 'scheduled',
  userId: 'listener',
  musicTitle: 'Mix',
  artistName: 'Artist',
  musicUrl: 'https://example.test/mix',
  reminderDate: new Date(0),
  updatedAt: new Date(0),
}

const receipt = {
  deliveryLogId: 'fixture-delivery',
  provider: 'cloudflare' as const,
  providerMessageId: 'accepted',
  acceptedAt: new Date(0),
}

const reschedule = (reminderDate: Date) =>
  Effect.gen(function* () {
    const reminders = yield* MusicReminderService

    return yield* reminders.update('scheduled', 'listener', { reminderDate })
  })

describe('reminder schedule ownership on local D1', () => {
  test.each([
    ['before the fresh reminder read', /^select .*from "music_reminder"/i],
    ['after the fresh read, while loading the recipient', /^select .*from "user"/i],
  ] as const)(
    'rescheduling %s prevents delivery and recovers at the new due time',
    async (_, pattern) => {
      await using resource = await createMigratedD1Database()
      const clock = reminderClock(1_000_000)
      const databaseLayer = DatabaseLayer(resource.database)
      const database = Effect.runSync(withTestLayer(Database, databaseLayer))
      await database
        .insert(user)
        .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
      await database.insert(musicReminder).values(fixture)
      let deliveries = 0

      const delivery = Layer.succeed(EmailDelivery, {
        deliver: () =>
          Effect.sync(() => {
            deliveries += 1

            return receipt
          }),
      })

      const layer = Layer.mergeAll(databaseLayer, clock.layer, delivery)

      const updates = MusicReminderServiceLayer.pipe(
        Layer.provide(databaseLayer),
        Layer.provideMerge(clock.layer),
      )

      const gate = gatedPostDatabase(resource.database, 'before', pattern)

      const pending = Effect.runPromise(
        withTestLayer(
          processReminderJob('scheduled'),
          Layer.mergeAll(DatabaseLayer(gate.database), clock.layer, delivery),
        ),
      )

      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error('Expected reminder delivery preparation gate')
          }),
        ])
        const [old] = await database.select().from(musicReminder)

        if (!old) throw new Error('Missing old claim')
        expect(old.status).toBe(REMINDER_STATUS.PROCESSING)
        const future = new Date(clock.now() + 60_000)
        const edited = await Effect.runPromise(withTestLayer(reschedule(future), updates))
        expect(edited).toMatchObject({
          status: REMINDER_STATUS.PENDING,
          isSent: false,
          reminderDate: future,
        })
        expect(edited.updatedAt.getTime()).toBeGreaterThan(old.updatedAt.getTime())
        gate.release()
        await pending
        expect(deliveries).toBe(0)
        expect((await database.select().from(musicReminder))[0]).toEqual(edited)
        expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([])
        await Effect.runPromise(withTestLayer(processReminderJob('scheduled'), layer))
        expect(deliveries).toBe(0)
        clock.advance(60_000)
        expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([
          { id: 'scheduled', reminderDate: future },
        ])
        expect(await Effect.runPromise(withTestLayer(claimReminder('scheduled'), layer))).toEqual({
          claimed: true,
        })
        const [current] = await database.select().from(musicReminder)

        if (!current) throw new Error('Missing new claim')
        expect(current.updatedAt.getTime()).toBeGreaterThan(edited.updatedAt.getTime())
        await Effect.runPromise(withTestLayer(sendClaimedReminder(old), layer))
        expect(deliveries).toBe(0)
        await Effect.runPromise(withTestLayer(sendClaimedReminder(current), layer))
        await Effect.runPromise(withTestLayer(processReminderJob('scheduled'), layer))
        expect(deliveries).toBe(1)
        expect((await database.select().from(musicReminder))[0]).toMatchObject({
          status: REMINDER_STATUS.SENT,
          isSent: true,
        })
      } finally {
        gate.release()
        await pending
      }
    },
  )

  test.each([
    ['success', 'pending'],
    ['failure', 'pending'],
    ['success', 'processing'],
    ['failure', 'processing'],
    ['success', 'sent'],
    ['failure', 'sent'],
  ] as const)(
    'an already-started provider %s cannot overwrite rescheduled %s ownership',
    async (oldOutcome, newState) => {
      await using resource = await createMigratedD1Database()
      const clock = reminderClock(1_000_000)
      const databaseLayer = DatabaseLayer(resource.database)
      const database = Effect.runSync(withTestLayer(Database, databaseLayer))
      await database
        .insert(user)
        .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
      await database.insert(musicReminder).values(fixture)
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      let deliveries = 0

      const delivery = Layer.succeed(EmailDelivery, {
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
      })

      const layer = Layer.mergeAll(databaseLayer, clock.layer, delivery)

      const updates = MusicReminderServiceLayer.pipe(
        Layer.provide(databaseLayer),
        Layer.provideMerge(clock.layer),
      )

      const pending = Effect.runPromise(withTestLayer(processReminderJob('scheduled'), layer))

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

        const edited = await Effect.runPromise(
          withTestLayer(reschedule(new Date(clock.now() + 60_000)), updates),
        )

        expect(edited.status).toBe(REMINDER_STATUS.PENDING)

        if (newState !== 'pending') {
          clock.advance(60_000)

          if (newState === 'sent')
            await Effect.runPromise(withTestLayer(processReminderJob('scheduled'), layer))
          else await Effect.runPromise(withTestLayer(claimReminder('scheduled'), layer))
        }

        const [before] = await database.select().from(musicReminder)
        expect(before?.status).toBe(newState)
        released.resolve()
        expect(await outcome).toBe(oldOutcome)
        expect((await database.select().from(musicReminder))[0]).toEqual(before)
      } finally {
        released.resolve()
        await outcome
      }
    },
  )

  test('editing the schedule of a sent reminder does not reopen it', async () => {
    await using resource = await createMigratedD1Database()
    const clock = reminderClock(1_000_000)
    const databaseLayer = DatabaseLayer(resource.database)
    const database = Effect.runSync(withTestLayer(Database, databaseLayer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
    await database
      .insert(musicReminder)
      .values({ ...fixture, status: REMINDER_STATUS.SENT, isSent: true })

    const updates = MusicReminderServiceLayer.pipe(
      Layer.provide(databaseLayer),
      Layer.provideMerge(clock.layer),
    )

    const edited = await Effect.runPromise(
      withTestLayer(reschedule(new Date(clock.now() + 60_000)), updates),
    )

    expect(edited).toMatchObject({ status: REMINDER_STATUS.SENT, isSent: true })
  })
})
