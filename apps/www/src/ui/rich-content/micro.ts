import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'
import type { MicroEmbedMetadata, RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'

import { formatDate } from '../../domain/format/date'
import { artwork } from '../artwork'

type Micro = typeof MicroEmbedMetadata.Type

type Author = Micro['authors'][number]

const avatarSize = 36

const permalinkOf = (micro: Micro) => `/tweet/${encodeURIComponent(micro.slug)}`

const profileHref = (username: string) => `/profile/${encodeURIComponent(username)}`

const isPermalinkParagraph = (block: RichContentBlock, permalink: string): boolean =>
  Predicate.isTagged(block, 'Paragraph') &&
  block.children.length === 1 &&
  block.children.every((child) => Predicate.isTagged(child, 'Link') && child.href === permalink)

const displayDate = (createdAt: string) =>
  Number.isNaN(Date.parse(createdAt)) ? createdAt.slice(0, 10) : formatDate(createdAt)

const avatarView = <Message>(h: Html.H<Message>, author: Author | undefined) =>
  author?.image
    ? [
        h.span.class('rich-content-micro-avatar').children([
          artwork(h, author.image, `${author.name}'s avatar`, `${avatarSize}px`, false, '', {
            width: avatarSize,
            height: avatarSize,
          }),
        ]),
      ]
    : []

export const microView = <Message>(
  h: Html.H<Message>,
  micro: Micro,
  blocks: ReadonlyArray<RichContentBlock>,
  renderBlock: (block: RichContentBlock) => View.Content<Message>,
): View.Content<Message> => {
  const authors = micro.authors.map((author) => author.name).join(', ') || 'GBFM'
  const permalink = permalinkOf(micro)
  const last = blocks.at(-1)

  const bodyBlocks =
    last !== undefined && isPermalinkParagraph(last, permalink) ? blocks.slice(0, -1) : blocks

  const names =
    micro.authors.length === 0
      ? ['GBFM']
      : micro.authors.flatMap((author, index) => [
          ...(index === 0 ? [] : [', ']),
          author.username
            ? h.a.attr('href', profileHref(author.username)).children([author.name])
            : h.span.children([author.name]),
        ])

  return h.article
    .class('rich-content-micro not-prose')
    .attr('aria-label', `Embedded note by ${authors}`)
    .children([
      ...avatarView(h, micro.authors[0]),
      h.div.class('rich-content-micro-main').children([
        h.header.class('rich-content-micro-header').children([
          h.span.class('rich-content-micro-author').children(names),
          h.a
            .attr('href', permalink)
            .class('rich-content-micro-date')
            .attr('aria-label', 'View original note on GBFM')
            .children([
              h.time.attr('datetime', micro.createdAt).children([displayDate(micro.createdAt)]),
            ]),
        ]),
        h.div
          .class('rich-content-micro-body')
          .children([
            ...(micro.title === null
              ? []
              : [h.h3.class('rich-content-micro-title').children([micro.title])]),
            ...bodyBlocks.map(renderBlock),
          ]),
      ]),
    ])
}
