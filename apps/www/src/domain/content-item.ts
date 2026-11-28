import { AudioResponse, AudioShow } from '@gbfm/api/audio'
import { ReleaseResponse } from '@gbfm/api/release'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Schema } from 'effect'

export const ContentItem = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  href: Schema.String,
  meta: Schema.NullOr(Schema.String),
  content: Schema.String,
  richContent: Schema.NullOr(RichContentDocument),
  audioUrl: Schema.NullOr(Schema.String),
  audioType: Schema.NullOr(AudioResponse.fields.type),
  show: Schema.NullOr(AudioShow),
  creators: AudioResponse.fields.creators,
  tags: ReleaseResponse.fields.tags,
  streamingLinks: ReleaseResponse.fields.streamingLinks,
  draft: Schema.optional(Schema.Boolean),
})

export type ContentItem = typeof ContentItem.Type
