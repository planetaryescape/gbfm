import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from '../../message'

export const readingProgress = (
  h: HtmlBuilder<Message>,
  newerUnread: boolean,
  returnSlug: string | null,
) =>
  newerUnread || returnSlug
    ? h.section(
        [
          h.AriaLabel('Reading progress'),
          h.Class(
            'mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-card p-3 text-sm',
          ),
        ],
        [
          h.p(
            [h.Role('status'), h.Class('m-0 text-muted-foreground')],
            [
              newerUnread
                ? 'Newer unread tweets available.'
                : 'Your earlier place is saved for this visit.',
            ],
          ),
          h.div(
            [h.Class('flex flex-wrap gap-2')],
            [
              newerUnread
                ? h.a([h.Href('/tweet/latest'), h.Class('btn btn-primary btn-sm')], ['View latest'])
                : h.empty,
              returnSlug
                ? h.a(
                    [h.Href(`/tweet/${encodeURIComponent(returnSlug)}`), h.Class('btn btn-sm')],
                    ['Back to where I was'],
                  )
                : h.empty,
            ],
          ),
        ],
      )
    : h.empty
