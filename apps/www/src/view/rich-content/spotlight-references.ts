import type { RichContentBlock, RichContentInline } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { musicMentions } from './music-mentions'
import { inlineChildren } from './render'

const musicBlocks = (
  blocks: ReadonlyArray<RichContentBlock>,
): ReadonlyArray<Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>> =>
  blocks.flatMap((block) => {
    if (Predicate.isTagged(block, 'MusicEmbed')) return [block]

    if (Predicate.isTagged(block, 'CardGroup')) return musicBlocks(block.children)

    return []
  })

const inlineText = (inline: RichContentInline): string => {
  if ('value' in inline) return inline.value

  if ('children' in inline) return inline.children.map(inlineText).join('')

  return ''
}

export const spotlightReferences = <Message>(
  blocks: ReadonlyArray<RichContentBlock>,
  h: HtmlBuilder<Message>,
  render: (block: RichContentBlock) => Html,
) => {
  const music = musicBlocks(blocks)
  const titles = music.map((block) => block.music.title)

  const mention = (
    references: ReadonlyArray<number>,
    children: ReadonlyArray<Html | string>,
    focusable: boolean,
  ) =>
    h.span(
      [
        h.Class('spotlight-mention'),
        h.DataAttribute('music-mention', references.join(' ')),
        ...(focusable ? [h.Tabindex(0)] : []),
      ],
      children,
    )

  const inline = (value: RichContentInline): ReadonlyArray<Html | string> => {
    const matches = musicMentions(inlineText(value), titles)

    if (matches.length === 0) return inlineChildren([value], h)

    if (!Predicate.isTagged(value, 'Text')) {
      return [
        mention(
          matches.map(({ reference }) => reference),
          inlineChildren([value], h),
          !Predicate.isTagged(value, 'Link'),
        ),
      ]
    }

    const children: Array<Html | string> = []
    let cursor = 0

    for (const match of matches) {
      children.push(value.value.slice(cursor, match.start))
      children.push(mention([match.reference], [value.value.slice(match.start, match.end)], true))
      cursor = match.end
    }

    children.push(value.value.slice(cursor))

    return children
  }

  const blockView = (block: RichContentBlock): Html => {
    if (Predicate.isTagged(block, 'MusicEmbed')) {
      return h.div(
        [
          h.Class('spotlight-reference-card'),
          h.DataAttribute('music-card', String(music.indexOf(block))),
        ],
        [render(block)],
      )
    }

    if (Predicate.isTagged(block, 'Paragraph')) {
      return h.p([], block.children.flatMap(inline))
    }

    if (Predicate.isTagged(block, 'CardGroup')) {
      return h.div(
        [h.Class('rich-content-card-group'), h.Role('group'), h.AriaLabel('Related music')],
        block.children.map(blockView),
      )
    }

    return render(block)
  }

  const rules = music
    .map(
      (_, index) =>
        `.spotlight-moment:has([data-music-mention~="${index}"]:is(:hover, :focus-within)) [data-music-card="${index}"] > .rich-content-music-card { border-color: var(--highlight); box-shadow: 0 0 0 1px var(--highlight); background: color-mix(in srgb, var(--highlight) 6%, var(--card)); }`,
    )
    .join('\n')

  return { render: blockView, styles: h.style([], [rules]) }
}
