import { getMixRecencyLabel } from '@gbfm/core/utils'
import { inertHtml as h } from 'foldkit/html'

import type { ContentItem } from '../../model'
import { artwork } from '../../view/artwork'
import { formatDate } from '../../view/format-date'
import { iconPaths, lucide } from '../../view/icons'
import { draftBadge } from '../content/draft-notice'

const recency = (label: 'new' | 'recent') =>
  h.div(
    [
      h.Class(
        `mb-1 flex items-center gap-1 text-[10px] font-bold tracking-widest ${
          label === 'new' ? 'text-highlight' : 'text-muted-foreground'
        }`,
      ),
    ],
    [lucide(iconPaths.sparkles, 'w-3 h-3'), label],
  )

const byline = (item: ContentItem) => {
  const creators = item.creators ?? []

  if (creators.length === 0 && !item.meta) return h.empty

  return h.div(
    [
      h.Class(
        'mt-2 flex flex-wrap items-center gap-x-1.5 text-xs tracking-widest text-muted-foreground/90',
      ),
    ],
    [
      ...(creators.length > 0
        ? [
            h.span([h.Class('opacity-60')], ['By ']),
            ...creators.map((creator, index) =>
              h.span(
                [h.Key(creator.id)],
                [
                  creator.username
                    ? h.a(
                        [
                          h.Href(`/profile/${encodeURIComponent(creator.username)}`),
                          h.Class(
                            'font-semibold text-foreground/90 hover:text-foreground hover:underline',
                          ),
                        ],
                        [creator.name],
                      )
                    : h.span([h.Class('font-semibold text-foreground/90')], [creator.name]),
                  index < creators.length - 1
                    ? h.span([h.Class('mx-1 opacity-50')], ['&'])
                    : h.empty,
                ],
              ),
            ),
          ]
        : []),
      creators.length > 0 && item.meta ? h.span([h.Class('opacity-40')], ['·']) : h.empty,
      item.meta ? h.span([], [formatDate(item.meta)]) : h.empty,
    ],
  )
}

const listItem = (item: ContentItem, renderedAt: number) => {
  const label = item.meta ? getMixRecencyLabel(item.meta, renderedAt) : null
  const tags = item.tags ?? []

  return h.article(
    [
      h.Key(item.id),
      h.Class(
        'group relative flex gap-3 items-start border border-border bg-card p-3 sm:p-4 transition-all duration-200 hover:bg-muted hover:border-foreground hover:shadow-sm',
      ),
    ],
    [
      artwork(
        item.imageUrl,
        item.title,
        '80px',
        false,
        'object-cover transition-transform duration-300 border w-16 h-16 sm:w-20 sm:h-20 border-border bg-background group-hover:scale-101 shrink-0',
      ),
      h.div(
        [h.Class('flex-1 min-w-0')],
        [
          item.draft ? draftBadge(h) : label ? recency(label) : h.empty,
          h.a(
            [
              h.Href(item.href),
              h.Class(
                'block text-base sm:text-lg font-extrabold leading-tight line-clamp-2 text-foreground hover:underline decoration-foreground/30 underline-offset-4',
              ),
            ],
            [item.title],
          ),
          byline(item),
          item.description
            ? h.div(
                [h.Class('mt-2 text-base leading-relaxed text-foreground/70 line-clamp-2')],
                [item.description],
              )
            : h.empty,
          tags.length > 0
            ? h.div(
                [
                  h.Class(
                    'mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs tracking-wide text-muted-foreground/80',
                  ),
                ],
                tags.map((tag) =>
                  h.a(
                    [
                      h.Key(tag),
                      h.Href(`/tags/${encodeURIComponent(tag)}`),
                      h.Class('hover:text-foreground hover:underline'),
                    ],
                    [`#${tag}`],
                  ),
                ),
              )
            : h.empty,
        ],
      ),
    ],
  )
}

export const view = (
  items: ReadonlyArray<ContentItem>,
  renderedAt: number,
  failure: string | null,
) =>
  h.div(
    [h.Class('max-w-2xl mx-auto px-4 py-8')],
    [
      items.some((item) => item.draft)
        ? h.p(
            [h.Class('mb-4 text-sm text-muted-foreground')],
            ['Your drafts are marked below. They are only visible to their authors.'],
          )
        : h.empty,
      failure
        ? h.p([h.Role('alert'), h.Class('py-8 text-sm text-muted-foreground')], [failure])
        : h.empty,
      h.div(
        [h.Class('grid gap-3')],
        items.map((item) => listItem(item, renderedAt)),
      ),
    ],
  )
