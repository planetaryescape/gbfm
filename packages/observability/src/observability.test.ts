import { Context, Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import {
  ExportUnavailable,
  JourneyExporter,
  Observability,
  observabilityLayer,
  observeJourney,
  type JourneyName,
  type JourneyOutcome,
} from './observability'

type FailureMode = 'open' | 'finish' | 'open-defect' | 'finish-defect'

const fixture = (failure?: FailureMode) => {
  const records: Array<{ name: JourneyName; outcome: JourneyOutcome; durationMs: number }> = []
  const starts: Array<JourneyName> = []

  const exporter = Layer.succeed(JourneyExporter, {
    open: (name) => {
      if (failure === 'open') return Effect.fail(new ExportUnavailable())

      if (failure === 'open-defect') return Effect.die(new Error('Exporter defect'))

      return Effect.sync(() => {
        starts.push(name)

        return {
          finish: (outcome, durationMs) => {
            if (failure === 'finish') return Effect.fail(new ExportUnavailable())

            if (failure === 'finish-defect') return Effect.die(new Error('Exporter defect'))

            return Effect.sync(() => {
              records.push({ name, outcome, durationMs })
            })
          },
        }
      })
    },
  })

  const runtime = ManagedRuntime.make(
    observabilityLayer.pipe(Layer.provide(exporter), Layer.provideMerge(TestClock.layer())),
  )

  return {
    records,
    starts,
    run: async <A, E>(work: Effect.Effect<A, E, Observability>) => {
      try {
        return await runtime.runPromise(work)
      } finally {
        await runtime.dispose()
      }
    },
  }
}

test('completion is idempotent across callbacks and uses the provided monotonic clock', async () => {
  const f = fixture()
  await f.run(
    Effect.gen(function* () {
      const service = yield* Observability
      const journey = yield* service.start('reader.open')
      yield* TestClock.adjust('175 millis')
      yield* journey.finish('succeeded')
      yield* journey.finish('failed')
    }),
  )
  expect(f.records).toEqual([{ name: 'reader.open', outcome: 'succeeded', durationMs: 175 }])
})

test('scope closure cancels outstanding attempts but does not rewrite settled outcomes', async () => {
  const f = fixture()
  await f.run(
    Effect.gen(function* () {
      const service = yield* Observability
      yield* service.start('reader.open')
      const playback = yield* service.start('playback.start')
      yield* playback.finish('empty')
      yield* TestClock.adjust('20 millis')
    }),
  )
  expect(f.records).toEqual([
    { name: 'playback.start', outcome: 'empty', durationMs: 0 },
    { name: 'reader.open', outcome: 'canceled', durationMs: 20 },
  ])
})

const exportFailures: Array<FailureMode> = ['open', 'finish', 'open-defect', 'finish-defect']

test.each(exportFailures)(
  'an exporter %s failure cannot replace application results',
  async (failure) => {
    const f = fixture(failure)

    const result = await f.run(
      Effect.gen(function* () {
        const service = yield* Observability
        const journey = yield* service.start('reader.open')
        yield* journey.finish('failed')

        return 'unchanged'
      }),
    )

    expect(result).toBe('unchanged')
    expect(f.records).toEqual([])
  },
)

test('outstanding native attempts are bounded and capacity is released on settlement', async () => {
  const f = fixture()
  await f.run(
    Effect.gen(function* () {
      const service = yield* Observability

      const attempts = yield* Effect.forEach(Array.from({ length: 35 }), () =>
        service.start('reader.open'),
      )

      expect(f.starts).toHaveLength(30)
      yield* attempts[0]?.finish('succeeded') ?? Effect.void
      yield* service.start('playback.start')
      expect(f.starts).toHaveLength(31)
    }),
  )
  expect(f.records).toHaveLength(31)
})

test('Effect operation observation preserves values and typed failures', async () => {
  const f = fixture()
  await f.run(
    Effect.gen(function* () {
      expect(yield* observeJourney('navigation', Effect.succeed(42))).toBe(42)

      const failure = yield* observeJourney('navigation', Effect.fail('unavailable')).pipe(
        Effect.exit,
      )

      expect(failure).toEqual(Exit.fail('unavailable'))
    }),
  )
  expect(f.records.map(({ outcome }) => outcome)).toEqual(['succeeded', 'failed'])
})

test('interruption settles a canceled operation, not an incident', async () => {
  const f = fixture()
  await f.run(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()

      const pending = yield* observeJourney(
        'navigation',
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      ).pipe(Effect.forkChild)

      yield* Deferred.await(entered)
      yield* Fiber.interrupt(pending)
    }),
  )
  expect(f.records.map(({ outcome }) => outcome)).toEqual(['canceled'])
})

test('opening attempts reserve capacity and late acquisitions are canceled after scope closure', async () => {
  const outcomes: Array<JourneyOutcome> = []
  let openings = 0
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()

        const exporter = Layer.succeed(JourneyExporter, {
          open: () =>
            Effect.gen(function* () {
              openings++

              if (openings === 30) yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)

              return {
                finish: (outcome) =>
                  Effect.sync(() => {
                    outcomes.push(outcome)
                  }),
              }
            }),
        })

        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.succeed(undefined)))

        const context = yield* Layer.buildWithScope(
          observabilityLayer.pipe(Layer.provide(exporter)),
          scope,
        )

        const service = Context.get(context, Observability)

        const attempts = yield* Effect.forEach(Array.from({ length: 35 }), () =>
          service.start('reader.open').pipe(Effect.forkChild),
        )

        yield* Deferred.await(entered)
        expect(openings).toBe(30)
        yield* Scope.close(scope, Exit.succeed(undefined))
        yield* Deferred.succeed(release, undefined)

        for (const attempt of attempts) {
          const journey = yield* Fiber.join(attempt)
          yield* journey.finish('succeeded')
        }

        yield* service.start('navigation')
      }),
    ),
  )
  expect(openings).toBe(30)
  expect(outcomes).toEqual(Array.from({ length: 30 }, () => 'canceled'))
})
