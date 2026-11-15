import type * as Sentry from '@sentry/cloudflare'
import { Data, Effect, Predicate } from 'effect'

import type { SecretBinding } from '@/services/secrets-store.service'

type SentryBindings = { readonly SENTRY_DSN?: SecretBinding }

type Resolved<Env> = Omit<Env, 'SENTRY_DSN'> & { readonly SENTRY_DSN?: string }

type Worker<Env, Message> = Pick<
  ReturnType<typeof Sentry.withSentry<Env, Message>>,
  'fetch' | 'scheduled' | 'queue'
>

class SentrySecretUnavailable extends Data.TaggedError('SentrySecretUnavailable') {}

export const resolveWorkerSentryBindings = <Env extends SentryBindings>(
  env: Env,
): Effect.Effect<Resolved<Env>> => {
  const { SENTRY_DSN: binding, ...rest } = env

  if (binding === undefined) return Effect.succeed(rest)

  if (Predicate.isString(binding)) return Effect.succeed({ ...rest, SENTRY_DSN: binding })

  return Effect.tryPromise({
    try: () => binding.get(),
    catch: () => new SentrySecretUnavailable(),
  }).pipe(
    Effect.map((dsn) => ({ ...rest, SENTRY_DSN: dsn })),
    Effect.catchTag('SentrySecretUnavailable', () =>
      Effect.as(Effect.logWarning('sentry.secret.unavailable'), rest),
    ),
  )
}

export const withResolvedWorkerSentryBindings = <Env extends SentryBindings, Message>(
  worker: Worker<Resolved<Env>, Message>,
): Worker<Env, Message> => {
  const resolved: Worker<Env, Message> = {}

  if (worker.fetch) {
    const fetch = worker.fetch
    resolved.fetch = async (request, env, context) =>
      fetch.call(
        worker,
        request,
        await Effect.runPromise(resolveWorkerSentryBindings(env)),
        context,
      )
  }

  if (worker.scheduled) {
    const scheduled = worker.scheduled
    resolved.scheduled = async (controller, env, context) =>
      scheduled.call(
        worker,
        controller,
        await Effect.runPromise(resolveWorkerSentryBindings(env)),
        context,
      )
  }

  if (worker.queue) {
    const queue = worker.queue
    resolved.queue = async (batch, env, context) =>
      queue.call(worker, batch, await Effect.runPromise(resolveWorkerSentryBindings(env)), context)
  }

  return resolved
}
