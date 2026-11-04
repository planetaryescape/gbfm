import type * as Sentry from '@sentry/core'
import { Effect, Layer } from 'effect'

import { ExportUnavailable, JourneyExporter } from './observability'

type SentryClient = Pick<
  typeof Sentry,
  'startInactiveSpan' | 'addBreadcrumb' | 'captureException'
> & { readonly metrics: Pick<typeof Sentry.metrics, 'count' | 'distribution'> }

const failureNames = {
  'reader.open': 'ReaderOpenFailed',
  'playback.start': 'PlaybackStartFailed',
  navigation: 'NavigationFailed',
}

export const sentryExporterLayer = (client: SentryClient) =>
  Layer.succeed(JourneyExporter, {
    open: (name) =>
      Effect.try({
        try: () => {
          const span = client.startInactiveSpan({
            name,
            op: 'gbfm.journey',
            forceTransaction: true,
            attributes: { 'gbfm.operation': name },
          })

          return {
            finish: (outcome, durationMs) =>
              Effect.try({
                try: () => {
                  span.setAttribute('gbfm.outcome', outcome)
                  span.setStatus({ code: outcome === 'failed' ? 2 : 1 })
                  span.end()
                  client.addBreadcrumb({
                    category: 'gbfm.journey',
                    message: name,
                    data: { outcome },
                  })
                  const attributes = { operation: name, outcome }
                  client.metrics.count('gbfm.journey.completed', 1, { attributes })
                  client.metrics.distribution('gbfm.journey.duration', durationMs, {
                    unit: 'millisecond',
                    attributes,
                  })

                  if (outcome === 'failed') {
                    const error = new Error('Application operation failed')
                    error.name = failureNames[name]
                    client.captureException(error)
                  }
                },
                catch: () => new ExportUnavailable(),
              }),
          }
        },
        catch: () => new ExportUnavailable(),
      }),
  })
