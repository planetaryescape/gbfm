import * as Sentry from '@sentry/cloudflare'
import { Context, Effect, Layer, Tracer } from 'effect'

import { shouldEnableSentry } from '@/lib/sentry'
import { SentryEnabled } from '@/services/sentry.service'

import { createSentryTracer } from './sentry-tracer'

// The Worker/workerd counterpart to runtime/sentry-bun.ts. @sentry/cloudflare
// initializes by wrapping the exported handler (Sentry.withSentry in
// worker.ts), not by calling init() at module scope, so there is no client to
// hold here -- only the enabled flag, read from per-request env instead of
// process.env/sst Resource (neither exists on workerd).
export interface WorkerSentryEnvironment {
  readonly dsn: string | undefined
  readonly environment: string | undefined
}

export class WorkerSentryEnv extends Context.Service<WorkerSentryEnv, WorkerSentryEnvironment>()(
  'WorkerSentryEnv',
) {}

export const WorkerSentryEnabledLive = Layer.effect(
  SentryEnabled,
  Effect.gen(function* () {
    const { dsn, environment } = yield* WorkerSentryEnv

    return { enabled: shouldEnableSentry(dsn ?? '', environment ?? 'development') }
  }),
)

export const WorkerTracingLive = Layer.sync(Tracer.Tracer, () =>
  Sentry.isEnabled() ? createSentryTracer() : Tracer.nativeTracer,
)
