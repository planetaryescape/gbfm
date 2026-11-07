import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { REMINDER_STATUS } from '@gbfm/core/status'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { EmailDelivery } from '@/services/email-delivery.service'
import { MusicReminderService, MusicReminderServiceLayer } from '@/services/music-reminder.service'
import { processReminderJob } from '@/services/reminder-processor'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { reminderClock } from '@/test/reminder-clock'

describe('reminder claim read recovery', () => {
  test('post-claim edits deliver the freshly loaded title, URL and notes', async () => {
    await using resource = await createMigratedD1Database()
    const databaseLayer = DatabaseLayer(resource.database)
    const database = Effect.runSync(withTestLayer(Database, databaseLayer))
    await database
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
    await database.insert(musicReminder).values({
      id: 'pending',
      userId: 'listener',
      musicTitle: 'OriginalTitle',
      artistName: 'Artist',
      musicUrl: 'https://example.test/original',
      notes: 'OriginalNotes',
      reminderDate: new Date(0),
    })
    const reached = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()

    class GatedRead implements D1PreparedStatement {
      constructor(readonly statement: D1PreparedStatement) {}
      bind(...values: Parameters<D1PreparedStatement['bind']>): D1PreparedStatement {
        return new GatedRead(this.statement.bind(...values))
      }
      first<T = unknown>(column?: string): Promise<T | null> {
        return column === undefined ? this.statement.first<T>() : this.statement.first<T>(column)
      }
      run<T = unknown>() {
        return this.statement.run<T>()
      }
      all<T = unknown>() {
        return this.statement.all<T>()
      }
      raw<T = Array<unknown>>(options: { columnNames: true }): Promise<[Array<string>, ...Array<T>]>
      raw<T = Array<unknown>>(options?: { columnNames?: false }): Promise<Array<T>>
      async raw<T = Array<unknown>>(options?: {
        columnNames?: boolean
      }): Promise<Array<T> | [Array<string>, ...Array<T>]> {
        reached.resolve()
        await released.promise

        return options?.columnNames
          ? this.statement.raw<T>({ columnNames: true })
          : this.statement.raw<T>()
      }
    }

    const binding = resource.database

    const gated: D1Database = {
      prepare: (query) => {
        const statement = binding.prepare(query)

        return /^select .*from "music_reminder"/i.test(query) ? new GatedRead(statement) : statement
      },
      batch: (statements) => binding.batch(statements),
      exec: (query) => binding.exec(query),
      withSession: (constraint) => binding.withSession(constraint),
      dump: () => binding.dump(),
    }

    const deliveredHtml: Array<string> = []

    const delivery = Layer.succeed(EmailDelivery, {
      deliver: ({ message }) =>
        Effect.sync(() => {
          deliveredHtml.push(message.html)

          return {
            deliveryLogId: 'fixture-delivery',
            provider: 'cloudflare' as const,
            providerMessageId: 'accepted',
            acceptedAt: new Date(0),
          }
        }),
    })

    const pending = Effect.runPromise(
      withTestLayer(processReminderJob('pending'), Layer.mergeAll(DatabaseLayer(gated), delivery)),
    )

    try {
      await Promise.race([
        reached.promise,
        pending.then(() => {
          throw new Error('Expected post-claim SELECT gate')
        }),
      ])
      expect((await database.select().from(musicReminder))[0]?.status).toBe(
        REMINDER_STATUS.PROCESSING,
      )
      await Effect.runPromise(
        withTestLayer(
          Effect.gen(function* () {
            const reminders = yield* MusicReminderService
            yield* reminders.update('pending', 'listener', {
              musicTitle: 'UpdatedTitle',
              musicUrl: 'https://example.test/updated',
              notes: 'UpdatedNotes',
              reminderDate: new Date(0),
            })
          }),
          MusicReminderServiceLayer.pipe(Layer.provide(databaseLayer)),
        ),
      )
      released.resolve()
      await pending
      expect(deliveredHtml).toHaveLength(1)
      expect(deliveredHtml[0]).toContain('UpdatedTitle')
      expect(deliveredHtml[0]).toContain('https://example.test/updated')
      expect(deliveredHtml[0]).toContain('UpdatedNotes')
      expect(deliveredHtml[0]).not.toContain('OriginalTitle')
      expect(deliveredHtml[0]).not.toContain('https://example.test/original')
      expect(deliveredHtml[0]).not.toContain('OriginalNotes')
      expect((await database.select().from(musicReminder))[0]).toMatchObject({
        status: REMINDER_STATUS.SENT,
        isSent: true,
      })
    } finally {
      released.resolve()
      await pending
    }
  })

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

    const clock = reminderClock()

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
    ).pipe(Layer.provideMerge(clock.layer))

    await expect(
      Effect.runPromise(withTestLayer(processReminderJob('pending'), layer)),
    ).rejects.toMatchObject({ stage: 'query' })
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.FAILED,
      isSent: false,
    })
    expect(deliveries).toBe(0)
    clock.advance()
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    await Effect.runPromise(withTestLayer(processReminderJob('pending'), layer))
    expect(deliveries).toBe(1)
    expect((await database.select().from(musicReminder))[0]).toMatchObject({
      status: REMINDER_STATUS.SENT,
      isSent: true,
    })
  })
})
