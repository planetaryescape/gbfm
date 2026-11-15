import { Schema } from 'effect'

export const SpotlightProgress = Schema.Struct({
  at: Schema.NullOr(Schema.String),
  seen: Schema.Array(Schema.String),
})

export type SpotlightProgress = typeof SpotlightProgress.Type

export const emptyProgress: SpotlightProgress = { at: null, seen: [] }

export const stepTo = (progress: SpotlightProgress, at: string | null): SpotlightProgress => {
  const position = at ?? 'intro'

  return {
    at,
    seen: progress.seen.includes(position) ? progress.seen : [...progress.seen, position],
  }
}
