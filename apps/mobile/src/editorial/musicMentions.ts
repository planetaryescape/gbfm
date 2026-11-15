export interface MusicMention {
  readonly start: number
  readonly end: number
  readonly reference: number
}

const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ').toLowerCase()

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** Where prose names one of the step's records, matched as whole words; ambiguous titles are skipped. */
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

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${candidates.map(({ title }) => title.split(' ').map(escapePattern).join('\\s+')).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  )

  return Array.from(text.matchAll(pattern)).flatMap((match) => {
    const references = candidates.filter(({ title }) => title === normalize(match[0]))

    return references.length === 1 && references[0]
      ? [
          {
            start: match.index,
            end: match.index + match[0].length,
            reference: references[0].reference,
          },
        ]
      : []
  })
}

export interface MentionSegment {
  readonly start: number
  readonly text: string
  readonly reference: number | null
}

/** Splits prose into plain runs and mentioned titles, keyed by where each starts. */
export const mentionSegments = (
  text: string,
  mentions: ReadonlyArray<MusicMention>,
): ReadonlyArray<MentionSegment> => {
  const segments: Array<MentionSegment> = []
  let cursor = 0

  for (const mention of mentions) {
    if (mention.start > cursor)
      segments.push({ start: cursor, text: text.slice(cursor, mention.start), reference: null })
    segments.push({
      start: mention.start,
      text: text.slice(mention.start, mention.end),
      reference: mention.reference,
    })
    cursor = mention.end
  }

  if (cursor < text.length)
    segments.push({ start: cursor, text: text.slice(cursor), reference: null })

  return segments
}
