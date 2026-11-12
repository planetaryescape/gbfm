import * as Sentry from '@sentry/cloudflare'

import worker from './logger-worker'

const envelopes: Array<unknown> = []

export default Sentry.withSentry(
  () => ({
    dsn: 'https://public@example.invalid/1',
    defaultIntegrations: false,
    integrations: [],
    enableLogs: true,
    tracesSampleRate: 1,
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope)

        return { statusCode: 200 }
      },
      flush: async () => true,
    }),
  }),
  {
    async fetch(request: Request) {
      envelopes.length = 0

      const response = await Sentry.startSpan({ name: 'worker.logger' }, () =>
        worker.fetch(request),
      )

      const logs = await response.json()
      await Sentry.flush(2_000)

      return Response.json({ logs, envelopes })
    },
  },
)
