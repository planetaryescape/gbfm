import { Effect, Option, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { Database } from '@/db/layer'
import {
  applyPlaylistCommandEffect,
  previewPlaylistCommandEffect,
} from '@/services/music-entity/playlist.service'

import { McpPermission } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'
import { McpOperationStore } from '../operations/store'
import {
  AddPlaylistTracks,
  CreatePlaylist,
  LocalPlaylistCommand,
  PlaylistCommandResult,
  PlaylistPreviewResult,
  PreviewPlaylistChanges,
  PublishPlaylist,
  RemovePlaylistTracks,
  ReorderPlaylistTracks,
  UnpublishPlaylist,
  UpdatePlaylist,
  playlistCommandScopes,
} from './contracts'

// Admission supplies this at request time; never capture an actor during layer construction.
const requestAuthority = Effect.gen(function* () {
  const authority = yield* Effect.serviceOption(CommandAuthority)

  if (Option.isNone(authority))
    return yield* new McpToolError({ code: 'access_denied', message: 'No command authority.' })

  return authority.value
})

const command = <Name extends string, P extends Schema.Constraint>(
  name: Name,
  parameters: P,
  description: string,
  publish = false,
) =>
  Tool.make(name, {
    description,
    parameters,
    success: PlaylistCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, {
      scopes: publish ? ['playlists:write', 'playlists:publish'] : ['playlists:write'],
    })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true)

/** Provider tools remain unregistered until the named import/status prerequisite is integrated. */
export const PlaylistEditToolkit = Toolkit.make(
  command(
    'create_playlist',
    CreatePlaylist,
    'Admin-only: create an empty unpublished GBFM playlist. UUIDv4 requestId is the retry identity; same key with changed input conflicts. No import/provider work.',
  ),
  command(
    'update_playlist',
    UpdatePlaylist,
    'Admin-only metadata patch at caller expectedRevision. No publication or actor fields. Omitted keys preserve; null clears nullable metadata.',
  ),
  command(
    'add_playlist_tracks',
    AddPlaylistTracks,
    'Append 1–100 distinct existing GBFM track IDs in caller order; existing memberships keep positions/dates. Max 500 members; no implicit imports. Requires expectedRevision.',
  ),
  command(
    'remove_playlist_tracks',
    RemovePlaylistTracks,
    'Remove 1–100 named memberships at expectedRevision. Missing memberships are no-ops; surviving positions/dates remain. Admin-only.',
  ),
  command(
    'reorder_playlist_tracks',
    ReorderPlaylistTracks,
    'Replace order using the exact complete current track ID set at expectedRevision. Positions become 0..n−1; membership dates remain. Max 500. Admin-only.',
  ),
  command(
    'publish_playlist',
    PublishPlaylist,
    'Explicit admin publication with playlists:publish consent, caller revision and UUIDv4 retry key. Publish immediately; already public is a fenced no-op.',
    true,
  ),
  command(
    'unpublish_playlist',
    UnpublishPlaylist,
    'Explicit admin unpublication with playlists:publish consent, caller revision and UUIDv4 retry key. Already unpublished is a fenced no-op.',
    true,
  ),
  Tool.make('preview_playlist_changes', {
    description:
      'Admin-only read: preview the exact local metadata/membership/order/publication transition without reserving a receipt or applying it. Same complete authority as the proposed command. URL-add/link-sync preview is unavailable until import/status integration; never fetches providers.',
    parameters: PreviewPlaylistChanges,
    success: PlaylistPreviewResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['playlists:write'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const PlaylistEditHandlersLayer = PlaylistEditToolkit.toLayer(
  Effect.gen(function* () {
    const db = yield* Database
    const store = yield* McpOperationStore

    const apply = (input: LocalPlaylistCommand) =>
      applyPlaylistCommandEffect(input).pipe(
        Effect.provideService(Database, db),
        Effect.provideService(McpOperationStore, store),
        Effect.provideServiceEffect(CommandAuthority, requestAuthority),
      )

    return {
      create_playlist: apply,
      update_playlist: apply,
      add_playlist_tracks: apply,
      remove_playlist_tracks: apply,
      reorder_playlist_tracks: apply,
      publish_playlist: apply,
      unpublish_playlist: apply,
      preview_playlist_changes: (input: typeof PreviewPlaylistChanges.Type) =>
        Effect.gen(function* () {
          const authority = yield* requestAuthority
          yield* authority.checkpoint(playlistCommandScopes(input.command))

          const local = yield* Schema.decodeUnknownEffect(LocalPlaylistCommand)(input.command).pipe(
            Effect.mapError(
              () =>
                new McpToolError({
                  code: 'unavailable',
                  message: 'Provider preview requires the import status integration.',
                }),
            ),
          )

          return yield* previewPlaylistCommandEffect(local).pipe(
            Effect.provideService(Database, db),
            Effect.provideService(CommandAuthority, authority),
          )
        }),
    }
  }),
)
