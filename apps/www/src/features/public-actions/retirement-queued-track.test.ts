import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, PubSub } from 'effect'
import { expect, it } from 'vitest'

import type { PlayerSnapshot } from '../player/domain'
import type { MembershipTarget } from './domain'
import {
  audioA,
  audioB,
  control,
  controlsContext,
  document,
  IntegrationContextMessage,
  MembershipControls,
  membershipAdapter,
  membershipState,
  playerLayer,
  receipt,
  runWithLayer,
} from './integration.test-support'
import {
  atomicStateResponse,
  movingPlayerLayer,
  playerNotice,
  queuedSnapshot,
} from './retirement.test-support'

it.each([
  { phase: 'load', result: 'saved' },
  { phase: 'load', result: 'failed' },
  { phase: 'save', result: 'saved' },
  { phase: 'save', result: 'failed' },
])(
  'queued A to B ignores an old A $phase $result at the visible player while retaining target-owned state',
  async ({ phase, result }) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* PubSub.unbounded<PlayerSnapshot>()
          const old = Promise.withResolvers<Response>()
          let revision = 17

          const adapter = membershipAdapter(
            async () => old.promise,
            async (url) =>
              phase === 'load' && url.includes(audioA.id)
                ? old.promise
                : atomicStateResponse(revision),
          )

          yield* Effect.promise(() =>
            runWithLayer(
              Effect.gen(function* () {
                const root = yield* TestHost.mount(MembershipControls, {
                  ...controlsContext,
                  targets: [],
                })

                yield* TestHost.settle

                if (phase === 'save') {
                  Locator.fire(control(root, 'player'), 'click')
                  yield* TestHost.settle
                  expect(adapter.writes).toHaveLength(1)
                }

                yield* PubSub.publish(source, queuedSnapshot(audioB.id))
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
                  busy: false,
                  status: 'inactive',
                  mutationId: null,
                })
                expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
                revision = result === 'saved' ? 18 : 17

                if (result === 'failed') old.resolve(new Response(null, { status: 503 }))
                else if (phase === 'load') old.resolve(atomicStateResponse(18, true))
                else old.resolve(receipt())
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
                  busy: false,
                  status: 'inactive',
                  mutationId: null,
                  notice: null,
                })
                expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
                expect(playerNotice(root)).toBe('')
              }),
              Layer.mergeAll(TestHost.layer(), movingPlayerLayer(source), adapter.layer),
            ),
          )
        }),
      ),
    )
  },
)

it.each(['before returning', 'after returning'])(
  'A to B to A retains the target-owned write acknowledged %s without a second mutation',
  async (arrival) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* PubSub.unbounded<PlayerSnapshot>()
          const held = Promise.withResolvers<Response>()
          const adapter = membershipAdapter(async () => held.promise)
          yield* Effect.promise(() =>
            runWithLayer(
              Effect.gen(function* () {
                const root = yield* TestHost.mount(MembershipControls, {
                  ...controlsContext,
                  targets: [],
                })

                yield* TestHost.settle
                Locator.fire(control(root, 'player'), 'click')
                yield* TestHost.settle
                yield* PubSub.publish(source, queuedSnapshot(audioB.id))
                yield* TestHost.settle

                if (arrival === 'before returning') {
                  held.resolve(receipt())
                  yield* TestHost.settle
                }

                yield* PubSub.publish(source, queuedSnapshot(audioA.id))
                yield* TestHost.settle

                if (arrival === 'after returning') {
                  expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
                    busy: true,
                    status: 'inactive',
                    revision: 17,
                  })
                  held.resolve(receipt())
                  yield* TestHost.settle
                }

                expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
                  busy: false,
                  status: 'active',
                  revision: 18,
                  mutationId: null,
                })
                expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
                expect(adapter.writes).toHaveLength(1)
                expect(adapter.reads).toHaveLength(2)
              }),
              Layer.mergeAll(TestHost.layer(), movingPlayerLayer(source), adapter.layer),
            ),
          )
        }),
      ),
    )
  },
)

it.each(['load', 'save'])(
  'an old queued A %s completion leaves the next track B loading with the same ownership until B responds',
  async (phase) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* PubSub.unbounded<PlayerSnapshot>()
          const old = Promise.withResolvers<Response>()
          const next = Promise.withResolvers<Response>()

          const adapter = membershipAdapter(
            async () => old.promise,
            async (url) => {
              if (url.includes(audioB.id)) return next.promise

              return phase === 'load' ? old.promise : atomicStateResponse(17)
            },
          )

          yield* Effect.promise(() =>
            runWithLayer(
              Effect.gen(function* () {
                const root = yield* TestHost.mount(MembershipControls, {
                  ...controlsContext,
                  targets: [],
                })

                yield* TestHost.settle

                if (phase === 'save') {
                  Locator.fire(control(root, 'player'), 'click')
                  yield* TestHost.settle
                }

                yield* PubSub.publish(source, queuedSnapshot(audioB.id))
                yield* TestHost.settle
                const pending = membershipState(root).entries['audio:audio-b']
                expect(pending).toMatchObject({ status: 'loading', busy: true, revision: null })
                old.resolve(phase === 'load' ? atomicStateResponse(18, true) : receipt())
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-b']).toEqual(pending)
                expect(control(root, 'player').attrs?.['aria-label']).toBe('Checking favorite')
                expect(playerNotice(root)).toBe('')
                next.resolve(atomicStateResponse(18))
                yield* TestHost.settle
                expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
                expect(adapter.reads).toHaveLength(2)
                expect(adapter.writes).toHaveLength(phase === 'save' ? 1 : 0)
              }),
              Layer.mergeAll(TestHost.layer(), movingPlayerLayer(source), adapter.layer),
            ),
          )
        }),
      ),
    )
  },
)

it('a page A save acknowledged while the queue plays B updates A without replacing B favorite state', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* PubSub.unbounded<PlayerSnapshot>()
        const held = Promise.withResolvers<Response>()
        const adapter = membershipAdapter(async () => held.promise)
        yield* Effect.promise(() =>
          runWithLayer(
            Effect.gen(function* () {
              const root = yield* TestHost.mount(MembershipControls, controlsContext)
              yield* TestHost.settle
              yield* PubSub.publish(source, queuedSnapshot(audioB.id))
              yield* TestHost.settle
              Locator.fire(control(root, audioA.id), 'click')
              yield* TestHost.settle
              expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
              expect(adapter.writes[0]).toMatchObject({ audioId: audioA.id, expectedRevision: 17 })
              held.resolve(receipt())
              yield* TestHost.settle
              expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('true')
              expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
              expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
                status: 'inactive',
                busy: false,
                notice: null,
                mutationId: null,
              })
            }),
            Layer.mergeAll(TestHost.layer(), movingPlayerLayer(source), adapter.layer),
          ),
        )
      }),
    ),
  )
})

it.each([audioB, { kind: 'show', id: audioA.id } satisfies MembershipTarget])(
  'native target ownership serializes a pending audio A write across replacement by $kind/$id without changing that destination',
  async (target) => {
    const held = Promise.withResolvers<Response>()
    const adapter = membershipAdapter(async () => held.promise)
    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle
        Locator.fire(control(root, audioA.id), 'click')
        yield* TestHost.settle
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, targets: [document(target)] },
          }),
        )
        yield* TestHost.settle
        const key = `${target.kind}:${target.id}`
        expect(membershipState(root).entries[key]).toMatchObject({
          status: 'inactive',
          revision: 17,
          busy: false,
        })
        Locator.fire(control(root, target.id, target.kind), 'click')
        yield* TestHost.settle
        expect(adapter.writes).toHaveLength(1)
        held.resolve(receipt())
        yield* TestHost.settle
        expect(membershipState(root).entries[key]).toMatchObject({
          status: 'inactive',
          revision: 18,
          busy: false,
        })
        expect(control(root, target.id, target.kind).attrs?.['aria-pressed']).toBe('false')
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
        expect(adapter.writes).toHaveLength(1)
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)
