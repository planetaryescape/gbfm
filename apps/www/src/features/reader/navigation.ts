import type { Html } from '@effect/ui/html'
import type { MicroPostNeighboursResponse, MicroPostTimelineMonth } from '@gbfm/api/navigation'

import { tweetHref } from './cards'
import { ReaderPageMessage, type ReaderPageModel } from './contracts'
import { nextUnread, UnreadTarget } from './decisions'
import { ReaderMonthPicker } from './month-picker'
import { ReaderNewer, ReaderOlder } from './mounts'

export const NavigationArrow = (
  h: Html.H<ReaderPageMessage>,
  direction: 'newer' | 'older',
  slug: string | null | undefined,
) => {
  const label = direction === 'newer' ? 'Newer' : 'Older'

  if (!slug) return h.span.attr('aria-disabled', 'true').class('btn opacity-30').children(label)

  return h.a
    .ref(direction === 'newer' ? ReaderNewer : ReaderOlder)
    .attr('id', `tweet-${direction}`)
    .attr(`data-reader-${direction}`, '')
    .attr('href', tweetHref(slug))
    .attr('aria-label', `${label} tweet`)
    .class('btn')
    .children(label)
}

const ResetForm = (h: Html.H<ReaderPageMessage>, slug: string, label: string) =>
  h.form
    .attrs({ method: 'post', action: '/actions/tweet-reset' })
    .children(
      h.input.attrs({ type: 'hidden', name: 'slug', value: slug }),
      h.button.attr('type', 'submit').class('btn btn-primary').children(label),
    )

export const ReaderNavigation = (
  h: Html.H<ReaderPageMessage>,
  model: ReaderPageModel,
  slug: string,
  neighbours: MicroPostNeighboursResponse | null,
  chronological: MicroPostNeighboursResponse | null,
  checking: boolean,
  failed: boolean,
  timeline: ReadonlyArray<MicroPostTimelineMonth>,
  currentMonth: string,
) =>
  h.nav
    .attr('aria-label', 'Tweet reader')
    .class('tweet-reader-navigation relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2')
    .children(
      h.div
        .class('flex items-center gap-2')
        .children(
          NavigationArrow(h, 'newer', chronological?.newer),
          NavigationArrow(h, 'older', chronological?.older),
        ),
      h.details
        .key(slug)
        .attr('data-tweet-dock', '')
        .class('group relative')
        .children(
          h.summary
            .attr('aria-label', 'Reading options')
            .class('btn btn-quiet cursor-pointer text-xs text-muted-foreground')
            .children('Options'),
          h.div
            .class(
              'tweet-reader-options absolute right-0 top-full z-30 mt-2 max-h-[min(70dvh,36rem)] w-[min(24rem,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl',
            )
            .children(
              h.a
                .attr('href', '/tweet/latest')
                .class('btn')
                .on('click', ReaderPageMessage.ClickedLatest())
                .children('Latest'),
              UnreadTarget.$match(nextUnread(neighbours), {
                Older: ({ slug }) =>
                  h.a
                    .attr('href', tweetHref(slug))
                    .class('btn btn-primary')
                    .attr('aria-label', 'Next unread (older)')
                    .children('Next unread · older'),
                Newer: ({ slug }) =>
                  h.a
                    .attr('href', tweetHref(slug))
                    .class('btn btn-primary')
                    .attr('aria-label', 'Next unread (newer)')
                    .children('Next unread · newer'),
                CaughtUp: () =>
                  h.div.children(
                    h.p.attr('role', 'status').children('Caught up'),
                    ResetForm(h, slug, 'Start over'),
                  ),
                Unavailable: () =>
                  h.div.children(
                    h.p
                      .attr('role', 'status')
                      .children(checking ? 'Checking unread…' : 'Unread navigation unavailable'),
                    failed &&
                      h.button
                        .attr('type', 'button')
                        .class('btn')
                        .on('click', ReaderPageMessage.ClickedRetryNavigation())
                        .children('Retry navigation'),
                  ),
              }),
              neighbours !== null &&
                h.p.attr('role', 'status').children(`${neighbours.unreadCount} unread`),
              h.form.attrs({ method: 'post', action: '/actions/tweet-random' }).children(
                h.input.attrs({ type: 'hidden', name: 'slug', value: slug }),
                h.button
                  .attr('type', 'submit')
                  .attrs({
                    disabled: UnreadTarget.$is('CaughtUp')(nextUnread(neighbours)) ? '' : undefined,
                  })
                  .class('btn')
                  .children('Surprise me'),
              ),
              h.details.children(
                h.summary.class('btn btn-quiet').children('Reset reading history…'),
                h.p.children('Mark every tweet as unread again and start from the latest.'),
                ResetForm(h, slug, 'Reset'),
              ),
              h.nav
                .attr('aria-label', 'Reading timeline')
                .children(ReaderMonthPicker(h, timeline, currentMonth)),
            ),
        ),
      (neighbours?.newerUnread || model.returnSlug) &&
        h.section
          .attr('aria-label', 'Reading progress')
          .class('ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground')
          .children(
            h.p
              .attr('role', 'status')
              .class('sr-only')
              .children(
                neighbours?.newerUnread
                  ? 'Newer unread tweets available.'
                  : 'Your earlier place is saved for this visit.',
              ),
            neighbours?.newerUnread &&
              h.a
                .attr('href', '/tweet/latest')
                .on('click', ReaderPageMessage.ClickedLatest())
                .class(
                  'inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground no-underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )
                .children('View latest'),
            model.returnSlug &&
              h.a
                .attr('href', tweetHref(model.returnSlug))
                .class(
                  'inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )
                .children('Back to where I was'),
          ),
      model.current !== null &&
        model.visits[model.current] === 'failed' &&
        h.p
          .attr('role', 'alert')
          .children(
            'Reading history could not be saved. ',
            h.button
              .attr('type', 'button')
              .class('btn')
              .on('click', ReaderPageMessage.ClickedRetryVisit())
              .children('Retry saving history'),
          ),
    )
