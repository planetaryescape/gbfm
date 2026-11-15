import { Schema } from 'effect'

export const Video = Schema.Struct({
  embedUrl: Schema.String,
  canonicalUrl: Schema.String,
  title: Schema.String,
})

export type Video = typeof Video.Type
