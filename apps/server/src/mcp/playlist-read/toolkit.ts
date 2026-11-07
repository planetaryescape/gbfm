import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  CompareInput,
  CompareResult,
  ExportResult,
  PlaylistInput,
  PlaylistPageInput,
  PlaylistResult,
  PlaylistTracksResult,
} from './contracts'
import { PlaylistReadService } from './service'

export const PlaylistReadToolkit = Toolkit.make(
  Tool.make('get_playlist', {
    description:
      'Read a published GBFM playlist by GBFM ID. No private/Spotify-account access; no import or enrichment. Missing, unpublished and future playlists all return not_found. Requires catalogue:read.',
    parameters: PlaylistInput,
    success: PlaylistResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('get_playlist_tracks', {
    description:
      'Read ordered memberships of a published GBFM playlist. Default 50, max 100; offset max 10000. Order is stored position then track ID; gaps preserved. A missing catalogue row retains ID/position with track:null. Counts include missing memberships. Requires catalogue:read; read-only.',
    parameters: PlaylistPageInput,
    success: PlaylistTracksResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('compare_playlists', {
    description:
      'Compare two published GBFM playlists by known GBFM track IDs only, not duplicate/recording equivalence. Max 500 memberships each; larger playlists fail rather than silently truncate. Missing catalogue rows are reported separately, not matched. Requires catalogue:read; no provider calls or writes.',
    parameters: CompareInput,
    success: CompareResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('export_playlist', {
    description:
      'Return portable version-1 GBFM playlist JSON inline, never a hosted file or Spotify-account export. Max 500 memberships and 64 KiB UTF-8 file; full MCP envelope max 256 KiB. Oversize fails without partial export. Stable IDs, positions and verified provider links; missing track:null preserved. No provider/publication/import side effects. Requires catalogue:read.',
    parameters: PlaylistInput,
    success: ExportResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const PlaylistReadHandlersLayer = PlaylistReadToolkit.toLayer(
  Effect.gen(function* () {
    const reads = yield* PlaylistReadService

    return {
      get_playlist: reads.getPlaylist,
      get_playlist_tracks: reads.getPlaylistTracks,
      compare_playlists: reads.comparePlaylists,
      export_playlist: reads.exportPlaylist,
    }
  }),
)
