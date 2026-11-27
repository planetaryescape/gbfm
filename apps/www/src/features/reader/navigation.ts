import type { Html } from '@effect/ui/html'
import type { MicroPostNeighboursResponse, MicroPostTimelineMonth } from '@gbfm/api/navigation'

import { tweetHref } from './cards'
import { ReaderPageMessage, type ReaderPageModel } from './contracts'
import { nextUnread, UnreadTarget } from './decisions'
import { ReaderNewer, ReaderOlder } from './mounts'
import { monthLabel, timelineMonths } from './timeline'

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
) =>
  h.nav
    .attr('aria-label', 'Tweet reader')
    .class('space-y-3')
    .children(
      h.div
        .class('flex gap-2')
        .children(
          NavigationArrow(h, 'newer', chronological?.newer),
          NavigationArrow(h, 'older', chronological?.older),
          h.a
            .attr('href', '/tweet/latest')
            .class('btn')
            .on('click', ReaderPageMessage.ClickedLatest())
            .children('Latest'),
        ),
      h.details
        .attr('data-tweet-dock', '')
        .class('group')
        .children(
          h.summary
            .attr('aria-label', 'Reading options')
            .class('btn btn-quiet cursor-pointer')
            .children('Options'),
          h.div.class('space-y-3 rounded-md border border-border p-4').children(
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
              .class('flex flex-wrap gap-2')
              .children(
                timelineMonths(timeline).map((month) =>
                  month.newestSlug
                    ? h.a
                        .attr('href', tweetHref(month.newestSlug))
                        .class('btn')
                        .children(`${monthLabel(month.month)} · ${month.unread}/${month.total}`)
                    : h.span.class('btn opacity-30').children(monthLabel(month.month)),
                ),
              ),
          ),
        ),
      (neighbours?.newerUnread || model.returnSlug) &&
        h.section
          .attr('aria-label', 'Reading progress')
          .class('flex flex-wrap items-center justify-between gap-3 border border-border p-3')
          .children(
            h.p
              .attr('role', 'status')
              .children(
                neighbours?.newerUnread
                  ? 'Newer unread tweets available.'
                  : 'Your earlier place is saved for this visit.',
              ),
            neighbours?.newerUnread &&
              h.a
                .attr('href', '/tweet/latest')
                .on('click', ReaderPageMessage.ClickedLatest())
                .class('btn btn-primary')
                .children('View latest'),
            model.returnSlug &&
              h.a
                .attr('href', tweetHref(model.returnSlug))
                .class('btn')
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
