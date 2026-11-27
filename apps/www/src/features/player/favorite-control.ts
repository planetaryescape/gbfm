import { Command, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Effect, Predicate, Schema } from 'effect'

import type { MembershipEntry } from '../../domain/membership'
import { iconPaths, lucide } from '../../ui/icons'
import { MembershipMessage, MembershipProvider, membershipKey } from '../public-actions/provider'
import { safeReturnTo } from './domain'
import { PlayerProvider } from './provider'

const favoriteNotice = (entry: MembershipEntry | undefined) => {
  if (entry?.status === 'unavailable') return 'Favorite status could not be loaded.'

  if (entry?.notice === 'Could not save. Try again.')
    return 'Favorite could not be saved. Try again.'

  return entry?.notice ?? null
}

export const PlayerFavoriteMessage = UiSchema.TaggedEnum({
  ChangedContext: {},
  RequestedToggleFavorite: {},
  RequestedRetryFavorite: {},
  DismissedNotice: { key: Schema.String },
})

export const ObserveFavoriteContext = Command.make('ObserveFavoriteContext', { args: {} }, () =>
  Effect.succeed(PlayerFavoriteMessage.ChangedContext()),
)

export const WaitBeforeFavoriteNoticeDismissal = Command.make(
  'WaitBeforeFavoriteNoticeDismissal',
  {
    args: { key: Schema.String },
  },
  ({ key }) =>
    Effect.sleep('4 seconds').pipe(Effect.as(PlayerFavoriteMessage.DismissedNotice({ key }))),
)

const heartButton =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-[0.75rem] border-0 bg-transparent p-0 text-muted-foreground no-underline transition-[transform,background-color,color] hover:bg-foreground/10 hover:text-foreground active:scale-90 aria-pressed:text-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export const PlayerFavorite = Html.component({
  name: 'PlayerFavorite',
  model: Schema.Struct({
    contextKey: Schema.NullOr(Schema.String),
    noticeKey: Schema.NullOr(Schema.String),
    dismissedNoticeKey: Schema.NullOr(Schema.String),
  }),
  message: PlayerFavoriteMessage,
  restore: false,
  reads: {
    player: { owner: PlayerProvider, onChange: () => PlayerFavoriteMessage.ChangedContext() },
    membership: {
      owner: MembershipProvider,
      onChange: () => PlayerFavoriteMessage.ChangedContext(),
    },
  },
}).make({
  init: ($) =>
    $.set({ contextKey: null, noticeKey: null, dismissedNoticeKey: null }).run(
      ObserveFavoriteContext.make(),
    ),
  update: ($, message) => {
    if (Predicate.isTagged(message, 'DismissedNotice'))
      return message.key === $.model.noticeKey
        ? $.evolve({ dismissedNoticeKey: message.key })
        : $.model
    const player = $.reads.player
    const membership = $.reads.membership
    const current = player.snapshot.queue.current

    if (
      !current ||
      !current.slug ||
      membership.principalId !== player.principalId ||
      membership.principalKnown !== player.principalKnown
    )
      return $.model

    const target = {
      kind: 'audio',
      id: current.id,
    } satisfies (typeof MembershipMessage.cases.RequestedMembership.Type)['target']

    const entry = membership.entries[membershipKey(target)]

    if (Predicate.isTagged(message, 'RequestedToggleFavorite')) {
      if (
        !entry ||
        entry.busy ||
        entry.revision === null ||
        !['active', 'inactive'].includes(entry.status)
      )
        return $.model

      return $.send(MembershipProvider, MembershipMessage.RequestedToggleMembership({ target }))
    }

    if (Predicate.isTagged(message, 'RequestedRetryFavorite'))
      return $.send(MembershipProvider, MembershipMessage.RequestedRetryMembership({ target }))
    const key = `${membership.generation}:${membership.principalKnown}:${membership.principalId}:${current.id}`

    if (key !== $.model.contextKey)
      return $.evolve({
        contextKey: key,
        noticeKey: null,
        dismissedNoticeKey: null,
      }).send(MembershipProvider, MembershipMessage.RequestedMembership({ target }))

    const notice = favoriteNotice(entry)

    if (!notice || !entry) return $.model
    const noticeKey = `${key}:${entry.request}:${notice}`

    if ($.model.noticeKey === noticeKey) return $.model

    return $.evolve({ noticeKey, dismissedNoticeKey: null }).run(
      WaitBeforeFavoriteNoticeDismissal.make({ key: noticeKey }),
    )
  },
  view: (h, model) => {
    const player = h.reads.player
    const membership = h.reads.membership
    const current = player.snapshot.queue.current

    if (!current?.slug) return h.text('')

    const matching =
      membership.principalId === player.principalId &&
      membership.principalKnown === player.principalKnown

    const entry = matching
      ? membership.entries[membershipKey({ kind: 'audio', id: current.id })]
      : undefined

    const active = entry?.status === 'active'

    const heart = lucide(
      h,
      iconPaths.heart,
      `size-6 [stroke-linecap:square] [stroke-linejoin:miter] ${active ? 'fill-current' : ''}`,
    )

    const button = h.button.attr('type', 'button').class(heartButton)
    const label = active ? 'Remove from favorites' : 'Add to favorites'

    const control = (() => {
      if (entry?.status === 'anonymous')
        return h.a
          .class(heartButton)
          .attr(
            'href',
            `/auth/sign-in?returnTo=${encodeURIComponent(safeReturnTo(player.returnTo))}`,
          )
          .attr('aria-label', 'Sign in to favorite')
          .attr('title', 'Sign in to favorite')
          .children(heart)

      if (entry?.status === 'unavailable')
        return button
          .attr('aria-label', 'Retry loading favorite')
          .attr('title', 'Retry loading favorite')
          .on('click', PlayerFavoriteMessage.RequestedRetryFavorite())
          .children(heart)

      if (entry?.status === 'active' || entry?.status === 'inactive')
        return button
          .disabled(entry.busy || entry.revision === null)
          .attr('aria-busy', String(entry.busy))
          .attr('aria-pressed', String(active))
          .attr('aria-label', label)
          .attr('title', label)
          .on('click', PlayerFavoriteMessage.RequestedToggleFavorite())
          .children(heart)

      return button
        .disabled(true)
        .attr('aria-busy', 'true')
        .attr('aria-label', 'Checking favorite')
        .children(heart)
    })()

    const notice = favoriteNotice(entry)
    const showNotice = notice && model.noticeKey && model.noticeKey !== model.dismissedNoticeKey

    return h.div.class('relative shrink-0').children(
      control,
      Boolean(showNotice) &&
        h.div
          .key(model.noticeKey ?? '')
          .attr('role', 'status')
          .attr('aria-live', 'polite')
          .attr('aria-atomic', 'true')
          .class(
            'absolute bottom-full right-0 z-10 mb-3 flex w-64 items-center gap-2 rounded border border-highlight/40 bg-background pl-4 text-sm text-foreground shadow-lg',
          )
          .children(
            h.span.class('min-w-0 flex-1 py-3').children(notice ?? ''),
            h.button
              .attr('type', 'button')
              .attr('aria-label', 'Dismiss favorite notice')
              .class('btn btn-quiet btn-icon')
              .on('click', PlayerFavoriteMessage.DismissedNotice({ key: model.noticeKey ?? '' }))
              .children(lucide(h, iconPaths.close, 'size-4')),
          ),
    )
  },
})
