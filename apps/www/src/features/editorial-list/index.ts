import { Html } from '@effect/ui/html'
import { getMixRecencyLabel } from '@gbfm/core/utils'
import { Schema } from 'effect'

import { ContentItem } from '../../domain/content-item'
import { formatDate } from '../../domain/format/date'
import { artwork } from '../../ui/artwork'
import { iconPaths, lucide } from '../../ui/icons'
import { CreatorLinks } from '../content/cards'

export const EditorialListPageProps = Schema.Struct({
  items: Schema.Array(ContentItem),
  renderedAt: Schema.Number,
  failure: Schema.NullOr(Schema.String),
})

export const EditorialListPage = Html.component({
  name: 'EditorialListPage',
  props: EditorialListPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) =>
    h.div.class('max-w-2xl mx-auto px-4 py-8').children(
      h.h1.class('sr-only').children('Editorial'),
      h.props.items.some((item) => item.draft) &&
        h.p
          .class('mb-4 text-sm text-muted-foreground')
          .children('Your drafts are marked below. They are only visible to their authors.'),
      h.props.failure &&
        h.p
          .attr('role', 'alert')
          .class('py-8 text-sm text-muted-foreground')
          .children(h.props.failure),
      h.div.class('grid gap-3').children(
        h.props.items.map((item) => {
          const label = item.meta ? getMixRecencyLabel(item.meta, h.props.renderedAt) : null

          return h.article
            .key(item.id)
            .class(
              'group relative flex gap-3 items-start border border-border bg-card p-3 sm:p-4 transition-all duration-200 hover:bg-muted hover:border-foreground hover:shadow-sm',
            )
            .children(
              artwork(
                h,
                item.imageUrl,
                item.title,
                '80px',
                false,
                'object-cover transition-transform duration-300 border w-16 h-16 sm:w-20 sm:h-20 border-border bg-background group-hover:scale-101 shrink-0',
              ),
              h.div.class('flex-1 min-w-0').children(
                item.draft && h.span.class('profile-draft').children('Draft'),
                !item.draft &&
                  label &&
                  h.div
                    .class(
                      `mb-1 flex items-center gap-1 text-[10px] font-bold tracking-widest ${label === 'new' ? 'text-highlight' : 'text-muted-foreground'}`,
                    )
                    .children(lucide(h, iconPaths.sparkles, 'w-3 h-3'), label),
                h.a
                  .attr('href', item.href)
                  .class(
                    'block text-base sm:text-lg font-extrabold leading-tight line-clamp-2 text-foreground hover:underline decoration-foreground/30 underline-offset-4',
                  )
                  .children(item.title),
                h.div
                  .class(
                    'mt-2 flex flex-wrap items-center gap-x-1.5 text-xs tracking-widest text-muted-foreground/90',
                  )
                  .children(
                    (item.creators?.length ?? 0) > 0 &&
                      h.span.children('By ', CreatorLinks(h, item)),
                    (item.creators?.length ?? 0) > 0 && item.meta && '·',
                    item.meta && h.time.attr('datetime', item.meta).children(formatDate(item.meta)),
                  ),
                item.description &&
                  h.div
                    .class('mt-2 text-base leading-relaxed text-foreground/70 line-clamp-2')
                    .children(item.description),
                h.div
                  .class(
                    'mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs tracking-wide text-muted-foreground/80',
                  )
                  .children(
                    (item.tags ?? []).map((tag) =>
                      h.a
                        .key(tag)
                        .attr('href', `/tags/${encodeURIComponent(tag)}`)
                        .class('hover:text-foreground hover:underline')
                        .children(`#${tag}`),
                    ),
                  ),
              ),
            )
        }),
      ),
    ),
})
