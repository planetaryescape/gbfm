import { Schema } from 'effect'

export const SpotlightProgress = Schema.Struct({
  path: Schema.String,
  at: Schema.NullOr(Schema.String),
  seen: Schema.Array(Schema.String),
})

export type SpotlightProgress = typeof SpotlightProgress.Type

const storageKey = (path: string) => `gbfm:spotlight:${path}`

const StoredProgress = Schema.fromJsonString(
  Schema.Struct({ at: Schema.NullOr(Schema.String), seen: Schema.Array(Schema.String) }),
)

export const readProgress = (path: string): SpotlightProgress | null => {
  try {
    const raw = localStorage.getItem(storageKey(path))

    if (raw === null) return null

    return { path, ...Schema.decodeUnknownSync(StoredProgress)(raw) }
  } catch {
    return null
  }
}

export const writeProgress = ({ path, at, seen }: SpotlightProgress) => {
  try {
    localStorage.setItem(storageKey(path), Schema.encodeSync(StoredProgress)({ at, seen }))
  } catch {
    return
  }
}

export const withSeen = (progress: SpotlightProgress | null, path: string, at: string | null) => {
  const seen = progress?.path === path ? progress.seen : []
  const position = at ?? 'intro'

  return { path, at, seen: seen.includes(position) ? seen : [...seen, position] }
}
