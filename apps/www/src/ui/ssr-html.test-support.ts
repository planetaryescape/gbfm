export interface SsrElement {
  readonly tag: string
  readonly html: string
  readonly content: string
  readonly attributes: Readonly<Record<string, string>>
}

const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const decodeText = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')

export const element = (html: string): SsrElement => ({
  tag: 'fixture-root',
  html,
  content: html,
  attributes: {},
})

const readElement = (html: string, opening: RegExpMatchArray): SsrElement => {
  const tag = opening[1] ?? ''
  const attributes: Record<string, string> = {}
  const start = opening.index ?? 0
  const contentStart = start + opening[0].length
  const attributeSource = opening[0].slice(tag.length + 1, -1)

  for (const attribute of attributeSource.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) {
    const name = attribute[1]

    if (name) attributes[name] = decodeText(attribute[2] ?? '')
  }

  if (voidTags.has(tag)) return { tag, html: opening[0], content: '', attributes }

  const pairs = new RegExp(`</?${tag}\\b[^>]*>`, 'g')
  pairs.lastIndex = contentStart
  let depth = 1

  for (let token = pairs.exec(html); token; token = pairs.exec(html)) {
    depth += token[0].startsWith('</') ? -1 : 1

    if (depth === 0)
      return {
        tag,
        html: html.slice(start, pairs.lastIndex),
        content: html.slice(contentStart, token.index),
        attributes,
      }
  }

  throw new Error(`SSR fixture contains an unclosed ${tag} element`)
}

export const hasClass = (node: SsrElement, className: string): boolean =>
  (node.attributes.class ?? '').split(/\s+/).includes(className)

export const findAll = (node: SsrElement, selector: string): ReadonlyArray<SsrElement> =>
  Array.from(node.html.matchAll(/<([a-z][a-z0-9:-]*)\b[^>]*>/g))
    .map((opening) => readElement(node.html, opening))
    .filter((candidate) =>
      selector.startsWith('.')
        ? hasClass(candidate, selector.slice(1))
        : candidate.tag === selector,
    )

export const first = (nodes: ReadonlyArray<SsrElement>): SsrElement => {
  const node = nodes[0]

  if (!node) throw new Error('Expected a matching native SSR element')

  return node
}

export const attribute = (node: SsrElement, name: string): string | undefined =>
  node.attributes[name.toLowerCase()]

export const textContent = (node: SsrElement): string =>
  decodeText(node.content.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ''))
