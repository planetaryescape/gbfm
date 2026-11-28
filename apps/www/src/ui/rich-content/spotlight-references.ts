import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'
import type { RichContentBlock, RichContentInline } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'

import { musicMentions } from '../../domain/editorial/music-mentions'
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

export const spotlightReferences = <Message, R = never>(
  h: Html.H<Message>,
  blocks: ReadonlyArray<RichContentBlock>,
  render: (block: RichContentBlock) => View.Content<Message, R>,
) => {
  const music = musicBlocks(blocks)
  const titles = music.map((block) => block.music.title)

  const mention = (
    references: ReadonlyArray<number>,
    children: ReadonlyArray<View.Content<Message> | string>,
    focusable: boolean,
  ) =>
    h.span
      .class('spotlight-mention')
      .attr('data-music-mention', references.join(' '))
      .attrs(focusable ? { tabindex: String(0) } : {})
      .children(children)

  const inline = (value: RichContentInline): ReadonlyArray<View.Content<Message> | string> => {
    const matches = musicMentions(inlineText(value), titles)

    if (matches.length === 0) return inlineChildren(h, [value])

    if (!Predicate.isTagged(value, 'Text')) {
      return [
        mention(
          matches.map(({ reference }) => reference),
          inlineChildren(h, [value]),
          !Predicate.isTagged(value, 'Link'),
        ),
      ]
    }

    const children: Array<View.Content<Message> | string> = []
    let cursor = 0

    for (const match of matches) {
      children.push(value.value.slice(cursor, match.start))
      children.push(mention([match.reference], [value.value.slice(match.start, match.end)], true))
      cursor = match.end
    }

    children.push(value.value.slice(cursor))

    return children
  }

  const blockView = (block: RichContentBlock): View.Content<Message, R> => {
    if (Predicate.isTagged(block, 'MusicEmbed')) {
      return h.div
        .class('spotlight-reference-card')
        .attr('data-music-card', String(music.indexOf(block)))
        .children([render(block)])
    }

    if (Predicate.isTagged(block, 'Paragraph')) {
      return h.p.children(block.children.flatMap(inline))
    }

    if (Predicate.isTagged(block, 'CardGroup')) {
      return h.div
        .class('rich-content-card-group')
        .attr('role', 'group')
        .attr('aria-label', 'Related music')
        .children(block.children.map(blockView))
    }

    return render(block)
  }

  const rules = music
    .map(
      (_, index) =>
        `.spotlight-moment:has([data-music-mention~="${index}"]:is(:hover, :focus-within)) [data-music-card="${index}"] > .rich-content-music-card { border-color: var(--highlight); box-shadow: 0 0 0 1px var(--highlight); background: color-mix(in srgb, var(--highlight) 6%, var(--card)); }`,
    )
    .join('\n')

  return { render: blockView, styles: h.el('style').children([rules]) }
}
