import { Effect, type Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  AlbumTracksInput,
  ArtistDiscographyInput,
  FilterMusicInput,
  GetMusicEntitiesInput,
  GetMusicEntitiesResult,
  GetMusicEntityResult,
  LabelCatalogueInput,
  LookupMusicUrlInput,
  LookupMusicUrlResult,
  MusicListResult,
  MusicRef,
  MusicRelationshipsInput,
  MusicRelationshipsResult,
  SearchMusicInput,
} from './contracts'
import { MusicReadService } from './service'

const read = <
  Name extends string,
  Config extends {
    readonly parameters: Schema.Constraint
    readonly success: Schema.Constraint
    readonly failure: Schema.Constraint
    readonly failureMode: Tool.FailureMode
  },
  R,
>(
  tool: Tool.Tool<Name, Config, R>,
) =>
  tool
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true)

/** Nine read-only catalogue tools. Registration is owned by central integration, not this module. */
export const MusicReadToolkit = Toolkit.make(
  read(
    Tool.make('search_music', {
      description:
        'Search artist, album, track and label names by literal case-insensitive substring. No mixes, episodes, playlists, imports or provider fetches. Default 20/max 50; stable kind/ID order; offset max 10000.',
      parameters: SearchMusicInput,
      success: MusicListResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('filter_music', {
      description:
        'List one catalogue kind, optionally matching an exact case-insensitive name. Default 20/max 50; stable ID order; no playlist access.',
      parameters: FilterMusicInput,
      success: MusicListResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('get_music_entity', {
      description:
        'Get one artist, album, track or label by stable ID. Explicit public fields and verified safe stored links only; missing IDs return not_found. observedUpdatedAt is not an optimistic-write version.',
      parameters: MusicRef,
      success: GetMusicEntityResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('get_music_entities', {
      description:
        'Get 1–50 catalogue references. Preserve input order and duplicates; each missing reference has status not_found. No provider fetch-on-miss.',
      parameters: GetMusicEntitiesInput,
      success: GetMusicEntitiesResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('lookup_music_url', {
      description:
        'Normalize an HTTPS source URL and look up its existing resolved canonical identity/alias. Unknown, unresolved, orphaned and playlist identities return not_found. Never imports, repairs, fetches providers or delivers artwork.',
      parameters: LookupMusicUrlInput,
      success: LookupMusicUrlResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('get_artist_discography', {
      description:
        'Page albums and tracks directly credited to an artist. Stored credit roles/order only, no inferred discography or provider enrichment. Default 20/max 50; relationship/kind/ID order.',
      parameters: ArtistDiscographyInput,
      success: MusicRelationshipsResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('get_album_tracks', {
      description:
        'Page an album’s stored tracks in track-number order (null last), then stable ID. Default 20/max 50. No playlist or provider traversal.',
      parameters: AlbumTracksInput,
      success: MusicRelationshipsResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('get_label_catalogue', {
      description:
        'Page a label’s directly affiliated artists and released albums. No label draft body or inferred affiliation; default 20/max 50, relationship/kind/ID order.',
      parameters: LabelCatalogueInput,
      success: MusicRelationshipsResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('get_music_relationships', {
      description:
        'Page one hop of stored album/track artist credits, label affiliations/releases and album-track membership, in both directions. No playlist edges, draft content or inferred graph. Default 20/max 50, relationship/kind/ID order.',
      parameters: MusicRelationshipsInput,
      success: MusicRelationshipsResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
)

/** Depends on MusicReadService; each service method independently checks current catalogue authority. */
export const MusicReadHandlersLayer = MusicReadToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* MusicReadService

    return {
      search_music: service.searchMusic,
      filter_music: service.filterMusic,
      get_music_entity: service.getMusicEntity,
      get_music_entities: service.getMusicEntities,
      lookup_music_url: service.lookupMusicUrl,
      get_artist_discography: service.getArtistDiscography,
      get_album_tracks: service.getAlbumTracks,
      get_label_catalogue: service.getLabelCatalogue,
      get_music_relationships: service.getMusicRelationships,
    }
  }),
)
