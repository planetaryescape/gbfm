import { Deferred, Effect, Fiber } from 'effect'
import { expect, test } from 'vitest'

import { createComposerLoadOwner } from './composerLoad'

test.each(['success', 'failure'])(
  'a superseded remote %s cannot overwrite the current result even when the adapter ignores cancellation',
  async (result) => {
    const owner = createComposerLoadOwner()
    const events: Array<string> = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const old = owner.start()

        const request = Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.andThen(
            result === 'success' ? Effect.succeed('old success') : Effect.fail('old failure'),
          ),
        )

        const fiber = yield* old
          .run(
            request,
            (value) => events.push(value),
            (error) => events.push(error),
          )
          .pipe(Effect.forkScoped)

        yield* Deferred.await(started)
        const current = owner.start()
        expect(old.signal.aborted).toBe(true)
        expect(current.signal.aborted).toBe(false)
        yield* current.run(
          Effect.succeed('current'),
          (value) => events.push(value),
          () => events.push('current failure'),
        )
        yield* Deferred.succeed(finish, undefined)
        yield* Fiber.join(fiber)
        expect(events).toEqual(['current'])
      }).pipe(Effect.scoped),
    )
  },
)

test('cancelling a mounted load invalidates both delayed callbacks and synchronous commits', async () => {
  const owner = createComposerLoadOwner()
  const events: Array<string> = []
  const attempt = owner.start()
  owner.cancel()
  expect(attempt.signal.aborted).toBe(true)
  attempt.commit(() => events.push('restored'))
  await Effect.runPromise(
    attempt.run(
      Effect.fail('late failure'),
      () => events.push('success'),
      (error) => events.push(error),
    ),
  )
  expect(events).toEqual([])
})
