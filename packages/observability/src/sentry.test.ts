import * as Sentry from '@sentry/browser'
import type { Envelope } from '@sentry/core'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { expect, test } from 'vitest'

import { Observability, observabilityLayer } from './observability'
import { safeBreadcrumb, safeMetric, safeSpan, sanitizeError, sanitizeTransaction } from './privacy'
import { sentryExporterLayer } from './sentry'

test.each([false, true])(
  'Sentry exports bounded signals and reviewed failures when counters throw: %s',
  async (counterUnavailable) => {
    const envelopes: Array<Envelope> = []
    Sentry.init({
      dsn: 'https://abc123@o1.ingest.sentry.io/123',
      release: 'gbfm-www@0123456789abcdef0123456789abcdef01234567',
      environment: 'development',
      defaultIntegrations: false,
      integrations: [
        Sentry.browserTracingIntegration({
          instrumentPageLoad: false,
          instrumentNavigation: false,
        }),
      ],
      tracesSampleRate: 1,
      sampleRate: 1,
      beforeBreadcrumb: safeBreadcrumb,
      beforeSend: sanitizeError,
      beforeSendSpan: safeSpan,
      beforeSendTransaction: sanitizeTransaction,
      beforeSendMetric: safeMetric,
      transport: () => ({
        send: async (envelope) => {
          envelopes.push(envelope)

          return { statusCode: 200 }
        },
        flush: async () => true,
      }),
    })

    const runtime = ManagedRuntime.make(
      observabilityLayer.pipe(
        Layer.provide(
          sentryExporterLayer({
            startInactiveSpan: Sentry.startInactiveSpan,
            addBreadcrumb: Sentry.addBreadcrumb,
            captureException: Sentry.captureException,
            metrics: {
              count: counterUnavailable
                ? () => {
                    throw new Error('Metric enqueue failed')
                  }
                : Sentry.metrics.count,
              distribution: Sentry.metrics.distribution,
            },
          }),
        ),
      ),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* Observability
          const success = yield* service.start('playback.start')
          yield* success.finish('succeeded')
          yield* success.finish('failed')
          const failed = yield* service.start('reader.open')
          yield* failed.finish('failed')
          const canceled = yield* service.start('navigation')
          yield* canceled.finish('canceled')
        }),
      )
      const secret = 'synthetic-secret-do-not-export'
      Sentry.captureException(new Error(secret, { cause: new Error(secret) }))
      expect(await Sentry.flush(2000)).toBe(true)
      const payload = JSON.stringify(envelopes)
      expect(payload.includes('gbfm.journey.completed')).toBe(!counterUnavailable)
      expect(payload).toContain('gbfm.journey.duration')
      expect(payload).toContain('ReaderOpenFailed')
      expect(payload).not.toContain('PlaybackStartFailed')
      expect(payload).not.toContain('NavigationFailed')
      expect(payload).not.toContain(secret)
      expect(payload).toContain('gbfm.journey')
      expect(
        envelopes.reduce(
          (total, [, items]) =>
            total + items.filter(([header]) => header.type === 'transaction').length,
          0,
        ),
      ).toBe(3)
    } finally {
      await runtime.dispose()
      await Sentry.close(2000)
    }
  },
)
