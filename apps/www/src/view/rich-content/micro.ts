import type { MicroEmbedMetadata, RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { formatDate } from '../format-date'

type Micro = typeof MicroEmbedMetadata.Type

const permalinkLabel = 'View original note on GBFM'

const permalinkOf = (micro: Micro) => `/tweet/${encodeURIComponent(micro.slug)}`

const isPermalinkParagraph = (block: RichContentBlock, permalink: string): boolean =>
  Predicate.isTagged(block, 'Paragraph') &&
  block.children.length === 1 &&
  block.children.every((child) => Predicate.isTagged(child, 'Link') && child.href === permalink)

const displayDate = (createdAt: string) =>
  Number.isNaN(Date.parse(createdAt)) ? createdAt.slice(0, 10) : formatDate(createdAt)

export const microView = <Message>(
  micro: Micro,
  blocks: ReadonlyArray<RichContentBlock>,
  renderBlock: (block: RichContentBlock) => Html,
  h: HtmlBuilder<Message>,
): Html => {
  const authors = micro.authors.map((author) => author.name).join(', ') || 'GBFM'

  const handles = micro.authors.flatMap((author) =>
    author.username ? [`@${author.username}`] : [],
  )

  const permalink = permalinkOf(micro)
  const last = blocks.at(-1)

  const permalinkBlock =
    last !== undefined && isPermalinkParagraph(last, permalink) ? last : undefined

  const bodyBlocks = permalinkBlock === undefined ? blocks : blocks.slice(0, -1)

  const date = h.time(
    [h.Class('rich-content-micro-date'), h.Datetime(micro.createdAt)],
    [displayDate(micro.createdAt)],
  )

  return h.article(
    [h.Class('rich-content-micro not-prose'), h.AriaLabel(`Embedded note by ${authors}`)],
    [
      h.header(
        [h.Class('rich-content-micro-header')],
        [
          h.span([h.Class('rich-content-micro-author')], [authors]),
          ...(handles.length === 0
            ? []
            : [h.span([h.Class('rich-content-micro-handle')], [handles.join(' ')])]),
        ],
      ),
      h.div(
        [h.Class('rich-content-micro-body')],
        [
          ...(micro.title === null
            ? []
            : [h.h3([h.Class('rich-content-micro-title')], [micro.title])]),
          ...bodyBlocks.map(renderBlock),
        ],
      ),
      h.footer(
        [h.Class('rich-content-micro-footer')],
        [
          h.span(
            [h.Class('rich-content-micro-meta')],
            [
              h.span([h.Class('rich-content-micro-dot'), h.AriaHidden(true)], []),
              h.span([h.Class('rich-content-micro-kind')], ['GBFM note']),
              h.span([h.AriaHidden(true)], ['·']),
              permalinkBlock === undefined
                ? h.a([h.Href(permalink), h.Class('rich-content-micro-date-link')], [date])
                : date,
            ],
          ),
          ...(permalinkBlock === undefined
            ? []
            : [
                h.a(
                  [
                    h.Href(permalink),
                    h.Class('rich-content-micro-permalink'),
                    h.AriaLabel(permalinkLabel),
                  ],
                  ['View note'],
                ),
              ]),
        ],
      ),
    ],
  )
}
