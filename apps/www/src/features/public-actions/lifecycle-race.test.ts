import { Html } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { MembershipProps, MembershipProviderEvents } from './domain'
import { audioA, listener } from './integration.test-support'
import { MembershipMessage, MembershipProviderModel, membershipProviderUpdate } from './provider'

const ReceiptHarness = Html.component({
  name: 'MembershipLifecycleReceiptFixture',
  props: MembershipProps,
  model: MembershipProviderModel,
  message: MembershipMessage,
  events: MembershipProviderEvents,
}).make({
  init: ($) => ({
    principalId: $.props.principalId,
    principalKnown: $.props.principalKnown,
    generation: 0,
    revision: null,
    entries: {},
  }),
  update: ($) => $.combine(membershipProviderUpdate),
  view: (h) => h.text(''),
})

it('props that begin navigation are captured before a receipt even when the lifecycle subscription has not delivered', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(ReceiptHarness, {
      ...listener,
      lifecycle: { navigationId: 0, pending: false },
    })

    s.given({
      ...listener,
      generation: 0,
      revision: 17,
      navigation: { navigationId: 0, pending: false, revision: null },
      entries: {
        'audio:audio-a': {
          target: audioA,
          status: 'inactive',
          busy: true,
          revision: 17,
          request: 2,
          mutationId: null,
          notice: null,
        },
      },
    })
      .props({ ...listener, lifecycle: { navigationId: 1, pending: true } })
      .send(
        MembershipMessage.SucceededSaveMembership({
          target: audioA,
          principalId: listener.principalId,
          generation: 0,
          request: 2,
          active: true,
          revision: 18,
        }),
      )
      .expectNone()
    expect(s.model.navigation).toEqual({ navigationId: 1, pending: true, revision: 17 })
    expect(s.model.entries['audio:audio-a']).toMatchObject({ status: 'active', revision: 18 })
    s.props({ ...listener, lifecycle: { navigationId: 1, pending: false } })
      .send(MembershipMessage.ChangedMembershipLifecycle())
      .expectNone()
    expect(s.model.entries['audio:audio-a']).toMatchObject({ status: 'active', revision: 18 })
  }).pipe(Effect.scoped, Effect.runPromise))
