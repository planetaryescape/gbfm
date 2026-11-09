import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'

const Id = Schema.NonEmptyString.check(Schema.isMaxLength(200))

/** GBFM IDs only, never a Spotify account/playlist URI. */
export const PlaylistInput = Schema.Struct({ playlistId: Id })

export const PlaylistPageInput = Schema.Struct({
  ...PlaylistInput.fields,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  offset: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

export const CompareInput = Schema.Struct({ leftPlaylistId: Id, rightPlaylistId: Id })

export const ProviderLink = Schema.Struct({ platform: Schema.String, url: Schema.String })

export const PublicPlaylist = Schema.Struct({
  playlistId: Id,
  title: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  coverImageUrl: Schema.NullOr(Schema.String),
  publishedAt: Schema.String,
  revision: Schema.Int,
  links: Schema.Array(ProviderLink),
})

export const PlaylistEntry = Schema.Struct({
  trackId: Id,
  position: Schema.Int,
  addedAt: Schema.String,
  // Keep membership/position when a damaged legacy relation has no catalogue row.
  track: Schema.NullOr(
    Schema.Struct({
      title: Schema.String,
      artistNames: Schema.Array(Schema.String),
      slug: Schema.String,
      coverImageUrl: Schema.NullOr(Schema.String),
      links: Schema.Array(ProviderLink),
    }),
  ),
})

export const PlaylistResult = Schema.Struct({
  endpoint: EndpointIdentity,
  playlist: PublicPlaylist,
})

export const PlaylistTracksResult = Schema.Struct({
  ...PlaylistResult.fields,
  entries: Schema.Array(PlaylistEntry),
  pagination: Schema.Struct({
    limit: Schema.Int,
    offset: Schema.Int,
    total: Schema.Int,
    hasMore: Schema.Boolean,
  }),
})

export const CompareResult = Schema.Struct({
  endpoint: EndpointIdentity,
  left: PublicPlaylist,
  right: PublicPlaylist,
  identity: Schema.Literal('gbfm_track_id'),
  limitation: Schema.String,
  sharedTrackIds: Schema.Array(Id),
  leftOnlyTrackIds: Schema.Array(Id),
  rightOnlyTrackIds: Schema.Array(Id),
  leftMissingTrackIds: Schema.Array(Id),
  rightMissingTrackIds: Schema.Array(Id),
})

export const ExportDocument = Schema.Struct({
  format: Schema.Literal('gbfm-playlist'),
  version: Schema.Literal(1),
  endpoint: EndpointIdentity,
  playlist: PublicPlaylist,
  entries: Schema.Array(PlaylistEntry),
})

export const ExportResult = Schema.Struct({
  endpoint: EndpointIdentity,
  mediaType: Schema.Literal('application/json'),
  filename: Schema.String,
  byteLength: Schema.Int,
  content: Schema.String,
})
