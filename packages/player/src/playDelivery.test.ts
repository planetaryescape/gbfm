import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { DEDUP_WINDOW_MS } from './audioStorage'
import { createPlayDelivery } from './playDelivery'

describe('createPlayDelivery', () => {
  it('expires local delivery suppression exactly at the dedup boundary', async () => {
    let now = 0
    const delivered: Array<string> = []
    const remembered: Array<string> = []
    const checked: Array<string> = []

    const record = createPlayDelivery({
      now: () => now,
      isWithinDedupWindow: (id) =>
        Effect.sync(() => {
          checked.push(id)

          return false
        }),
      deliver: (id) =>
        Effect.sync(() => {
          delivered.push(id)
        }),
      remember: (id) =>
        Effect.sync(() => {
          remembered.push(id)
        }),
    })

    await Effect.runPromise(record('one'))
    now = DEDUP_WINDOW_MS - 1
    await Effect.runPromise(record('one'))
    expect(delivered).toEqual(['one'])
    expect(checked).toEqual(['one'])
    now = DEDUP_WINDOW_MS
    await Effect.runPromise(record('one'))
    expect(delivered).toEqual(['one', 'one'])
    expect(remembered).toEqual(['one', 'one'])
    expect(checked).toEqual(['one', 'one'])
  })

  it('rechecks persisted dedup without creating local success until delivery occurs', async () => {
    let within = true
    const delivered: Array<string> = []

    const record = createPlayDelivery({
      now: () => 0,
      isWithinDedupWindow: () => Effect.sync(() => within),
      deliver: (id) =>
        Effect.sync(() => {
          delivered.push(id)
        }),
      remember: () => Effect.void,
    })

    await Effect.runPromise(record('one'))
    expect(delivered).toEqual([])
    within = false
    await Effect.runPromise(record('one'))
    expect(delivered).toEqual(['one'])
  })

  it('delivers when the persisted dedup read fails', async () => {
    const delivered: Array<string> = []
    const remembered: Array<string> = []

    const record = createPlayDelivery({
      now: () => 0,
      isWithinDedupWindow: () => Effect.fail('read failed'),
      deliver: (id) =>
        Effect.sync(() => {
          delivered.push(id)
        }),
      remember: (id) =>
        Effect.sync(() => {
          remembered.push(id)
        }),
    })

    await Effect.runPromise(record('one'))
    expect(delivered).toEqual(['one'])
    expect(remembered).toEqual(['one'])
  })

  it('leaves failed delivery eligible for the next caller without retrying automatically', async () => {
    let attempts = 0
    let fail = true
    const remembered: Array<string> = []

    const record = createPlayDelivery({
      now: () => 0,
      isWithinDedupWindow: () => Effect.succeed(false),
      deliver: () =>
        Effect.suspend(() => {
          attempts += 1

          return fail ? Effect.fail('delivery failed') : Effect.void
        }),
      remember: (id) =>
        Effect.sync(() => {
          remembered.push(id)
        }),
    })

    expect(await Effect.runPromise(Effect.flip(record('one')))).toBe('delivery failed')
    expect(attempts).toBe(1)
    expect(remembered).toEqual([])
    fail = false
    await Effect.runPromise(record('one'))
    await Effect.runPromise(record('one'))
    expect(attempts).toBe(2)
    expect(remembered).toEqual(['one'])
  })

  it('retains successful delivery suppression after remember fails until local expiry', async () => {
    let now = 0
    const delivered: Array<string> = []
    const rememberAttempts: Array<string> = []

    const record = createPlayDelivery({
      now: () => now,
      isWithinDedupWindow: () => Effect.succeed(false),
      deliver: (id) =>
        Effect.sync(() => {
          delivered.push(id)
        }),
      remember: (id) =>
        Effect.suspend(() => {
          rememberAttempts.push(id)

          return Effect.fail('remember failed')
        }),
    })

    await Effect.runPromise(record('one'))
    await Effect.runPromise(record('one'))
    await Effect.runPromise(record('two'))
    expect(delivered).toEqual(['one', 'two'])
    expect(rememberAttempts).toEqual(['one', 'two'])
    now = DEDUP_WINDOW_MS
    await Effect.runPromise(record('one'))
    expect(delivered).toEqual(['one', 'two', 'one'])
    expect(rememberAttempts).toEqual(['one', 'two', 'one'])
  })

  it('starts local expiry at delivery completion rather than request start', async () => {
    let now = 0
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const delivered: Array<string> = []

    const record = createPlayDelivery({
      now: () => now,
      isWithinDedupWindow: () => Effect.succeed(false),
      deliver: (id) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          delivered.push(id)
        }),
      remember: () => Effect.void,
    })

    await Effect.gen(function* () {
      const first = yield* record('one').pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      now = DEDUP_WINDOW_MS
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      now += DEDUP_WINDOW_MS - 1
      yield* record('one')
      expect(delivered).toEqual(['one'])
      now += 1
      yield* record('one')
      expect(delivered).toEqual(['one', 'one'])
    }).pipe(Effect.scoped, Effect.runPromise)
  })
})
