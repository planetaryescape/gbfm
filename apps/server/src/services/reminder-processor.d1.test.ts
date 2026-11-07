import type { D1Database } from '@cloudflare/workers-types'
import { REMINDER_STATUS } from '@gbfm/core/status'
import { eq, sql } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { emailDeliveryLogsTable } from '@/db/email.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { ConfigService, createConfig, type WorkerConfigBindings } from '@/services/config.service'
import { EmailDelivery, EmailDeliveryLive } from '@/services/email-delivery.service'
import {
  EmailTransport,
  EmailUnavailable,
  type OutboundEmailMessage,
} from '@/services/email-transport.service'
import {
  claimReminder,
  findReminderById,
  processPendingReminders,
  processReminderJob,
  queryDueReminders,
  sendClaimedReminder,
} from '@/services/reminder-processor'
import { withTestLayer } from '@/test/effect'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { reminderClock } from '@/test/reminder-clock'

const workerBindings = (): WorkerConfigBindings => ({
  APP_STAGE: 'test',
  USER_CONTENT_BUCKET_NAME: 'user-content',
  MIXES_BUCKET_NAME: 'mixes',
  EMAIL_SENDER: 'noreply@mail.goosebumps.fm',
  SpotifyClientId: 'configured',
  SpotifyClientSecret: 'configured',
  SENTRY_BACKEND_DSN: 'configured',
  VITE_PUBLIC_SENTRY_DSN: 'configured',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'configured',
  OTEL_EXPORTER_OTLP_HEADERS: 'configured',
  CloudflareAnalyticsApiToken: 'test-analytics-token',
  BETTER_AUTH_SECRET: 'configured',
  BETTER_AUTH_URL: 'configured',
  StorageProvider: 'aws',
  StorageEndpoint: 'configured',
  StorageRegion: 'configured',
  StorageAccessKeyId: 'configured',
  StorageSecretAccessKey: 'configured',
  StorageSigningEndpoint: 'configured',
})

const reminderLayer = (d1: D1Database, messages: Array<OutboundEmailMessage>, failFirst = true) => {
  let deliveryAttempts = 0
  const database = DatabaseLayer(d1)

  const transport = Layer.succeed(EmailTransport, {
    send: (message) => {
      messages.push(message)
      deliveryAttempts += 1

      return failFirst && deliveryAttempts === 1
        ? Effect.fail(new EmailUnavailable({ providerCode: 'unknown' }))
        : Effect.succeed({ provider: 'cloudflare' as const, messageId: 'reminder-accepted' })
    },
  })

  const delivery = EmailDeliveryLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        database,
        transport,
        Layer.succeed(ConfigService, createConfig(workerBindings())),
      ),
    ),
  )

  return Layer.mergeAll(database, delivery)
}

describe('reminder queue delivery', () => {
  test('provider acceptance without a persisted receipt remains ambiguous and recovery may duplicate mail', async () => {
    await using resource = await createMigratedD1Database()
    const clock = reminderClock()
    const messages: Array<OutboundEmailMessage> = []

    const layer = reminderLayer(resource.database, messages, false).pipe(
      Layer.provideMerge(clock.layer),
    )

    const database = Effect.runSync(withTestLayer(Database, layer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'l@example.test' })
    await database.insert(musicReminder).values({
      id: 'pending',
      userId: 'listener',
      musicTitle: 'Mix',
      artistName: 'Artist',
      musicUrl: 'https://example.test/mix',
      reminderDate: new Date(0),
    })
    await database.run(
      sql`CREATE TRIGGER reject_receipt BEFORE UPDATE ON email_delivery_logs WHEN NEW.status = 'SENT' BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END`,
    )
    await expect(
      Effect.runPromise(withTestLayer(processReminderJob('pending'), layer)),
    ).rejects.toMatchObject({ stage: 'email' })
    expect(messages).toHaveLength(1)
    expect((await database.select().from(emailDeliveryLogsTable))[0]?.status).toBe('PENDING')
    expect((await database.select().from(musicReminder))[0]?.status).toBe(REMINDER_STATUS.FAILED)
    expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([])
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    expect(messages).toHaveLength(1)
    await database.run(sql`DROP TRIGGER reject_receipt`)
    clock.advance()
    expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toHaveLength(1)
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    expect(messages).toHaveLength(2)
    expect(
      (await database.select().from(emailDeliveryLogsTable)).map((log) => log.status).sort(),
    ).toEqual(['PENDING', 'SENT'])
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.SENT,
      isSent: true,
    })
  })

  test('a reminder removed after its claim finishes successfully without sending stale work', async () => {
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
    const gate = gatedPostDatabase(resource.database, 'before', /^select .*from "music_reminder"/i)
    const messages: Array<OutboundEmailMessage> = []

    const pending = Effect.runPromise(
      withTestLayer(processReminderJob('pending'), reminderLayer(gate.database, messages)),
    )

    try {
      await Promise.race([
        gate.reached,
        pending.then(() => {
          throw new Error('Expected reminder read gate')
        }),
      ])
      expect((await database.select().from(musicReminder))[0]?.status).toBe(
        REMINDER_STATUS.PROCESSING,
      )
      await database.delete(musicReminder).where(eq(musicReminder.id, 'pending'))
      gate.release()
      expect(await pending).toBeUndefined()
      expect(messages).toHaveLength(0)
    } finally {
      gate.release()
      await pending
    }
  })

  test('interruption leaves a processing claim that queue redelivery skips rather than reclaiming', async () => {
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
    let attempts = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()

        const delivery = Layer.succeed(EmailDelivery, {
          deliver: () =>
            Effect.sync(() => {
              attempts += 1
            }).pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Effect.never),
            ),
        })

        const layer = Layer.mergeAll(DatabaseLayer(resource.database), delivery)

        const fiber = yield* withTestLayer(processReminderJob('pending'), layer).pipe(
          Effect.forkChild,
        )

        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        yield* withTestLayer(processReminderJob('pending'), layer)
      }),
    )
    expect(attempts).toBe(1)
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.PROCESSING,
      isSent: false,
    })
  })

  test('cron discovers stalled processing and queue recovery shares the bounded legacy helper', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))
    const messages: Array<OutboundEmailMessage> = []
    const layer = reminderLayer(resource.database, messages)
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
    await database.insert(musicReminder).values({
      id: 'stalled',
      userId: 'listener',
      musicTitle: 'Mix',
      artistName: 'Artist',
      musicUrl: 'https://example.test/mix',
      reminderDate: new Date(0),
      updatedAt: new Date(0),
      status: REMINDER_STATUS.PROCESSING,
    })

    expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([
      { id: 'stalled', reminderDate: new Date(0) },
    ])
    await expect(
      Effect.runPromise(withTestLayer(processReminderJob('stalled'), layer)),
    ).rejects.toMatchObject({ stage: 'email' })
    await Effect.runPromise(withTestLayer(processReminderJob('missing'), layer))
    expect(messages).toHaveLength(1)

    await Effect.runPromise(withTestLayer(processPendingReminders, layer))
    expect(messages).toHaveLength(1)
    expect((await database.select().from(musicReminder))[0]?.status).toBe(REMINDER_STATUS.FAILED)
  })

  test('concurrent claim attempts give ownership to only one invocation', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))
    const layer = DatabaseLayer(resource.database)
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

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        Effect.runPromise(withTestLayer(claimReminder('pending'), layer)),
      ),
    )

    expect(results.filter((result) => result.claimed)).toHaveLength(1)
    expect(results.filter((result) => !result.claimed)).toHaveLength(4)
  })

  test('accepted delivery with a failed reminder update retries and sends a duplicate', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))
    const messages: Array<OutboundEmailMessage> = []
    const clock = reminderClock()
    const layer = reminderLayer(resource.database, messages).pipe(Layer.provideMerge(clock.layer))
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
    await expect(
      Effect.runPromise(withTestLayer(processReminderJob('pending'), layer)),
    ).rejects.toMatchObject({ stage: 'email' })
    clock.advance()
    await database.run(
      sql`CREATE TRIGGER reject_sent BEFORE UPDATE ON music_reminder WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'fixture sent failure'); END`,
    )
    await expect(
      Effect.runPromise(withTestLayer(processReminderJob('pending'), layer)),
    ).rejects.toMatchObject({ stage: 'update' })
    expect((await database.select().from(musicReminder))[0]?.status).toBe(REMINDER_STATUS.FAILED)
    expect(
      (await database.select().from(emailDeliveryLogsTable)).filter((log) => log.status === 'SENT'),
    ).toHaveLength(1)
    await database.run(sql`DROP TRIGGER reject_sent`)
    clock.advance()
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    expect(messages).toHaveLength(3)
    expect(
      (await database.select().from(emailDeliveryLogsTable)).filter((log) => log.status === 'SENT'),
    ).toHaveLength(2)
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.SENT,
      isSent: true,
    })
  })

  test('reclaims a failed delivery on queue retry and persists the accepted receipt', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const messages: Array<OutboundEmailMessage> = []
    const clock = reminderClock()
    const layer = reminderLayer(d1, messages).pipe(Layer.provideMerge(clock.layer))
    const userId = crypto.randomUUID()
    const reminderId = crypto.randomUUID()

    await database.insert(user).values({
      id: userId,
      name: 'Reminder listener',
      email: 'reminder-listener@example.com',
    })
    await database.insert(musicReminder).values({
      id: reminderId,
      userId,
      musicTitle: 'A reminder mix',
      artistName: 'Guide Fari',
      musicUrl: 'https://goosebumps.fm/mixes/a-reminder-mix',
      reminderDate: new Date(Date.now() - 1_000),
    })

    const firstClaim = await Effect.runPromise(withTestLayer(claimReminder(reminderId), layer))

    const firstReminder = await Effect.runPromise(
      withTestLayer(findReminderById(reminderId), layer),
    )

    if (!firstReminder) throw new Error('Test reminder was not found after its first claim')

    await expect(
      Effect.runPromise(withTestLayer(sendClaimedReminder(firstReminder), layer)),
    ).rejects.toMatchObject({ stage: 'email' })

    const failedReminder = await database
      .select()
      .from(musicReminder)
      .where(eq(musicReminder.id, reminderId))

    const failedLogs = await database.select().from(emailDeliveryLogsTable)

    expect(firstClaim).toEqual({ claimed: true })
    expect(failedReminder[0]).toMatchObject({ status: REMINDER_STATUS.FAILED, isSent: false })
    expect(failedLogs).toEqual([
      expect.objectContaining({ status: 'FAILED', failureCategory: 'unavailable' }),
    ])

    clock.advance()
    const retryClaim = await Effect.runPromise(withTestLayer(claimReminder(reminderId), layer))

    const retryReminder = await Effect.runPromise(
      withTestLayer(findReminderById(reminderId), layer),
    )

    if (!retryReminder) throw new Error('Test reminder was not found after its retry claim')

    await Effect.runPromise(withTestLayer(sendClaimedReminder(retryReminder), layer))

    const [sentReminder] = await database
      .select()
      .from(musicReminder)
      .where(eq(musicReminder.id, reminderId))

    const logs = await database.select().from(emailDeliveryLogsTable)

    expect(retryClaim).toEqual({ claimed: true })
    expect(messages).toHaveLength(2)
    expect(sentReminder).toMatchObject({ status: REMINDER_STATUS.SENT, isSent: true })
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'FAILED', failureCategory: 'unavailable' }),
        expect.objectContaining({
          status: 'SENT',
          provider: 'cloudflare',
          providerMessageId: 'reminder-accepted',
        }),
      ]),
    )
  })
})
