import { disabledObservabilityLayer, observabilityLayer } from '@gbfm/observability'
import { telemetryConfig } from '@gbfm/observability/config'
import {
  safeBreadcrumb,
  safeMetric,
  safeSpan,
  sanitizeError,
  sanitizeTransaction,
} from '@gbfm/observability/privacy'
import { tracePropagationTargets } from '@gbfm/observability/propagation'
import { sentryExporterLayer } from '@gbfm/observability/sentry'
import * as Sentry from '@sentry/react-native'
import { Effect, Layer } from 'effect'
import { AppState, NativeModules, Platform } from 'react-native'

import { decodeNativeTelemetry, nativeTelemetryMatches } from './native-readiness'

const config = telemetryConfig({
  application: 'mobile',
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: process.env.EXPO_PUBLIC_SENTRY_ENABLED,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  release: process.env.EXPO_PUBLIC_SENTRY_RELEASE,
  development: __DEV__,
})

const enabled =
  config.enabled &&
  (Platform.OS !== 'ios' ||
    nativeTelemetryMatches(config, decodeNativeTelemetry(NativeModules.GBFMSentryConfiguration)))

if (__DEV__ && config.enabled && !enabled)
  Effect.runSync(
    Effect.logWarning(
      'iOS telemetry disabled: rebuild the native app with the current Sentry configuration.',
    ),
  )

if (enabled) {
  Sentry.init({
    ...config,
    autoInitializeNativeSdk: Platform.OS !== 'ios',
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
    tracePropagationTargets: tracePropagationTargets({
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      development: __DEV__,
    }),
    propagateTraceparent: true,
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

export const mobileObservabilityLayer = enabled
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
