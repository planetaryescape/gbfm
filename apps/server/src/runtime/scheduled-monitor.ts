import { Effect, Exit } from 'effect'

import { sitemapRegenerationCron } from '@/scheduled'
import { SentryService } from '@/services/sentry.service'

export const withSitemapCheckIn = <A, E, R>(job: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sentry = yield* SentryService

    const checkInId = yield* sentry
      .startCheckIn('sitemap-regeneration', {
        schedule: { type: 'crontab', value: sitemapRegenerationCron },
        timezone: 'UTC',
        checkinMargin: 5,
        maxRuntime: 10,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      })
      .pipe(Effect.catchDefect(() => Effect.succeed(undefined)))

    return yield* job.pipe(
      Effect.onExit((exit) =>
        checkInId === undefined
          ? Effect.void
          : sentry
              .finishCheckIn(
                'sitemap-regeneration',
                checkInId,
                Exit.isSuccess(exit) ? 'ok' : 'error',
              )
              .pipe(Effect.catchDefect(() => Effect.void)),
      ),
    )
  })

export const reportScheduledFailure = Effect.fn('ScheduledJobs.reportFailure')(function* (
  job: string,
  cause: unknown,
) {
  const sentry = yield* SentryService

  yield* sentry
    .captureException(cause, { operation: 'worker.scheduled', job })
    .pipe(Effect.catchDefect(() => Effect.void))
})
