import { Cause, Effect, Layer, ManagedRuntime } from 'effect'
import { TestConsole } from 'effect/testing'

import { ConfigService, createConfig } from '../services/config.service'
import { AppLoggerLive } from '../services/logger.service'

export default {
  async fetch(request: Request) {
    const config = createConfig()

    const logger = AppLoggerLive.pipe(
      Layer.provide(
        Layer.succeed(ConfigService, {
          ...config,
          app: { ...config.app, nodeEnv: new URL(request.url).pathname.slice(1) },
        }),
      ),
    )

    const runtime = ManagedRuntime.make(Layer.merge(logger, TestConsole.layer))

    try {
      const logs = await runtime.runPromise(
        Effect.gen(function* () {
          yield* Effect.logInfo('worker.info')
          yield* Effect.logWarning('worker.warning', {
            safe: 'kept',
            nested: { refreshToken: 'synthetic-worker-token' },
          }).pipe(Effect.annotateLogs({ session: 'synthetic-worker-session' }))
          yield* Effect.logError(
            'worker.error',
            Cause.fail({ nested: { email: 'synthetic-worker-email' } }),
          )

          return yield* TestConsole.logLines
        }),
      )

      return Response.json(logs)
    } finally {
      await runtime.dispose()
    }
  },
}
