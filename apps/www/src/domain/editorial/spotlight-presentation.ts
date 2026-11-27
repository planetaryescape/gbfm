import type { RichContentBlock, RichContentInline } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'

export type SpotlightBanner = Extract<RichContentInline, { readonly _tag: 'Image' }>

const containsMedia = (block: RichContentBlock): boolean => {
  if (Predicate.isTagged(block, 'MusicEmbed') || Predicate.isTagged(block, 'ExternalMediaEmbed')) {
    return true
  }

  if (Predicate.isTagged(block, 'CardGroup')) return block.children.some(containsMedia)

  return false
}

export const spotlightPresentation = (blocks: ReadonlyArray<RichContentBlock>) => {
  const first = blocks[0]

  const image =
    first && Predicate.isTagged(first, 'Paragraph') && first.children.length === 1
      ? first.children[0]
      : null

  const banner = image && Predicate.isTagged(image, 'Image') ? image : null
  const content = banner ? blocks.slice(1) : blocks
  const separator = content.findLastIndex((block) => Predicate.isTagged(block, 'ThematicBreak'))
  const lastMedia = content.findLastIndex(containsMedia)
  const remaining = content.slice(separator + 1)
  const boundary = remaining.findIndex((block) => Predicate.isTagged(block, 'Heading'))
  const closing = boundary === -1 ? remaining : remaining.slice(0, boundary)

  const hasClosing =
    separator > lastMedia &&
    closing.length > 0 &&
    closing.every(
      (block) => Predicate.isTagged(block, 'Paragraph') || Predicate.isTagged(block, 'Quote'),
    )

  if (!hasClosing) return { banner, blocks: content, closing: [] }

  return {
    banner,
    blocks: [...content.slice(0, separator), ...content.slice(separator + 1 + closing.length)],
    closing,
  }
}
