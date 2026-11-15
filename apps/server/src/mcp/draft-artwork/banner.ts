import remarkParse from 'remark-parse'
import { unified } from 'unified'

export const attachLeadingBanner = (content: string, url: string, alt: string): string => {
  const layout = /^(?:\s*::layout\{[^\r\n]*\}[ \t]*(?:\r?\n|$))/.exec(content)?.[0] ?? ''
  const body = content.slice(layout.length)
  const first = unified().use(remarkParse).parse(body).children[0]
  const escapedAlt = alt.replace(/[\\[\]()*_`<>!]/g, '\\$&')
  const image = `![${escapedAlt}](${url})`

  if (
    first?.type === 'paragraph' &&
    first.children.length === 1 &&
    first.children[0]?.type === 'image' &&
    first.position?.start.offset !== undefined &&
    first.position.end.offset !== undefined
  ) {
    return `${layout}${body.slice(0, first.position.start.offset)}${image}${body.slice(first.position.end.offset)}`
  }

  const prefix = layout ? `${layout}${layout.endsWith('\n') ? '' : '\n'}\n` : ''

  return `${prefix}${image}\n\n${body}`
}
