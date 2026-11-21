import { Effect, Fiber, Deferred } from 'effect'
import { expect, test } from 'vitest'

import { reportScheduledFailure, withSitemapCheckIn } from '@/runtime/scheduled-monitor'
import { SentryService } from '@/services/sentry.service'

const recorder = () => {
  const events: Array<string> = []

  const service = SentryService.of({
    captureException: (_cause, context) =>
      Effect.sync(() => {
        events.push(`exception:${context?.job}`)
      }),
    captureMessage: () => Effect.void,
    startCheckIn: (slug, config) =>
      Effect.sync(() => {
        expect(config.schedule).toEqual({ type: 'crontab', value: '0 * * * *' })
        expect(config.timezone).toBe('UTC')
        events.push(`start:${slug}`)

        return 'synthetic-check-in'
      }),
    finishCheckIn: (slug, id, status) =>
      Effect.sync(() => {
        events.push(`finish:${slug}:${id}:${status}`)
      }),
  })

  return { events, service }
}

test('sitemap check-ins bracket success without changing the job result', async () => {
  const fixture = recorder()

  const result = await Effect.runPromise(
    Effect.succeed(42).pipe(
      withSitemapCheckIn,
      Effect.provideService(SentryService, fixture.service),
    ),
  )

  expect(result).toBe(42)
  expect(fixture.events).toEqual([
    'start:sitemap-regeneration',
    'finish:sitemap-regeneration:synthetic-check-in:ok',
  ])
})

test('a failure is reported before the existing caller recovery can turn it into success', async () => {
  const fixture = recorder()
  const failure = new Error('Synthetic job failure')

  const result = await Effect.runPromise(
    Effect.fail(failure).pipe(
      withSitemapCheckIn,
      Effect.tapError((error) => reportScheduledFailure('sitemap-regeneration', error)),
      Effect.catch((error) => Effect.succeed(error)),
      Effect.provideService(SentryService, fixture.service),
    ),
  )

  expect(result).toBe(failure)
  expect(fixture.events).toEqual([
    'start:sitemap-regeneration',
    'finish:sitemap-regeneration:synthetic-check-in:error',
    'exception:sitemap-regeneration',
  ])
})

test('interrupted jobs end their check-in as unsuccessful', async () => {
  const fixture = recorder()
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const job = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      const fiber = yield* Effect.forkChild(job.pipe(withSitemapCheckIn))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.provideService(SentryService, fixture.service)),
  )

  expect(fixture.events).toEqual([
    'start:sitemap-regeneration',
    'finish:sitemap-regeneration:synthetic-check-in:error',
  ])
})

test('disabled or defective telemetry does not stop the scheduled job', async () => {
  const fixture = recorder()

  for (const startCheckIn of [
    () => Effect.succeed(undefined),
    () => Effect.die('Synthetic telemetry defect'),
  ]) {
    const service = SentryService.of({ ...fixture.service, startCheckIn })

    const result = await Effect.runPromise(
      Effect.succeed(42).pipe(withSitemapCheckIn, Effect.provideService(SentryService, service)),
    )

    expect(result).toBe(42)
  }

  const service = SentryService.of({
    ...fixture.service,
    finishCheckIn: () => Effect.die('Synthetic finalization defect'),
    captureException: () => Effect.die('Synthetic capture defect'),
  })

  const result = await Effect.runPromise(
    Effect.fail('job-failed').pipe(
      withSitemapCheckIn,
      Effect.tapError((error) => reportScheduledFailure('sitemap-regeneration', error)),
      Effect.catch((error) => Effect.succeed(error)),
      Effect.provideService(SentryService, service),
    ),
  )

  expect(result).toBe('job-failed')
})
