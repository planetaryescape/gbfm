import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from '../../message'

export const draftBadge = <Msg>(h: HtmlBuilder<Msg>) =>
  h.span(
    [
      h.Class(
        'inline-flex w-fit rounded-sm border border-highlight/40 bg-highlight/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-foreground',
      ),
    ],
    ['Draft'],
  )

export const draftNotice = (h: HtmlBuilder<Message>, slug: string) =>
  h.aside(
    [
      h.AriaLabel('Private draft'),
      h.Class(
        'my-6 flex flex-wrap items-center justify-between gap-4 rounded-sm border border-highlight/40 bg-highlight/10 p-4',
      ),
    ],
    [
      h.div(
        [],
        [
          draftBadge(h),
          h.p(
            [h.Class('m-0 mt-2 text-sm text-muted-foreground')],
            ['Only you and your co-authors can read this unpublished post.'],
          ),
        ],
      ),
      h.a(
        [h.Href(`/new/editorial?edit=${encodeURIComponent(slug)}`), h.Class('btn btn-sm shrink-0')],
        ['Edit draft'],
      ),
    ],
  )
