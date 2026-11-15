import { Schema } from 'effect'

export const SpotlightProgress = Schema.Struct({
  at: Schema.NullOr(Schema.String),
})

export type SpotlightProgress = typeof SpotlightProgress.Type

export const emptyProgress: SpotlightProgress = { at: null }

export const stepTo = (at: string | null): SpotlightProgress => ({ at })
