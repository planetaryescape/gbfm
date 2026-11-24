import type { MicroEmbedMetadata, RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { artwork } from '../artwork'
import { formatDate } from '../format-date'

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

const avatarView = <Message>(author: Author | undefined, h: HtmlBuilder<Message>) =>
  author?.image
    ? [
        h.span(
          [h.Class('rich-content-micro-avatar')],
          [
            artwork(author.image, `${author.name}'s avatar`, `${avatarSize}px`, false, '', {
              width: avatarSize,
              height: avatarSize,
            }),
          ],
        ),
      ]
    : []

export const microView = <Message>(
  micro: Micro,
  blocks: ReadonlyArray<RichContentBlock>,
  renderBlock: (block: RichContentBlock) => Html,
  h: HtmlBuilder<Message>,
): Html => {
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
            ? h.a([h.Href(profileHref(author.username))], [author.name])
            : h.span([], [author.name]),
        ])

  return h.article(
    [h.Class('rich-content-micro not-prose'), h.AriaLabel(`Embedded note by ${authors}`)],
    [
      ...avatarView(micro.authors[0], h),
      h.div(
        [h.Class('rich-content-micro-main')],
        [
          h.header(
            [h.Class('rich-content-micro-header')],
            [
              h.span([h.Class('rich-content-micro-author')], names),
              h.a(
                [
                  h.Href(permalink),
                  h.Class('rich-content-micro-date'),
                  h.AriaLabel('View original note on GBFM'),
                ],
                [h.time([h.Datetime(micro.createdAt)], [displayDate(micro.createdAt)])],
              ),
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
        ],
      ),
    ],
  )
}
