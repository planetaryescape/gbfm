import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { PlayerFavorite } from '../player/favorite-control'
import { PlayerProvider } from '../player/provider'
import { MembershipButton } from './button'
import { MembershipMessage, MembershipProps } from './domain'
import { document } from './integration.test-support'
import { MembershipProvider } from './provider'

export const RecoveryControlsMessage = UiSchema.TaggedEnum({
  ChangedContext: { context: MembershipProps },
})

const RecoveryProbeMessage = UiSchema.TaggedEnum({
  RequestedMembershipDispatch: {
    membership: Schema.Union([
      MembershipMessage.cases.RequestedMembership,
      MembershipMessage.cases.RequestedRetryMembership,
      MembershipMessage.cases.RequestedToggleMembership,
    ]),
  },
})

const RecoveryShareProbe = Html.component({
  name: 'RecoveryShareProbe',
  model: Schema.Null,
  message: RecoveryProbeMessage,
  reads: { provider: MembershipProvider },
}).make({
  init: () => null,
  update: {
    RequestedMembershipDispatch: ($, { membership }) => $.send(MembershipProvider, membership),
  },
  view: (h) =>
    h.div.children(
      h.output.attr('data-recovery-share', '').children(JSON.stringify(h.reads.provider)),
      [
        MembershipMessage.RequestedMembership({ target: { kind: 'audio', id: 'audio-a' } }),
        MembershipMessage.RequestedMembership({ target: { kind: 'audio', id: 'new-target' } }),
        MembershipMessage.RequestedRetryMembership({ target: { kind: 'audio', id: 'audio-a' } }),
        MembershipMessage.RequestedToggleMembership({ target: { kind: 'audio', id: 'audio-a' } }),
      ].map((membership, index) =>
        h.button
          .attr('data-forward-membership', String(index))
          .on('click', RecoveryProbeMessage.RequestedMembershipDispatch({ membership })),
      ),
    ),
})

export const RecoveryControls = Html.component({
  name: 'RecoveryControls',
  props: MembershipProps,
  model: MembershipProps,
  message: RecoveryControlsMessage,
}).make({
  init: ($) => $.props,
  update: {
    ChangedContext: ($, { context }) => $.set(context),
  },
  view: (h, model) =>
    PlayerProvider(h, {
      props: {
        principalId: model.principalId,
        principalKnown: model.principalKnown,
        authorizationSuspended: !model.principalKnown,
        returnTo: '/mixes/audio-a',
      },
      view: () =>
        MembershipProvider(h, {
          props: model,
          view: () =>
            h.div.children(
              MembershipButton(h, { key: 'audio', props: { document: document() } }),
              MembershipButton(h, {
                key: 'show',
                props: {
                  document: {
                    ...document({ kind: 'show', id: 'show-a' }),
                    path: '/shows/show-a',
                  },
                },
              }),
              PlayerFavorite(h, {}),
              RecoveryShareProbe(h, {}),
            ),
        }),
    }),
})
