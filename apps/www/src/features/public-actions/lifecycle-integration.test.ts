import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { expect, it } from 'vitest'

import {
  audioA,
  control,
  controlsContext,
  document,
  IntegrationContextMessage,
  MembershipControls,
  membershipAdapter,
  membershipState,
  mutationId,
  playerLayer,
  receipt,
  runWithLayer,
} from './integration.test-support'

const lifecycle = { navigationId: 0, pending: false }

it('same-boolean page completion reobserves atomic state without resetting ownership or replaying earlier lifecycle notifications', async () => {
  let reads = 0

  const adapter = membershipAdapter(
    async () => receipt(),
    async () => {
      reads += 1

      return Response.json({ revision: reads === 1 ? 17 : 19, favorited: false, subscribed: false })
    },
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, { ...controlsContext, lifecycle })
      yield* TestHost.settle
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      const acknowledged = membershipState(root)
      expect(acknowledged.entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 18,
      })
      root.send(
        IntegrationContextMessage.ChangedContext({
          context: { ...controlsContext, lifecycle: { navigationId: 1, pending: true } },
        }),
      )
      yield* TestHost.settle
      expect(membershipState(root)).toEqual(acknowledged)
      root.send(
        IntegrationContextMessage.ChangedContext({
          context: {
            ...controlsContext,
            lifecycle: { navigationId: 1, pending: false },
          },
        }),
      )
      yield* TestHost.settle
      expect(reads).toBe(2)
      expect(membershipState(root).generation).toBe(acknowledged.generation)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 19,
      })

      for (const stale of [lifecycle, { navigationId: 1, pending: false }]) {
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: {
              ...controlsContext,
              targets: [document(audioA, 'active')],
              lifecycle: stale,
            },
          }),
        )
        yield* TestHost.settle
        expect(reads).toBe(2)
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'inactive',
          revision: 19,
        })
      }
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it.each(['pending', 'uncertain'])(
  'a newer page cannot discard a %s write or its retry intent',
  async (phase) => {
    const save = Promise.withResolvers<Response>()
    const adapter = membershipAdapter(() => save.promise)
    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, { ...controlsContext, lifecycle })
        yield* TestHost.settle
        Locator.fire(control(root, 'player'), 'click')
        yield* TestHost.settle

        if (phase === 'uncertain') {
          save.resolve(new Response('', { status: 503 }))
          yield* TestHost.settle
        }

        const owned = membershipState(root).entries['audio:audio-a']
        expect(owned).toMatchObject({ revision: 17, busy: phase === 'pending' })
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: {
              ...controlsContext,
              targets: [document(audioA, 'active')],
              lifecycle: { navigationId: 1, pending: true },
            },
          }),
        )
        yield* TestHost.settle
        expect(adapter.reads).toHaveLength(1)
        expect(membershipState(root).entries['audio:audio-a']).toEqual(owned)

        if (phase === 'pending') {
          save.resolve(receipt())
          yield* TestHost.settle
          expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
            status: 'active',
            revision: 18,
          })
        } else expect(owned?.mutationId).toBe(mutationId)
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, lifecycle: { navigationId: 1, pending: false } },
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          revision: phase === 'pending' ? 18 : 17,
          mutationId: phase === 'pending' ? null : mutationId,
        })
        expect(adapter.reads).toHaveLength(1)
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)
