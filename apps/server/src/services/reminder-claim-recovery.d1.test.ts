import type { D1Database } from '@cloudflare/workers-types'
import { REMINDER_STATUS } from '@gbfm/core/status'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { EmailDelivery } from '@/services/email-delivery.service'
import { processReminderJob } from '@/services/reminder-processor'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

describe('reminder claim read recovery', () => {
  test('a failed post-claim read remains retryable and sends once on redelivery', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
    await database.insert(musicReminder).values({
      id: 'pending',
      userId: 'listener',
      musicTitle: 'Mix',
      artistName: 'Artist',
      musicUrl: 'https://example.test/mix',
      reminderDate: new Date(0),
    })
    let failed = false
    const binding = resource.database

    const failingRead: D1Database = {
      prepare: (query) => {
        if (!failed && /^select .*from "music_reminder"/i.test(query)) {
          failed = true
          throw new Error('fixture reminder read unavailable')
        }

        return binding.prepare(query)
      },
      batch: (statements) => binding.batch(statements),
      exec: (query) => binding.exec(query),
      withSession: (constraint) => binding.withSession(constraint),
      dump: () => binding.dump(),
    }

    let deliveries = 0

    const layer = Layer.mergeAll(
      DatabaseLayer(failingRead),
      Layer.succeed(EmailDelivery, {
        deliver: () =>
          Effect.sync(() => {
            deliveries += 1

            return {
              deliveryLogId: 'fixture-delivery',
              provider: 'cloudflare' as const,
              providerMessageId: 'accepted',
              acceptedAt: new Date(0),
            }
          }),
      }),
    )

    await expect(
      Effect.runPromise(withTestLayer(processReminderJob('pending'), layer)),
    ).rejects.toMatchObject({ stage: 'query' })
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.FAILED,
      isSent: false,
    })
    expect(deliveries).toBe(0)
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    expect(deliveries).toBe(1)
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.SENT,
      isSent: true,
    })
  })
})
