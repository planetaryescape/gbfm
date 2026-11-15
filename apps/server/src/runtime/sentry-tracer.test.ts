import * as Sentry from '@sentry/cloudflare'
import { Context, Deferred, Effect, Exit, Fiber, Option, Predicate, Tracer } from 'effect'
import { expect, test } from 'vitest'

import { createSentryTracer } from './sentry-tracer'

const withTracing = async (run: () => void | Promise<void>, envelopes: Array<string> = []) => {
  Sentry.setAsyncLocalStorageAsyncContextStrategy()
  const pending: Array<Promise<unknown>> = []
  await Sentry.wrapRequestHandler(
    {
      request: new Request('https://fixture.test/'),
      context: {
        waitUntil: (promise) => {
          pending.push(promise)
        },
        passThroughOnException: () => {},
      },
      options: {
        dsn: 'https://abc123@o1.ingest.sentry.io/123',
        tracesSampleRate: 1,
        defaultIntegrations: [],
        transport: (options) =>
          Sentry.createTransport(options, async (request) => {
            envelopes.push(
              Predicate.isString(request.body)
                ? request.body
                : new TextDecoder().decode(request.body),
            )

            return { statusCode: 200 }
          }),
      },
    },
    async () => {
      await run()

      return new Response()
    },
  )
  await Promise.all(pending)
}

test('explicit external parents override an unrelated active SDK span and roots stay independent', () =>
  withTracing(() => {
    const tracer = createSentryTracer()

    const parent = Tracer.externalSpan({
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      sampled: true,
    })

    const options = {
      name: 'Fixture.operation',
      parent: Option.some(parent),
      annotations: Context.empty(),
      links: [],
      kind: 'internal',
      startTime: 1_000_000_000n,
      sampled: true,
      root: false,
    } satisfies Parameters<Tracer.Tracer['span']>[0]

    Sentry.startSpan({ name: 'Unrelated' }, (active) => {
      const child = tracer.span(options)
      expect(child.traceId).toBe(parent.traceId)
      const root = tracer.span({ ...options, root: true, parent: Option.none() })
      expect(root.traceId).not.toBe(active.spanContext().traceId)
      expect(root.traceId).not.toBe(parent.traceId)
      child.end(2_000_000_000n, Exit.void)
      root.end(2_000_000_000n, Exit.void)
    })
  }))

test('Effect success, failure and interruption end spans without replacing the original result', () =>
  withTracing(async () => {
    const tracer = createSentryTracer()

    const run = <A, E>(program: Effect.Effect<A, E>) =>
      Effect.runPromiseExit(program.pipe(Effect.provideService(Tracer.Tracer, tracer)))

    expect(await run(Effect.succeed('ready').pipe(Effect.withSpan('Fixture.success')))).toEqual(
      Exit.succeed('ready'),
    )
    const failed = await run(Effect.fail('refused').pipe(Effect.withSpan('Fixture.failure')))
    expect(
      Exit.isFailure(failed) &&
        failed.cause.reasons.some(
          (reason) => Predicate.isTagged(reason, 'Fail') && reason.error === 'refused',
        ),
    ).toBe(true)
    expect(
      Exit.isFailure(await run(Effect.interrupt.pipe(Effect.withSpan('Fixture.cancel')))),
    ).toBe(true)

    const span = tracer.span({
      name: 'Fixture.once',
      parent: Option.none(),
      annotations: Context.empty(),
      links: [],
      kind: 'internal',
      startTime: 1n,
      sampled: true,
      root: false,
    })

    span.end(2n, Exit.void)
    span.end(3n, Exit.fail('late'))
    expect(Predicate.isTagged(span.status, 'Ended') && span.status.endTime).toBe(2n)
  }))

test('concurrent Effect fibers restore the correct SDK parent across suspension', () =>
  withTracing(async () => {
    const tracer = createSentryTracer()

    const program = Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()

      const first = yield* Effect.gen(function* () {
        const span = yield* Effect.currentSpan
        yield* Deferred.succeed(ready, undefined)
        yield* Deferred.await(release)
        const active = yield* Effect.sync(() => Sentry.getActiveSpan()?.spanContext().spanId)

        return { expected: span.spanId, active }
      }).pipe(Effect.withSpan('Fixture.first'), Effect.forkChild)

      yield* Deferred.await(ready)

      const second = yield* Effect.gen(function* () {
        const span = yield* Effect.currentSpan
        yield* Effect.yieldNow
        const active = yield* Effect.sync(() => Sentry.getActiveSpan()?.spanContext().spanId)
        yield* Deferred.succeed(release, undefined)

        return { expected: span.spanId, active }
      }).pipe(Effect.withSpan('Fixture.second'))

      return [yield* Fiber.join(first), second]
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))

    const results = await Effect.runPromise(program)

    for (const result of results) expect(result.active).toBe(result.expected)
    expect(results[0]?.expected).not.toBe(results[1]?.expected)
  }))

test('unsampled spans preserve external trace identity and never become recording spans', () =>
  withTracing(() => {
    const tracer = createSentryTracer()

    const parent = Tracer.externalSpan({
      traceId: '3'.repeat(32),
      spanId: '4'.repeat(16),
      sampled: false,
    })

    const span = tracer.span({
      name: 'Fixture.unsampled',
      parent: Option.some(parent),
      annotations: Context.empty(),
      links: [],
      kind: 'internal',
      startTime: 1n,
      sampled: true,
      root: false,
    })

    expect(span.traceId).toBe(parent.traceId)
    expect(span.sampled).toBe(false)
    span.end(2n, Exit.void)

    const disabled = tracer.span({
      name: 'Fixture.disabled',
      parent: Option.some(parent),
      annotations: Context.empty(),
      links: [],
      kind: 'internal',
      startTime: 1n,
      sampled: false,
      root: false,
    })

    expect(disabled.traceId).toBe(parent.traceId)
    expect(disabled.sampled).toBe(false)
    disabled.end(2n, Exit.void)
  }))

test('span events retain measurements without evaluating arbitrary log attributes', async () => {
  const envelopes: Array<string> = []
  await withTracing(() => {
    const tracer = createSentryTracer()

    const span = tracer.span({
      name: 'Fixture.measurement',
      parent: Option.none(),
      annotations: Context.empty(),
      links: [],
      kind: 'internal',
      startTime: BigInt(Date.now()) * 1_000_000n,
      sampled: true,
      root: false,
    })

    span.event('fixture.log', 1n, {
      get 'effect.cause'() {
        throw new Error('Unreviewed log attributes must not be read')
      },
    })
    span.event('fixture.work', 1n, {
      'sentry.measurement_unit': 'millisecond',
      'sentry.measurement_value': 5,
    })
    span.end(BigInt(Date.now()) * 1_000_000n, Exit.void)
  }, envelopes)
  const payload = envelopes.join('\n')
  expect(payload).toContain('"fixture.work":{"value":5,"unit":"millisecond"}')
  expect(payload).not.toContain('fixture.log')
})
