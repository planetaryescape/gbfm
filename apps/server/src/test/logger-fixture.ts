import * as Sentry from '@sentry/bun'
import { Cause, Effect, Layer, ManagedRuntime, References } from 'effect'

import { ConfigService, createConfig } from '../services/config.service'
import { AppLoggerLive } from '../services/logger.service'

const [nodeEnv = 'production', logLevel, scenario = 'levels'] = process.argv.slice(2)

const envelopes: Array<unknown> = []

Sentry.init({
  dsn: 'https://public@example.invalid/1',
  defaultIntegrations: false,
  integrations: [],
  enableLogs: true,
  tracesSampleRate: 1,
  transport: () => ({
    send: async (envelope) => {
      if (scenario === 'transport-failure') throw new Error('synthetic transport unavailable')
      envelopes.push(envelope)

      return { statusCode: 200 }
    },
    flush: async () => true,
  }),
})

const config = createConfig()

const logger = AppLoggerLive.pipe(
  Layer.provide(
    Layer.succeed(ConfigService, {
      ...config,
      app: { ...config.app, nodeEnv, logLevel: logLevel === 'default' ? undefined : logLevel },
    }),
  ),
)

const runtime = ManagedRuntime.make(
  Layer.merge(logger, Layer.succeed(References.MinimumLogLevel, 'All')),
)

const sensitive = {
  password: 'synthetic-password',
  accessToken: 'synthetic-access-token',
  refreshToken: 'synthetic-refresh-token',
  spotifyAccessToken: 'synthetic-spotify-token',
  betterAuthSession: 'synthetic-session',
  req: { headers: { authorization: 'synthetic-authorization', cookie: 'synthetic-cookie' } },
  nested: { customerEmail: 'synthetic-email', values: [{ secret: 'synthetic-secret' }] },
  safe: 'kept',
}

const program = Effect.gen(function* () {
  if (scenario === 'privacy') {
    yield* Effect.logWarning('fixture.privacy', sensitive).pipe(
      Effect.annotateLogs({ context: sensitive, email: 'synthetic-annotation-email' }),
    )
    yield* Effect.logError('fixture.cause', Cause.fail(sensitive))

    return
  }

  yield* Effect.logTrace('fixture.trace')
  yield* Effect.logDebug('fixture.debug')
  yield* Effect.logInfo('fixture.info', { count: 2 })
  yield* Effect.logWarning('fixture.warn').pipe(
    Effect.annotateLogs({ operation: 'fixture.operation', requestId: 'fixture-request' }),
  )
  yield* Effect.logError('fixture.error')
  yield* Effect.logFatal('fixture.fatal')
})

await Sentry.startSpan({ name: 'fixture.span' }, () => runtime.runPromise(program))

await runtime.dispose()

await Sentry.flush(2_000)

await Sentry.close(2_000)

process.stderr.write(`${JSON.stringify(envelopes)}\n`)
