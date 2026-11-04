import { disabledObservabilityLayer, observabilityLayer } from '@gbfm/observability'
import { telemetryConfig } from '@gbfm/observability/config'
import {
  safeBreadcrumb,
  safeMetric,
  safeSpan,
  sanitizeError,
  sanitizeTransaction,
} from '@gbfm/observability/privacy'
import { sentryExporterLayer } from '@gbfm/observability/sentry'
import * as Sentry from '@sentry/browser'
import { Effect, Layer } from 'effect'

import { browserReaderLayer } from './reader'

const config = telemetryConfig({
  application: 'www',
  dsn: import.meta.env.VITE_PUBLIC_SENTRY_DSN,
  enabled: import.meta.env.VITE_SENTRY_ENABLED,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  release: import.meta.env.VITE_SENTRY_RELEASE ?? `gbfm-www@${import.meta.env.FOLDKIT_BUILD_ID}`,
  development: import.meta.env.DEV,
})

if (config.enabled) {
  Sentry.init({
    ...config,
    sampleRate: 1,
    sendDefaultPii: false,
    enableLogs: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 30,
    tracePropagationTargets: [],
    integrations: [Sentry.browserTracingIntegration({ instrumentNavigation: false })],
    beforeBreadcrumb: safeBreadcrumb,
    beforeSend: sanitizeError,
    beforeSendSpan: safeSpan,
    beforeSendTransaction: sanitizeTransaction,
    beforeSendMetric: safeMetric,
  })
}

const flush = () => Sentry.flush(2000).catch(() => false)

const lifecycle = Layer.effectDiscard(
  Effect.gen(function* () {
    const hide = () => {
      void flush()
    }

    const visibility = () => {
      if (document.visibilityState === 'hidden') hide()
    }

    window.addEventListener('pagehide', hide)
    document.addEventListener('visibilitychange', visibility)
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        window.removeEventListener('pagehide', hide)
        document.removeEventListener('visibilitychange', visibility)
        await flush()
      }),
    )
  }),
)

const signals = observabilityLayer.pipe(
  Layer.provide(
    sentryExporterLayer({
      startInactiveSpan: Sentry.startInactiveSpan,
      addBreadcrumb: Sentry.addBreadcrumb,
      captureException: Sentry.captureException,
      metrics: { count: Sentry.metrics.count, distribution: Sentry.metrics.distribution },
    }),
  ),
  Layer.provide(lifecycle),
)

export const webObservabilityLayer = config.enabled
  ? Layer.merge(signals, browserReaderLayer.pipe(Layer.provide(signals)))
  : disabledObservabilityLayer
