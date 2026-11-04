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
import * as Sentry from '@sentry/react-native'
import { Effect, Layer } from 'effect'
import { AppState } from 'react-native'

const config = telemetryConfig({
  application: 'mobile',
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: process.env.EXPO_PUBLIC_SENTRY_ENABLED,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  release: process.env.EXPO_PUBLIC_SENTRY_RELEASE,
  development: __DEV__,
})

if (config.enabled) {
  Sentry.init({
    ...config,
    sendDefaultPii: false,
    sampleRate: 1,
    enableAutoSessionTracking: true,
    enableNativeCrashHandling: true,
    enableNetworkBreadcrumbs: false,
    enableAutoBreadcrumbTracking: false,
    enableNetworkEventBreadcrumbs: false,
    enableSystemEventBreadcrumbs: false,
    enableCaptureFailedRequests: false,
    enableAutoConsoleLogs: false,
    enableLogs: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 30,
    maxQueueSize: 30,
    tracePropagationTargets: [],
    integrations: [Sentry.expoRouterIntegration()],
    beforeBreadcrumb: safeBreadcrumb,
    beforeSend: sanitizeError,
    beforeSendSpan: safeSpan,
    beforeSendTransaction: sanitizeTransaction,
    beforeSendMetric: safeMetric,
  })
}

const flush = () => Promise.resolve(Sentry.getClient()?.flush(2000)).catch(() => false)

const lifecycle = Layer.effectDiscard(
  Effect.gen(function* () {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush()
    })

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        subscription.remove()
        await flush()
      }),
    )
  }),
)

export const mobileObservabilityLayer = config.enabled
  ? observabilityLayer.pipe(
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
  : disabledObservabilityLayer

export const instrumentRoot = Sentry.wrap
