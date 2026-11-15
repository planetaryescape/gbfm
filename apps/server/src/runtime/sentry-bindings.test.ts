import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'
import { Effect, Logger } from 'effect'
import { expect, test } from 'vitest'

import { shouldEnableSentry } from '@/lib/sentry'
import { withTestLayer } from '@/test/effect'

import { resolveWorkerSentryBindings, withResolvedWorkerSentryBindings } from './sentry-bindings'

test('a production Secrets Store DSN resolves before the SDK enablement decision', async () => {
  const result = await Effect.runPromise(
    resolveWorkerSentryBindings({
      SENTRY_DSN: { get: async () => 'https://public@example.invalid/1' },
      SENTRY_ENVIRONMENT: 'prod',
      retained: 'application-binding',
    }),
  )

  expect(shouldEnableSentry(result.SENTRY_DSN ?? '', result.SENTRY_ENVIRONMENT)).toBe(true)
  expect(result.retained).toBe('application-binding')
  expect(result.SENTRY_DSN).toBe('https://public@example.invalid/1')
})

test('plain local bindings remain supported and missing bindings stay absent', async () => {
  expect(await Effect.runPromise(resolveWorkerSentryBindings({ SENTRY_DSN: 'local-dsn' }))).toEqual(
    { SENTRY_DSN: 'local-dsn' },
  )
  expect(await Effect.runPromise(resolveWorkerSentryBindings({}))).toEqual({})
})

test('failed telemetry lookups preserve application bindings', async () => {
  const logs: Array<unknown> = []

  const result = await Effect.runPromise(
    withTestLayer(
      resolveWorkerSentryBindings({
        SENTRY_DSN: {
          get: async () => {
            throw new Error('synthetic-secret-do-not-export')
          },
        },
        retained: 'application-binding',
      }),
      Logger.layer([Logger.make(({ message }) => logs.push(message))]),
    ),
  )

  expect(result).toEqual({ retained: 'application-binding' })
  expect(JSON.stringify(logs)).toContain('sentry.secret.unavailable')
  expect(JSON.stringify(logs)).not.toContain('synthetic-secret-do-not-export')
})

test('fetch, scheduled and queue retain lifecycle inputs with resolved bindings', async () => {
  type Env = { SENTRY_DSN: { get(): Promise<string> }; application: object }

  const application = {}
  const received: Array<string> = []
  const pending: Array<Promise<unknown>> = []

  const context = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise)
    },
    passThroughOnException: () => {},
    props: {},
    exports: {},
    abort: () => {},
    get tracing(): never {
      throw new Error('The adapter must preserve the context without reading its tracing property')
    },
  }

  const response = new Response('application response')
  const request = new Request<unknown, IncomingRequestCfProperties>('https://fixture.test')
  const controller = { scheduledTime: 1, cron: '* * * * *', noRetry: () => {} }

  const batch = {
    messages: [],
    queue: 'fixture',
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    ackAll: () => {},
    retryAll: () => {},
  }

  const env: Env = {
    application,
    SENTRY_DSN: { get: async () => 'resolved-dsn' },
  }

  const worker = withResolvedWorkerSentryBindings<Env, unknown>({
    fetch(input, resolved, ctx) {
      expect(input).toBe(request)
      expect(resolved.application).toBe(application)
      expect(ctx).toBe(context)
      received.push(resolved.SENTRY_DSN ?? '')
      ctx.waitUntil(Promise.resolve())

      return response
    },
    async scheduled(input, resolved, ctx) {
      expect(input).toBe(controller)
      expect(ctx).toBe(context)
      received.push(resolved.SENTRY_DSN ?? '')
    },
    async queue(input, resolved, ctx) {
      expect(input).toBe(batch)
      expect(ctx).toBe(context)
      received.push(resolved.SENTRY_DSN ?? '')
    },
  })

  expect(await worker.fetch?.(request, env, context)).toBe(response)
  await worker.scheduled?.(controller, env, context)
  await worker.queue?.(batch, env, context)
  await Promise.all(pending)
  expect(received).toEqual(['resolved-dsn', 'resolved-dsn', 'resolved-dsn'])
  expect(pending).toHaveLength(1)
  expect(withResolvedWorkerSentryBindings<Env, unknown>({})).toEqual({})
})
