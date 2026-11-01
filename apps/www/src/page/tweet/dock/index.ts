import type { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from '../../../message'
import { iconPaths, lucide } from '../../../view/icons'
import { monthLabel, monthOf } from '../timeline'
import { readerActions } from './actions'
import { monthPicker } from './month-picker'

const arrowClass = 'btn flex-1'

const arrow = (
  h: HtmlBuilder<Message>,
  direction: 'newer' | 'older',
  slug: string | null | undefined,
) => {
  const label = direction === 'newer' ? 'Newer' : 'Older'

  const content =
    direction === 'newer'
      ? [lucide(iconPaths.chevronLeft, 'size-5'), label]
      : [label, lucide(iconPaths.chevronRight, 'size-5')]

  if (!slug)
    return h.span(
      [h.AriaHidden(true), h.Class(`${arrowClass} pointer-events-none opacity-30`)],
      content,
    )

  return h.a(
    [
      h.Id(`tweet-${direction}`),
      h.Href(`/tweet/${encodeURIComponent(slug)}`),
      h.AriaLabel(`${label} tweet`),
      h.Class(arrowClass),
    ],
    content,
  )
}

const unreadSummary = (
  h: HtmlBuilder<Message>,
  count: number | null,
  checking: boolean,
  stale: boolean,
) => {
  if (count === null) return h.span([], [checking ? 'checking unread' : 'unread unavailable'])

  if (count === 0) return h.span([], ['caught up'])

  return h.span([h.Class(stale ? 'text-highlight/60' : 'text-highlight')], [`${count} unread`])
}

export const readerHeader = (
  h: HtmlBuilder<Message>,
  input: {
    readonly slug: string
    readonly at: string
    readonly newer: string | null | undefined
    readonly older: string | null | undefined
    readonly neighbours: MicroPostNeighboursResponse | null
    readonly timeline: MicroPostNeighboursResponse | null
    readonly checking: boolean
    readonly failed: boolean
  },
) => {
  const current = monthOf(input.at)
  const count = input.timeline?.unreadCount ?? null

  return h.div(
    [h.Class('tweet-reader-navigation relative shrink-0')],
    [
      h.div(
        [h.Class('relative')],
        [
          h.details(
            [h.Key(input.slug), h.DataAttribute('tweet-dock', ''), h.Class('group')],
            [
              h.summary(
                [
                  h.AriaLabel('Reading options'),
                  h.Class(
                    'btn btn-quiet cursor-pointer list-none [&::-webkit-details-marker]:hidden',
                  ),
                ],
                [
                  lucide(
                    iconPaths.chevronDown,
                    'size-5 shrink-0 transition-transform group-open:rotate-180',
                  ),
                  'Options',
                ],
              ),
              h.div(
                [
                  h.Class(
                    'tweet-reader-options absolute right-0 top-full z-30 mt-2 max-h-[min(70dvh,36rem)] w-[min(24rem,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl',
                  ),
                ],
                [
                  h.div(
                    [
                      h.Class(
                        'flex items-baseline justify-between gap-3 text-xs text-muted-foreground',
                      ),
                    ],
                    [
                      h.span([h.Class('text-sm text-foreground')], [monthLabel(current)]),
                      unreadSummary(h, count, input.checking, input.neighbours === null),
                    ],
                  ),
                  h.div(
                    [h.Class('flex gap-2')],
                    [arrow(h, 'newer', input.newer), arrow(h, 'older', input.older)],
                  ),
                  readerActions(h, {
                    slug: input.slug,
                    neighbours: input.neighbours,
                    checking: input.checking,
                    failed: input.failed,
                  }),
                  monthPicker(h, input.timeline?.timeline ?? [], current),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}
