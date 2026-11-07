import { eq, sql } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { CommandAuthority } from '@/mcp/command-authority'
import { McpOperationStoreLayer } from '@/mcp/operations/store'
import { ReminderCommandService, ReminderCommandServiceLayer } from '@/mcp/reminders/service'
import { EmailDelivery, EmailDeliveryUnavailable } from '@/services/email-delivery.service'
import {
  processReminderJob,
  queryDueReminders,
  sendClaimedReminder,
} from '@/services/reminder-processor'
import { withTestLayer } from '@/test/effect'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { reminderClock } from '@/test/reminder-clock'

const id = '11111111-1111-4111-8111-111111111111'

const receipt = {
  deliveryLogId: 'fixture',
  provider: 'cloudflare' as const,
  providerMessageId: 'accepted',
  acceptedAt: new Date(0),
}

const fixture = async () => {
  const resource = await createMigratedD1Database()
  const databaseLayer = DatabaseLayer(resource.database)
  const db = Effect.runSync(withTestLayer(Database, databaseLayer))
  const clock = reminderClock(1_000_000)
  await db.insert(user).values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
  await db.insert(musicReminder).values({
    id,
    userId: 'listener',
    musicTitle: 'Mix',
    artistName: 'Artist',
    musicUrl: 'https://example.test',
    reminderDate: new Date(0),
    updatedAt: new Date(0),
  })

  const commands = ReminderCommandServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(databaseLayer, McpOperationStoreLayer(resource.database))),
    Layer.provideMerge(clock.layer),
  )

  const authority = CommandAuthority.of({
    checkpoint: () =>
      Effect.succeed({
        actorId: 'listener',
        clientId: 'fixture',
        resource: 'https://api.test/api',
        liveGuard: sql`EXISTS (SELECT 1 FROM user WHERE id='listener')`,
      }),
  })

  const edit = (date: Date) =>
    Effect.flatMap(ReminderCommandService, (service) =>
      service.execute({
        operation: 'reschedule_music_reminder',
        input: {
          requestId: crypto.randomUUID(),
          reminderId: id,
          expectedRevision: 1,
          reminderDate: date.toISOString(),
        },
      }),
    ).pipe(Effect.provideService(CommandAuthority, authority))

  return { ...resource, databaseLayer, db, clock, commands, edit }
}

describe('guarded reminder schedule ownership on local D1', () => {
  test.each([
    ['before the fresh reminder read', /^select .*from "music_reminder"/i],
    ['before the dispatch fence', /^update "music_reminder" set "dispatch_state"/i],
  ] as const)(
    'rescheduling %s suppresses old delivery and recovers at the new due time',
    async (_, pattern) => {
      await using f = await fixture()
      let deliveries = 0

      const delivery = Layer.succeed(EmailDelivery, {
        deliver: () =>
          Effect.sync(() => {
            deliveries += 1

            return receipt
          }),
      })

      const layer = Layer.mergeAll(f.databaseLayer, f.clock.layer, delivery)
      const gate = gatedPostDatabase(f.database, 'before', pattern)

      const pending = Effect.runPromise(
        withTestLayer(
          processReminderJob(id),
          Layer.mergeAll(DatabaseLayer(gate.database), f.clock.layer, delivery),
        ),
      )

      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error('Expected delivery preparation gate')
          }),
        ])
        const [old] = await f.db.select().from(musicReminder)

        if (!old) throw new Error('Missing old claim')
        const future = new Date(f.clock.now() + 60_000)
        expect(await Effect.runPromise(withTestLayer(f.edit(future), f.commands))).toMatchObject({
          commandRevision: 2,
          dispatchState: 'open',
        })
        gate.release()
        await pending
        expect(deliveries).toBe(0)
        expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([])
        f.clock.advance(60_000)
        expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([
          { id, reminderDate: future },
        ])
        await Effect.runPromise(withTestLayer(sendClaimedReminder(old), layer))
        expect(deliveries).toBe(0)
        await Effect.runPromise(withTestLayer(processReminderJob(id), layer))
        await Effect.runPromise(withTestLayer(processReminderJob(id), layer))
        expect(deliveries).toBe(1)
        expect((await f.db.select().from(musicReminder))[0]).toMatchObject({
          status: 'sent',
          dispatchState: 'accepted',
          commandRevision: 2,
        })
      } finally {
        gate.release()
        await pending
      }
    },
  )

  test.each(['success', 'failure'] as const)(
    'an in-flight provider %s cannot be recalled by rescheduling',
    async (outcome) => {
      await using f = await fixture()
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()

      const delivery = Layer.succeed(EmailDelivery, {
        deliver: () =>
          Effect.gen(function* () {
            entered.resolve()
            yield* Effect.promise(() => released.promise)

            if (outcome === 'failure') return yield* new EmailDeliveryUnavailable()

            return receipt
          }),
      })

      const layer = Layer.mergeAll(f.databaseLayer, f.clock.layer, delivery)
      const pending = Effect.runPromise(withTestLayer(Effect.result(processReminderJob(id)), layer))

      try {
        await entered.promise
        const [before] = await f.db.select().from(musicReminder)
        expect(
          await Effect.runPromise(
            withTestLayer(Effect.flip(f.edit(new Date(f.clock.now() + 60_000))), f.commands),
          ),
        ).toMatchObject({
          code: 'conflict',
          message: expect.stringContaining('delivery_may_have_started'),
        })
        expect((await f.db.select().from(musicReminder))[0]).toEqual(before)
        released.resolve()
        await pending
        expect((await f.db.select().from(musicReminder))[0]).toMatchObject({
          dispatchState: outcome === 'success' ? 'accepted' : 'fenced',
          commandRevision: 1,
        })
      } finally {
        released.resolve()
        await pending
      }
    },
  )

  test('editing a sent reminder is rejected rather than reopening it', async () => {
    await using f = await fixture()
    await f.db
      .update(musicReminder)
      .set({ status: 'sent', isSent: true, dispatchState: 'accepted' })
      .where(eq(musicReminder.id, id))
    expect(
      await Effect.runPromise(
        withTestLayer(Effect.flip(f.edit(new Date(f.clock.now() + 60_000))), f.commands),
      ),
    ).toMatchObject({ code: 'conflict' })
    expect((await f.db.select().from(musicReminder))[0]).toMatchObject({
      status: 'sent',
      isSent: true,
      commandRevision: 1,
    })
  })
})
