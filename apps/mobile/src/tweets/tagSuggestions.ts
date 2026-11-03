import { extractTags, tagKey, tagToken } from './tagText'

export const MAX_TAG_SUGGESTIONS = 5

export type ActiveTag = { readonly start: number; readonly end: number; readonly query: string }

const tokenEnd = /^[^\s#.,;:!?()[\]{}<>"'`]*/

export const activeTag = (text: string, cursor: number): ActiveTag | null => {
  const before = text.slice(0, cursor)
  const match = /(^|\s)#([^\s#.,;:!?()[\]{}<>"'`]*)$/.exec(before)

  if (!match) return null
  const [, space = '', query = ''] = match
  const start = match.index + space.length
  const rest = tokenEnd.exec(text.slice(cursor))?.[0] ?? ''

  return { start, end: cursor + rest.length, query }
}

export const suggestTags = (
  known: ReadonlyArray<string>,
  query: string,
  used: ReadonlyArray<string>,
) => {
  const needle = tagKey(query)
  const taken = new Set(used.map(tagKey))
  const seen = new Set<string>()

  const candidates = known.filter((tag) => {
    const key = tagKey(tag)
    const fresh = !seen.has(key)
    seen.add(key)

    return fresh && key !== needle && !taken.has(key) && key.includes(needle)
  })

  return [
    ...candidates.filter((tag) => tagKey(tag).startsWith(needle)),
    ...candidates.filter((tag) => !tagKey(tag).startsWith(needle)),
  ].slice(0, MAX_TAG_SUGGESTIONS)
}

export const insertTag = (text: string, active: ActiveTag, tag: string) => {
  const after = text.slice(active.end)
  const spacer = after.startsWith(' ') ? '' : ' '
  const inserted = `#${tagToken(tag)}${spacer}`

  return {
    text: `${text.slice(0, active.start)}${inserted}${after}`,
    cursor: active.start + inserted.length + (spacer ? 0 : 1),
  }
}

export const completions = (text: string, cursor: number, known: ReadonlyArray<string>) => {
  const active = activeTag(text, cursor)

  return {
    suggestions: active ? suggestTags(known, active.query, extractTags(text, known)) : [],
    complete: (tag: string) => (active ? insertTag(text, active, tag) : null),
  }
}
