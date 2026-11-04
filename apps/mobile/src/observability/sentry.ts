import * as Sentry from '@sentry/react-native'
import { AppState } from 'react-native'

import { telemetryConfig } from './config'
import type { JourneySink } from './journey'
import { safeBreadcrumb, safeMetric, safeSpan, sanitizeError, sanitizeTransaction } from './privacy'

const config = telemetryConfig({
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

  AppState.addEventListener('change', (state) => {
    if (state !== 'active') void Promise.resolve(Sentry.getClient()?.flush(2000)).catch(() => false)
  })
}

export const mobileJourneys: JourneySink = {
  start: (name) => {
    if (!config.enabled) return () => {}

    const span = Sentry.startInactiveSpan({
      name,
      op: 'gbfm.journey',
      forceTransaction: true,
      attributes: { 'gbfm.operation': name },
    })

    return (outcome, durationMs) => {
      span.setAttribute('gbfm.outcome', outcome)
      span.setStatus({ code: outcome === 'failed' ? 2 : 1 })
      span.end()
      Sentry.addBreadcrumb({ category: 'gbfm.journey', message: name, data: { outcome } })
      const attributes = { operation: name, outcome }
      Sentry.metrics.count('gbfm.journey.completed', 1, { attributes })
      Sentry.metrics.distribution('gbfm.journey.duration', durationMs, {
        unit: 'millisecond',
        attributes,
      })

      if (outcome === 'failed') {
        const error = new Error('Application operation failed')
        error.name = name === 'reader.open' ? 'ReaderOpenFailed' : 'PlaybackStartFailed'
        Sentry.captureException(error)
      }
    }
  },
}
