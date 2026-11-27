import { Subscription, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Schema, Stream } from 'effect'

import { PublicActionDocument } from '../../domain/public-action'
import { iconPaths, lucide } from '../../ui/icons'
import { MembershipMessage, MembershipProvider, membershipKey } from './provider'

export const MembershipButtonMessage = UiSchema.TaggedEnum({
  RequestedMembership: {},
  ClickedMembership: {},
  ClickedRetryMembership: {},
})

export const MembershipButton = Html.component({
  name: 'MembershipButton',
  props: Schema.Struct({
    document: PublicActionDocument,
    iconOnly: Schema.optional(Schema.Boolean),
  }),
  model: Schema.Struct({}),
  message: MembershipButtonMessage,
  reads: {
    provider: {
      owner: MembershipProvider,
      onChange: () => MembershipButtonMessage.RequestedMembership(),
    },
  },
}).make({
  init: () => ({}),
  subscriptions: ($) => [
    Subscription.make(
      'MembershipButtonTarget',
      [$.props.document.target.kind, $.props.document.target.id],
      () => Stream.succeed(MembershipButtonMessage.RequestedMembership()),
    ),
  ],
  update: {
    RequestedMembership: ($) =>
      $.send(
        MembershipProvider,
        MembershipMessage.RequestedMembership({ target: $.props.document.target }),
      ),
    ClickedMembership: ($) =>
      $.send(
        MembershipProvider,
        MembershipMessage.RequestedToggleMembership({ target: $.props.document.target }),
      ),
    ClickedRetryMembership: ($) =>
      $.send(
        MembershipProvider,
        MembershipMessage.RequestedRetryMembership({ target: $.props.document.target }),
      ),
  },
  view: (h) => {
    const document = h.props.document
    const entry = h.reads.provider.entries[membershipKey(document.target)]

    const status = h.reads.provider.principalKnown
      ? (entry?.status ?? document.state)
      : 'unavailable'

    const active = status === 'active'

    const icon = lucide(
      h,
      document.target.kind === 'show' ? iconPaths.rss : iconPaths.heart,
      `h-5 w-5 ${active ? 'fill-current' : ''}`,
    )

    const buttonClass = h.props.iconOnly
      ? 'inline-flex h-11 w-11 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted aria-pressed:text-highlight disabled:opacity-50'
      : 'inline-flex h-10 items-center gap-2 rounded-sm border border-border px-4 text-sm font-semibold disabled:opacity-50'

    let label = active ? 'Remove from favorites' : 'Add to favorites'

    if (document.target.kind === 'show') label = active ? 'Unsubscribe' : 'Subscribe'
    let text = label

    if (entry?.busy) text = entry.revision === null ? 'Checking…' : 'Saving…'

    if (h.reads.provider.signInRequired || status === 'anonymous')
      return h.a
        .attr('href', `/auth/sign-in?returnTo=${encodeURIComponent(document.path)}`)
        .attr(
          'aria-label',
          `Sign in to ${document.target.kind === 'show' ? 'subscribe' : 'favorite'}`,
        )
        .class(buttonClass)
        .children(
          h.props.iconOnly
            ? icon
            : `Sign in to ${document.target.kind === 'show' ? 'subscribe' : 'favorite'}`,
        )

    return h.div.class('flex flex-wrap items-center gap-3').children(
      status === 'unavailable'
        ? h.button
            .attr('type', 'button')
            .on('click', MembershipButtonMessage.ClickedRetryMembership())
            .children('Retry saved state')
        : h.button
            .attr('type', 'button')
            .class(buttonClass)
            .attr('aria-label', label)
            .attr('aria-pressed', String(active))
            .disabled(!entry || entry.busy || entry.revision === null)
            .on('click', MembershipButtonMessage.ClickedMembership())
            .children(h.props.iconOnly ? icon : h.span.children(text)),
      entry?.notice ? h.p.attr('role', 'status').children(entry.notice) : null,
    )
  },
})
