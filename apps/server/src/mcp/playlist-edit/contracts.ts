import type { McpScope } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'

const Id = Schema.NonEmptyString.check(Schema.isMaxLength(200))

const RequestId = Schema.String.check(Schema.isUUID(4))

export const PlaylistRevision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)

const Title = Schema.NonEmptyString.check(Schema.isMaxLength(500), Schema.isPattern(/\S/))

const Slug = Schema.NonEmptyString.check(Schema.isMaxLength(200))

const Description = Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))

const Url = Schema.NonEmptyString.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value)

      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    } catch {
      return false
    }
  }),
)

const TrackIds = Schema.Array(Id).check(
  Schema.isMaxLength(500),
  Schema.makeFilter((ids) => new Set(ids).size === ids.length),
)

const TrackChanges = TrackIds.check(Schema.isMinLength(1), Schema.isMaxLength(100))

/** Publication and actor fields are deliberately absent from metadata commands. */
export const PlaylistMetadata = Schema.Struct({
  title: Title,
  slug: Slug,
  description: Description,
  coverImageUrl: Schema.NullOr(Url),
})

const identity = { requestId: RequestId }

const target = { ...identity, playlistId: Id, expectedRevision: PlaylistRevision }

export const CreatePlaylist = Schema.Struct({
  operation: Schema.Literal('create_playlist'),
  ...identity,
  metadata: PlaylistMetadata,
})

export const UpdatePlaylist = Schema.Struct({
  operation: Schema.Literal('update_playlist'),
  ...target,
  metadata: Schema.Struct({
    title: Schema.optionalKey(Title),
    slug: Schema.optionalKey(Slug),
    description: Schema.optionalKey(Description),
    coverImageUrl: Schema.optionalKey(Schema.NullOr(Url)),
  }).check(Schema.makeFilter((patch) => Object.keys(patch).length > 0)),
})

export const AddPlaylistTracks = Schema.Struct({
  operation: Schema.Literal('add_playlist_tracks'),
  ...target,
  trackIds: TrackChanges,
})

export const RemovePlaylistTracks = Schema.Struct({
  operation: Schema.Literal('remove_playlist_tracks'),
  ...target,
  trackIds: TrackChanges,
})

export const ReorderPlaylistTracks = Schema.Struct({
  operation: Schema.Literal('reorder_playlist_tracks'),
  ...target,
  trackIds: TrackIds,
})

export const PublishPlaylist = Schema.Struct({
  operation: Schema.Literal('publish_playlist'),
  ...target,
})

export const UnpublishPlaylist = Schema.Struct({
  operation: Schema.Literal('unpublish_playlist'),
  ...target,
})

export const AddPlaylistTrackFromUrl = Schema.Struct({
  operation: Schema.Literal('add_playlist_track_from_url'),
  ...target,
  url: Url,
})

export const SyncPlaylistLinks = Schema.Struct({
  operation: Schema.Literal('sync_playlist_links'),
  ...target,
})

/** Provider-free desired-state planning; URL-add and sync need the import owner's contract. */
export const LocalPlaylistCommand = Schema.Union([
  CreatePlaylist,
  UpdatePlaylist,
  AddPlaylistTracks,
  RemovePlaylistTracks,
  ReorderPlaylistTracks,
  PublishPlaylist,
  UnpublishPlaylist,
])

export type LocalPlaylistCommand = typeof LocalPlaylistCommand.Type

export const PlaylistCommand = Schema.Union([
  LocalPlaylistCommand,
  AddPlaylistTrackFromUrl,
  SyncPlaylistLinks,
])

export type PlaylistCommand = typeof PlaylistCommand.Type

/** Preview inherits the proposed command's complete authority; it does not acquire a receipt. */
export const PreviewPlaylistChanges = Schema.Struct({
  operation: Schema.Literal('preview_playlist_changes'),
  command: PlaylistCommand,
})

export const playlistCommandScopes = (command: PlaylistCommand): ReadonlyArray<McpScope> => {
  switch (command.operation) {
    case 'publish_playlist':
    case 'unpublish_playlist':
      return ['playlists:write', 'playlists:publish']
    case 'add_playlist_track_from_url':
    case 'sync_playlist_links':
      return ['playlists:write', 'catalogue:write', 'catalogue:import', 'providers:read']
    default:
      return ['playlists:write']
  }
}

/** Use at every incoming boundary: never strip a hidden publication/actor field silently. */
export const decodePlaylistCommand = Schema.decodeUnknownEffect(PlaylistCommand, {
  onExcessProperty: 'error',
})
