/* oxlint-disable effecttsgo/strict-effect-provide -- Each test invokes Effect.runPromise, making it an Effect application entry point. */
import {
  makePlayReporterLayer,
  PlayReporter,
  PlayerStorage,
  PlayerStorageInMemory,
} from '@gbfm/player'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

describe('makePlayReporterLayer', () => {
  it('checks concurrent duplicates only after the first successful delivery', async () => {
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const callersStarted = Deferred.makeUnsafe<void>()
    const attempted: Array<string> = []
    const checked: Array<string> = []
    let callers = 0

    const storageLayer = Layer.effect(
      PlayerStorage,
      Effect.gen(function* () {
        const storage = yield* PlayerStorage

        return {
          ...storage,
          isWithinDedupWindow: (id: string) =>
            Effect.gen(function* () {
              checked.push(id)

              return yield* storage.isWithinDedupWindow(id)
            }),
        }
      }),
    ).pipe(Layer.provide(PlayerStorageInMemory))

    const layer = makePlayReporterLayer((id) =>
      Effect.gen(function* () {
        attempted.push(id)

        if (attempted.length !== 1) return
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
      }),
    ).pipe(Layer.provideMerge(storageLayer))

    await Effect.gen(function* () {
      const reporter = yield* PlayReporter
      const first = yield* reporter.recordPlay('one').pipe(Effect.forkScoped)
      yield* Deferred.await(started)

      const pending = yield* Effect.all(
        ['one', 'one', 'two'].map((id) =>
          Effect.gen(function* () {
            callers++

            if (callers === 3) yield* Deferred.succeed(callersStarted, undefined)
            yield* reporter.recordPlay(id)
          }),
        ),
        { concurrency: 'unbounded' },
      ).pipe(Effect.forkScoped)

      yield* Deferred.await(callersStarted)
      expect(checked).toEqual(['one'])
      expect(attempted).toEqual(['one'])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(pending)
    }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)

    expect(attempted).toEqual(['one', 'two'])
    expect(checked).toEqual(['one', 'two'])
  })

  it('releases the serialization lock after delivery failure', async () => {
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const attempted: Array<string> = []

    const layer = makePlayReporterLayer((id) =>
      Effect.gen(function* () {
        attempted.push(id)

        if (attempted.length !== 1) return yield* Effect.void
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)

        return yield* Effect.fail('network')
      }),
    ).pipe(Layer.provideMerge(PlayerStorageInMemory))

    await Effect.gen(function* () {
      const reporter = yield* PlayReporter
      const first = yield* reporter.recordPlay('one').pipe(Effect.forkScoped)
      yield* Deferred.await(started)

      const pending = yield* Effect.all(
        [reporter.recordPlay('one'), reporter.recordPlay('one'), reporter.recordPlay('two')],
        { concurrency: 'unbounded' },
      ).pipe(Effect.forkScoped)

      yield* Effect.yieldNow
      expect(attempted).toEqual(['one'])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(pending)
    }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)

    expect(attempted).toEqual(['one', 'one', 'two'])
  })

  it('delivers a fresh play once and dedups within the window', async () => {
    const recorded: Array<string> = []

    const layer = makePlayReporterLayer((trackId) =>
      Effect.sync(() => {
        recorded.push(trackId)
      }),
    ).pipe(Layer.provideMerge(PlayerStorageInMemory))

    await Effect.gen(function* () {
      const reporter = yield* PlayReporter
      yield* reporter.recordPlay('track-1')
      yield* reporter.recordPlay('track-1')
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(recorded).toEqual(['track-1'])
  })

  it('swallows deliver failures so playback is not interrupted', async () => {
    let delivered = false

    const layer = makePlayReporterLayer(() => {
      delivered = true

      return Effect.fail('network')
    }).pipe(Layer.provideMerge(PlayerStorageInMemory))

    await Effect.gen(function* () {
      const reporter = yield* PlayReporter
      yield* reporter.recordPlay('track-1')
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(delivered).toBe(true)
  })
})
