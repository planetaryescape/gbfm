import { GetAllShowsResponse, GetShowEpisodesResponse } from '@gbfm/api/shows'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Schema } from 'effect'

export const ShowsDocument = Schema.Struct({
  shows: GetAllShowsResponse.fields.data,
  selectedSlug: Schema.NullOr(Schema.String),
  episodes: Schema.NullOr(GetShowEpisodesResponse),
  richContent: Schema.optional(RichContentDocument),
})

export type ShowsDocument = typeof ShowsDocument.Type
