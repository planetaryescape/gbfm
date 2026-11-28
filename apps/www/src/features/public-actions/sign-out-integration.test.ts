import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { expect, it } from 'vitest'

import {
  audioA,
  control,
  controlsContext,
  IntegrationContextMessage,
  MembershipControls,
  membershipAdapter,
  membershipState,
  playerLayer,
  receipt,
  runWithLayer,
} from './integration.test-support'

it.each(['load', 'save'])(
  'confirmed sign-out rejects an older %s and keeps both controls anonymous',
  async (phase) => {
    const pending = Promise.withResolvers<Response>()

    const adapter = membershipAdapter(
      async () => pending.promise,
      phase === 'load' ? async () => pending.promise : undefined,
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle

        if (phase === 'save') {
          Locator.fire(control(root, audioA.id), 'click')
          yield* TestHost.settle
        }

        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, principalId: null, principalKnown: true },
          }),
        )
        yield* TestHost.settle
        const anonymous = membershipState(root)
        expect(anonymous).toMatchObject({
          principalId: null,
          principalKnown: true,
          entries: { 'audio:audio-a': { status: 'anonymous', revision: null, busy: false } },
        })
        pending.resolve(
          phase === 'load'
            ? Response.json({ revision: 18, favorited: true, subscribed: false })
            : receipt(),
        )
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(anonymous)
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(adapter.reads).toHaveLength(1)
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)
