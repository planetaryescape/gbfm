export interface MusicMention {
  readonly start: number
  readonly end: number
  readonly reference: number
}

const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ').toLowerCase()

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

export const musicMentions = (
  text: string,
  titles: ReadonlyArray<string>,
): ReadonlyArray<MusicMention> => {
  const candidates = titles
    .flatMap((title, reference) => {
      const normalized = normalize(title)

      return normalized.length > 0 ? [{ title: normalized, reference }] : []
    })
    .sort((left, right) => right.title.length - left.title.length)

  if (candidates.length === 0) return []

  const alternatives = candidates.map(({ title }) =>
    title.split(' ').map(escapePattern).join('\\s+'),
  )

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  )

  return Array.from(text.matchAll(pattern)).flatMap((match) => {
    const matched = normalize(match[0])
    const references = candidates.filter(({ title }) => title === matched)

    if (references.length !== 1) return []

    return references.map(({ reference }) => ({
      start: match.index,
      end: match.index + match[0].length,
      reference,
    }))
  })
}
