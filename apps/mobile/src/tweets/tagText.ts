const tagBody = String.raw`[^\s#.,;:!?()[\]{}<>"'\x60]+`

const linkSource = String.raw`https?:\/\/[^\s<>"'\x60)\]}]+`

const tagPattern = () => new RegExp(String.raw`(^|\s)#(${tagBody})`, 'g')

export const tagKey = (tag: string) => tag.toLowerCase().replaceAll(/[\s_-]+/g, '')

export const tagLabel = (tag: string) => tag.replaceAll('_', ' ')

export const tagToken = (tag: string) => tag.trim().replaceAll(/\s+/g, '_')

const preferred = (current: string | undefined, candidate: string) =>
  !current || (/\s/.test(candidate) && !/\s/.test(current)) ? candidate : current

export const resolveTag = (token: string, known: ReadonlyArray<string>) => {
  const key = tagKey(token)

  const match = known
    .filter((tag) => tagKey(tag) === key)
    .reduce<string | undefined>(preferred, undefined)

  return match ?? tagLabel(token).toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

export const extractTags = (text: string, known: ReadonlyArray<string> = []) => {
  const seen = new Map<string, string>()

  for (const [, , token] of text.matchAll(tagPattern())) {
    if (token && tagKey(token) && !seen.has(tagKey(token)))
      seen.set(tagKey(token), resolveTag(token, known))
  }

  return [...seen.values()]
}

export const tidyText = (text: string) =>
  text
    .split('\n')
    .map((line) =>
      line
        .replaceAll(/[ \t]{2,}/g, ' ')
        .replaceAll(/ ([,.;:!?])/g, '$1')
        .trim(),
    )
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()

export const stripTags = (text: string) => tidyText(text.replaceAll(tagPattern(), '$1'))

export const tagsLine = (tags: ReadonlyArray<string>) =>
  tags.map((tag) => `#${tagToken(tag)}`).join(' ')

export type TextSegment = {
  readonly kind: 'text' | 'tag' | 'link'
  readonly value: string
  readonly offset: number
}

export const segmentText = (text: string): ReadonlyArray<TextSegment> => {
  const pattern = new RegExp(`(${linkSource})|(^|\\s)(#${tagBody})`, 'g')
  const segments: Array<TextSegment> = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const [, link, space = '', tag] = match
    const start = match.index + space.length
    const value = link ?? tag ?? ''

    if (start > cursor)
      segments.push({ kind: 'text', value: text.slice(cursor, start), offset: cursor })
    segments.push({ kind: link ? 'link' : 'tag', value, offset: start })
    cursor = start + value.length
  }

  if (cursor < text.length)
    segments.push({ kind: 'text', value: text.slice(cursor), offset: cursor })

  return segments
}
