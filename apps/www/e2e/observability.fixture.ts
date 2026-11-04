import { observeJourney } from '@gbfm/observability'
import { Effect, Exit, ManagedRuntime } from 'effect'

import { webObservabilityLayer } from '../src/observability/sentry'

document.getElementById('run')?.addEventListener('click', async () => {
  const result = document.getElementById('result')
  const runtime = ManagedRuntime.make(webObservabilityLayer)

  try {
    const outcomes = await runtime.runPromise(
      Effect.gen(function* () {
        const value = yield* observeJourney('navigation', Effect.succeed('content-ready'))

        const failure = yield* observeJourney(
          'navigation',
          Effect.fail('synthetic-secret-do-not-export'),
        ).pipe(Effect.exit)

        return { value, failed: Exit.isFailure(failure) }
      }),
    )

    await runtime.dispose()

    if (result) result.textContent = JSON.stringify(outcomes)
  } catch {
    await runtime.dispose()

    if (result) result.textContent = 'Fixture failed'
  }
})
