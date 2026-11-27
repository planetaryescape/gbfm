import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, PubSub } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, it } from 'vitest'

import {
  audioA,
  audioB,
  control,
  controlsContext,
  IntegrationContextMessage,
  MembershipControls,
  membershipAdapter,
  membershipState,
  playerLayer,
  runWithLayer,
} from '../public-actions/integration.test-support'
import {
  atomicStateResponse,
  movingPlayerLayer,
  playerNotice,
  queuedSnapshot,
} from '../public-actions/retirement.test-support'
import type { PlayerSnapshot } from './domain'

it('a player favorite failure notice remains visible at 3999 milliseconds and is dismissed at exactly 4000 without changing acknowledged membership', async () => {
  const adapter = membershipAdapter(async () => new Response(null, { status: 503 }))
  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      const saved = membershipState(root)
      expect(playerNotice(root)).toBe('Favorite could not be saved. Try again.')
      yield* TestClock.adjust('3999 millis')
      yield* TestHost.settle
      expect(playerNotice(root)).toBe('Favorite could not be saved. Try again.')
      yield* TestClock.adjust('1 millis')
      yield* TestHost.settle
      expect(playerNotice(root)).toBe('')
      expect(membershipState(root)).toEqual(saved)
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
    }),
    Layer.mergeAll(TestHost.layer(), TestClock.layer(), playerLayer, adapter.layer),
  )
})

it.each(['retry', 'track', 'account'])(
  'a stale four-second favorite notice timer cannot hide the new notice after %s',
  async (change) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* PubSub.unbounded<PlayerSnapshot>()

          const adapter = membershipAdapter(
            async () => new Response(null, { status: 503 }),
            async (url) =>
              url.includes(audioB.id)
                ? new Response(null, { status: 503 })
                : atomicStateResponse(17),
          )

          yield* Effect.promise(() =>
            runWithLayer(
              Effect.gen(function* () {
                const root = yield* TestHost.mount(MembershipControls, controlsContext)
                yield* TestHost.settle
                Locator.fire(control(root, 'player'), 'click')
                yield* TestHost.settle
                expect(playerNotice(root)).toBe('Favorite could not be saved. Try again.')
                yield* TestClock.adjust('2 seconds')

                if (change === 'track') yield* PubSub.publish(source, queuedSnapshot(audioB.id))
                else if (change === 'account') {
                  root.send(
                    IntegrationContextMessage.ChangedContext({
                      context: { ...controlsContext, principalId: 'account-b' },
                    }),
                  )
                  yield* TestHost.settle
                  Locator.fire(control(root, 'player'), 'click')
                } else Locator.fire(control(root, 'player'), 'click')
                yield* TestHost.settle

                const expected =
                  change === 'track'
                    ? 'Favorite status could not be loaded.'
                    : 'Favorite could not be saved. Try again.'

                expect(playerNotice(root)).toBe(expected)
                yield* TestClock.adjust('2 seconds')
                yield* TestHost.settle
                expect(playerNotice(root)).toBe(expected)
                yield* TestClock.adjust('1999 millis')
                yield* TestHost.settle
                expect(playerNotice(root)).toBe(expected)
                yield* TestClock.adjust('1 millis')
                yield* TestHost.settle
                expect(playerNotice(root)).toBe('')
              }),
              Layer.mergeAll(
                TestHost.layer(),
                TestClock.layer(),
                movingPlayerLayer(source),
                adapter.layer,
              ),
            ),
          )
        }),
      ),
    )
  },
)

it('a failed favorite observation offers retry, clears its old notice while pending and loads the actual queued target once', async () => {
  const held = Promise.withResolvers<Response>()
  let reads = 0

  const adapter = membershipAdapter(
    async () => new Response(null, { status: 500 }),
    async () => (++reads === 1 ? new Response(null, { status: 503 }) : held.promise),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, { ...controlsContext, targets: [] })
      yield* TestHost.settle
      expect(adapter.reads).toEqual([`/api/favorites/audio/${audioA.id}/state`])
      expect(playerNotice(root)).toBe('Favorite status could not be loaded.')
      Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
      yield* TestHost.settle
      expect(playerNotice(root)).toBe('')
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: true,
        status: 'loading',
        revision: null,
      })
      expect(adapter.reads).toEqual([
        `/api/favorites/audio/${audioA.id}/state`,
        `/api/favorites/audio/${audioA.id}/state`,
      ])
      held.resolve(atomicStateResponse(23, true))
      yield* TestHost.settle
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
      expect(adapter.writes).toHaveLength(0)
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})
