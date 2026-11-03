import type { D1Database } from '@cloudflare/workers-types'
import { buildWelcomeEmail } from '@gbfm/email/index'
import { sql } from 'drizzle-orm'
import { Clock, Deferred, Effect, Fiber, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import { emailDeliveryLogsTable } from '@/db/email.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import {
  createPendingEmailDeliveryLog,
  EmailDeliveryLogTransitionError,
  markEmailDeliveryLogAsFailed,
  markEmailDeliveryLogAsSent,
} from '@/repositories/email-delivery-log.repository'
import { ConfigService, createConfig, type WorkerConfigBindings } from '@/services/config.service'
import {
  EmailDelivery,
  EmailDeliveryPersistenceError,
  EmailDeliveryRejected,
  EmailDeliveryUnavailable,
  EmailDeliveryLive,
} from '@/services/email-delivery.service'
import {
  EmailRejected,
  EmailTransport,
  EmailUnavailable,
  makeRecordingEmailTransport,
  type EmailTransportService,
} from '@/services/email-transport.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

const sender = 'noreply@mail.goosebumps.fm'

const acceptedAt = new Date('2026-07-12T00:00:00.000Z')

const workerBindings = (): WorkerConfigBindings => ({
  APP_STAGE: 'test',
  USER_CONTENT_BUCKET_NAME: 'user-content',
  MIXES_BUCKET_NAME: 'mixes',
  EMAIL_SENDER: sender,
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

const message = () =>
  buildWelcomeEmail({
    to: 'listener@example.com',
    username: 'Listener',
    verificationUrl: 'https://goosebumps.fm/auth/verify-email?token=verify-token',
  })

const fixedClock = Layer.succeed(Clock.Clock, {
  currentTimeMillis: Effect.succeed(acceptedAt.getTime()),
  currentTimeMillisUnsafe: () => acceptedAt.getTime(),
  currentTimeNanos: Effect.succeed(BigInt(acceptedAt.getTime()) * 1_000_000n),
  currentTimeNanosUnsafe: () => BigInt(acceptedAt.getTime()) * 1_000_000n,
  monotonicTimeNanos: Effect.succeed(BigInt(acceptedAt.getTime()) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => BigInt(acceptedAt.getTime()) * 1_000_000n,
  sleep: () => Effect.void,
})

const deliveryLayer = (d1: D1Database, transport: Layer.Layer<EmailTransportService>) =>
  EmailDeliveryLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        DatabaseLayer(d1),
        transport,
        Layer.succeed(ConfigService, createConfig(workerBindings())),
        fixedClock,
      ),
    ),
  )

describe('EmailDelivery', () => {
  test('rejects an empty provider receipt without persisting acceptance', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))

    const transport = Layer.succeed(EmailTransport, {
      send: () => Effect.succeed({ provider: 'cloudflare' as const, messageId: '   ' }),
    })

    const result = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery

          return yield* delivery
            .deliver({ message: yield* message(), emailType: 'TRANSACTIONAL' })
            .pipe(Effect.result)
        }),
        deliveryLayer(resource.database, transport),
      ),
    )

    expect(result).toHaveProperty('failure._tag', 'EmailDeliveryUnavailable')
    expect((await database.select().from(emailDeliveryLogsTable))[0]).toMatchObject({
      status: 'FAILED',
      failureCategory: 'unavailable',
      providerMessageId: null,
      sentAt: null,
    })
  })

  test('provider acceptance followed by persistence failure leaves an ambiguous pending attempt', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))
    await database.run(
      sql`CREATE TRIGGER reject_receipt BEFORE UPDATE ON email_delivery_logs WHEN NEW.status = 'SENT' BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END`,
    )
    const recording = makeRecordingEmailTransport()

    const result = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery

          return yield* delivery
            .deliver({ message: yield* message(), emailType: 'TRANSACTIONAL' })
            .pipe(Effect.result)
        }),
        deliveryLayer(resource.database, recording.layer),
      ),
    )

    expect(result).toHaveProperty('failure.operation', 'mark-sent')
    expect(recording.messages).toHaveLength(1)
    expect((await database.select().from(emailDeliveryLogsTable))[0]).toMatchObject({
      status: 'PENDING',
      providerMessageId: null,
      sentAt: null,
    })
  })

  test('interruption during transport leaves PENDING without manufacturing a failure receipt', async () => {
    await using resource = await createMigratedD1Database()
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(resource.database)))
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()

        const transport = Layer.succeed(EmailTransport, {
          send: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        })

        const fiber = yield* withTestLayer(
          Effect.gen(function* () {
            const delivery = yield* EmailDelivery

            return yield* delivery.deliver({
              message: yield* message(),
              emailType: 'TRANSACTIONAL',
            })
          }),
          deliveryLayer(resource.database, transport),
        ).pipe(Effect.forkChild)

        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
      }),
    )
    expect((await database.select().from(emailDeliveryLogsTable))[0]).toMatchObject({
      status: 'PENDING',
      failureCategory: null,
      sentAt: null,
    })
  })

  test('rejects an invalid sender while composing delivery before inserting PENDING', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const recording = makeRecordingEmailTransport()
    const config = createConfig(workerBindings())

    const invalidSenderLayer = EmailDeliveryLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          DatabaseLayer(d1),
          recording.layer,
          Layer.succeed(ConfigService, {
            ...config,
            auth: { ...config.auth, emailSender: 'noreply' },
          }),
          fixedClock,
        ),
      ),
    )

    await expect(
      Effect.runPromise(withTestLayer(EmailDelivery, invalidSenderLayer)),
    ).rejects.toThrow('Configured email sender must be a full email address')
    await expect(database.select().from(emailDeliveryLogsTable)).resolves.toEqual([])
  })

  test('records provider acceptance through the recording transport and returns its receipt', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const recording = makeRecordingEmailTransport({ messageId: 'recorded-1' })

    const receipt = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery
          const rendered = yield* message()

          return yield* delivery.deliver({
            message: rendered,
            emailType: 'TRANSACTIONAL',
            recipientName: 'Listener',
          })
        }),
        deliveryLayer(d1, recording.layer),
      ),
    )

    const [log] = await database.select().from(emailDeliveryLogsTable)

    expect(recording.messages).toEqual([
      expect.objectContaining({
        from: sender,
        fromName: 'goosebumps.fm',
        to: 'listener@example.com',
      }),
    ])
    expect(receipt).toEqual({
      deliveryLogId: log?.id,
      provider: 'cloudflare',
      providerMessageId: 'recorded-1',
      acceptedAt,
    })
    expect(log).toMatchObject({
      status: 'SENT',
      provider: 'cloudflare',
      providerMessageId: 'recorded-1',
      failureCategory: null,
      sentAt: acceptedAt,
    })
  })

  test('persists PENDING before the transport observes the message', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const observedStatuses: Array<string> = []

    const transport = Layer.succeed(EmailTransport, {
      send: () =>
        Effect.tryPromise({
          try: async () => {
            const [log] = await database.select().from(emailDeliveryLogsTable)

            if (log) observedStatuses.push(log.status)

            return { provider: 'cloudflare' as const, messageId: 'ordered-1' }
          },
          catch: () => new EmailUnavailable({}),
        }),
    })

    await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery
          const rendered = yield* message()

          return yield* delivery.deliver({ message: rendered, emailType: 'TRANSACTIONAL' })
        }),
        deliveryLayer(d1, transport),
      ),
    )

    expect(observedStatuses).toEqual(['PENDING'])
  })

  test('records a safe rejection category and returns a typed delivery failure', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))

    const recording = makeRecordingEmailTransport({
      failure: new EmailRejected({ reason: 'delivery-failed' }),
    })

    const failure = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery
          const rendered = yield* message()

          return yield* Effect.flip(
            delivery.deliver({ message: rendered, emailType: 'TRANSACTIONAL' }),
          )
        }),
        deliveryLayer(d1, recording.layer),
      ),
    )

    const [log] = await database.select().from(emailDeliveryLogsTable)

    expect(failure).toBeInstanceOf(EmailDeliveryRejected)
    expect(JSON.stringify(failure)).not.toContain('listener@example.com')
    expect(JSON.stringify(failure)).not.toContain('Welcome')
    expect(log).toMatchObject({
      status: 'FAILED',
      failureCategory: 'delivery-failed',
      provider: null,
      providerMessageId: null,
    })
  })

  test('does not overwrite terminal delivery-log rows', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))

    const sent = await createPendingEmailDeliveryLog(
      {
        recipientEmail: 'sent@example.com',
        emailType: 'TRANSACTIONAL',
        templateName: 'welcome',
        subject: 'Welcome',
      },
      database,
    )

    const failed = await createPendingEmailDeliveryLog(
      {
        recipientEmail: 'failed@example.com',
        emailType: 'TRANSACTIONAL',
        templateName: 'welcome',
        subject: 'Welcome',
      },
      database,
    )

    await markEmailDeliveryLogAsSent(
      sent.id,
      { provider: 'cloudflare', providerMessageId: 'cf-sent', acceptedAt },
      database,
    )
    await markEmailDeliveryLogAsFailed(failed.id, 'unavailable', acceptedAt, database)

    await expect(
      markEmailDeliveryLogAsFailed(sent.id, 'unavailable', acceptedAt, database),
    ).rejects.toBeInstanceOf(EmailDeliveryLogTransitionError)
    await expect(
      markEmailDeliveryLogAsSent(
        failed.id,
        { provider: 'cloudflare', providerMessageId: 'cf-overwrite', acceptedAt },
        database,
      ),
    ).rejects.toBeInstanceOf(EmailDeliveryLogTransitionError)

    const rows = await database.select().from(emailDeliveryLogsTable)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sent.id, status: 'SENT', providerMessageId: 'cf-sent' }),
        expect.objectContaining({ id: failed.id, status: 'FAILED', providerMessageId: null }),
      ]),
    )
  })

  test('marks unavailable transport failures FAILED before returning an unavailable error', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const recording = makeRecordingEmailTransport({ unavailable: true })

    const failure = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery
          const rendered = yield* message()

          return yield* Effect.flip(
            delivery.deliver({ message: rendered, emailType: 'TRANSACTIONAL' }),
          )
        }),
        deliveryLayer(d1, recording.layer),
      ),
    )

    const [log] = await database.select().from(emailDeliveryLogsTable)

    expect(failure).toBeInstanceOf(EmailDeliveryUnavailable)
    expect(log).toMatchObject({ status: 'FAILED', failureCategory: 'unavailable' })
  })

  test('returns persistence evidence when marking a failed delivery conflicts with a terminal transition', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))

    const conflictingTransport = Layer.succeed(EmailTransport, {
      send: () =>
        Effect.tryPromise({
          try: async () => {
            const [pending] = await database.select().from(emailDeliveryLogsTable)

            if (!pending) throw new Error('Expected a pending delivery log')
            await markEmailDeliveryLogAsSent(
              pending.id,
              { provider: 'cloudflare', providerMessageId: 'conflict-receipt', acceptedAt },
              database,
            )
          },
          catch: () => new EmailUnavailable({ providerCode: 'unknown' }),
        }).pipe(Effect.andThen(Effect.fail(new EmailUnavailable({ providerCode: 'unknown' })))),
    })

    const failure = await Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const delivery = yield* EmailDelivery
          const rendered = yield* message()

          return yield* Effect.flip(
            delivery.deliver({ message: rendered, emailType: 'TRANSACTIONAL' }),
          )
        }),
        deliveryLayer(d1, conflictingTransport),
      ),
    )

    const [log] = await database.select().from(emailDeliveryLogsTable)

    expect(failure).toBeInstanceOf(EmailDeliveryPersistenceError)
    expect(failure).toMatchObject({ operation: 'mark-failed' })
    expect(log).toMatchObject({ status: 'SENT', providerMessageId: 'conflict-receipt' })
  })
})
