import { Effect, Layer, ManagedRuntime } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import {
  ExportUnavailable,
  JourneyExporter,
  Observability,
  observabilityLayer,
  type JourneyName,
  type JourneyOutcome,
} from './observability'

const fixture = (failure?: 'open' | 'finish') => {
  const records: Array<{ name: JourneyName; outcome: JourneyOutcome; durationMs: number }> = []
  const starts: Array<JourneyName> = []

  const exporter = Layer.succeed(JourneyExporter, {
    open: (name) =>
      failure === 'open'
        ? Effect.fail(new ExportUnavailable())
        : Effect.sync(() => {
            starts.push(name)

            return {
              finish: (outcome, durationMs) =>
                failure === 'finish'
                  ? Effect.fail(new ExportUnavailable())
                  : Effect.sync(() => {
                      records.push({ name, outcome, durationMs })
                    }),
            }
          }),
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

const exportFailures: Array<'open' | 'finish'> = ['open', 'finish']

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
