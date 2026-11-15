import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import * as Sentry from '@sentry/cloudflare'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http'

import { audioTable } from '@/db/audio.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { sanitizeDatabaseSpan } from '@/lib/database-telemetry'
import { WorkerTracingLive } from '@/runtime/sentry-worker'
import { requestWithinServerSpan } from '@/runtime/trace-context'
import { ConfigService, createConfig } from '@/services/config.service'
import { AppLoggerLive } from '@/services/logger.service'

type Bindings = { readonly DB: D1Database; readonly CAPTURE: Fetcher }

const read = Effect.fn('Tracing.read')(function* () {
  const database = yield* Database

  const rows = yield* Effect.promise(() =>
    database.select({ id: audioTable.id }).from(audioTable).limit(1),
  )

  yield* Effect.logWarning('distributed tracing fixture')

  return rows
})

export default Sentry.withSentry<Bindings>(
  (env) => ({
    dsn: 'https://abc123@o1.ingest.sentry.io/123',
    environment: 'test',
    tracesSampleRate: 1,
    enableLogs: true,
    sendDefaultPii: false,
    beforeSendSpan: sanitizeDatabaseSpan,
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        await env.CAPTURE.fetch('https://capture.test/envelope', {
          method: 'POST',
          body: request.body,
        })

        return { statusCode: 200 }
      }),
  }),
  {
    async fetch(request: Request, env: Bindings) {
      const spanId = Sentry.getActiveSpan()?.spanContext().spanId ?? ''

      const route = HttpRouter.add(
        'GET',
        '/api/content/homepage-mixes',
        Effect.gen(function* () {
          const rows = yield* read()

          return yield* HttpServerResponse.json({ rows })
        }),
      ).pipe(
        Layer.provideMerge(DatabaseLayer(env.DB)),
        Layer.provideMerge(WorkerTracingLive),
        Layer.provide(HttpRouter.disableLogger),
        Layer.provideMerge(
          AppLoggerLive.pipe(Layer.provide(Layer.succeed(ConfigService, createConfig()))),
        ),
        Layer.provideMerge(
          Layer.mergeAll(FileSystem.layerNoop({}), Path.layer).pipe(
            Layer.provideMerge(HttpServer.layerServices),
          ),
        ),
      )

      const web = HttpRouter.toWebHandler(route, {})

      try {
        const response = await web.handler(requestWithinServerSpan(request))
        response.headers.set('x-fixture-server-span', spanId)

        return response
      } finally {
        await web.dispose()
      }
    },
  },
)
