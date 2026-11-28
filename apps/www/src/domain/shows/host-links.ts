/* oxlint-disable anti-slop-effect/no-manual-tagged-construction, anti-slop-effect/no-manual-tag-comparison -- Schema-owned recursive rich-content unions have no generated constructors or matchers; the switches stay exhaustive at compile time. */
import type {
  RichContentBlock,
  RichContentDocument,
  RichContentInline,
} from '@gbfm/rich-content/schema'
import { safeUrl } from '@gbfm/rich-content/source'

export type LinkableHost = {
  readonly name: string
  readonly username?: string | null
}

type HostLink = { readonly name: string; readonly href: NonNullable<ReturnType<typeof safeUrl>> }

const splitText = (
  value: string,
  links: ReadonlyArray<HostLink>,
): ReadonlyArray<RichContentInline> => {
  let earliest: { index: number; link: HostLink } | null = null

  for (const link of links) {
    const index = value.indexOf(link.name)

    if (index !== -1 && (earliest === null || index < earliest.index)) earliest = { index, link }
  }

  if (earliest === null) return [{ _tag: 'Text', value }]

  const { index, link } = earliest
  const before = value.slice(0, index)
  const after = value.slice(index + link.name.length)

  return [
    ...(before ? [{ _tag: 'Text' as const, value: before }] : []),
    {
      _tag: 'Link' as const,
      href: link.href,
      title: null,
      children: [{ _tag: 'Text' as const, value: link.name }],
    },
    ...(after ? splitText(after, links) : []),
  ]
}

const linkInlines = (
  inlines: ReadonlyArray<RichContentInline>,
  links: ReadonlyArray<HostLink>,
): ReadonlyArray<RichContentInline> =>
  inlines.flatMap((inline): ReadonlyArray<RichContentInline> => {
    switch (inline._tag) {
      case 'Text':
        return splitText(inline.value, links)
      case 'Emphasis':
      case 'Strong':
      case 'Delete':
        return [{ ...inline, children: linkInlines(inline.children, links) }]
      default:
        return [inline]
    }
  })

const linkBlock = (block: RichContentBlock, links: ReadonlyArray<HostLink>): RichContentBlock => {
  switch (block._tag) {
    case 'Paragraph':
      return { ...block, children: linkInlines(block.children, links) }
    case 'Quote':
    case 'CardGroup':
      return { ...block, children: block.children.map((child) => linkBlock(child, links)) }
    case 'List':
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          children: item.children.map((child) => linkBlock(child, links)),
        })),
      }
    default:
      return block
  }
}

/** Show write-ups mention hosts by display name; turn those mentions into profile links. */
export const linkHostMentions = (
  document: RichContentDocument,
  hosts: ReadonlyArray<LinkableHost>,
): RichContentDocument => {
  const links = hosts.flatMap((host): ReadonlyArray<HostLink> => {
    const href = host.username ? safeUrl(`/${encodeURIComponent(host.username)}`, 'link') : null

    return href && host.name.trim() ? [{ name: host.name, href }] : []
  })

  if (!links.length) return document

  return { ...document, blocks: document.blocks.map((block) => linkBlock(block, links)) }
}
