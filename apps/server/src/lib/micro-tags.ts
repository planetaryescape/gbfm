import { parseRichContent } from '@gbfm/rich-content/source'
import { Predicate } from 'effect'

import { canonicalContentTags, contentTagGroups } from './content-tags'

export const microPostTags = (
  content: string,
  explicitTags: ReadonlyArray<string> = [],
): Array<string> => {
  const inferred = parseRichContent(content).document.blocks.flatMap((block) => {
    if (!Predicate.isTagged(block, 'Paragraph')) return []

    if (!block.children.every((inline) => Predicate.isTagged(inline, 'Text'))) return []

    const text = block.children
      .flatMap((inline) => (Predicate.isTagged(inline, 'Text') ? [inline.value] : []))
      .join('')
      .trim()

    if (!text.startsWith('#')) return []

    const known = contentTagGroups.find((group) =>
      group.aliases.includes(text.slice(1).toLowerCase()),
    )

    if (known) return [known.name]

    if (!/^#[\p{L}\p{N}_-]+(?:\s+#[\p{L}\p{N}_-]+)*$/u.test(text)) return []

    return text.split(/\s+/).map((tag) => tag.slice(1))
  })

  return canonicalContentTags([...explicitTags, ...inferred])
}
