import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  PublicCollectionInput,
  PublicCollectionResult,
  PublicMixInput,
  PublicMixResult,
  PublicProfileInput,
  PublicProfileResult,
  PublicSearchInput,
  PublicSearchResult,
} from './research-contracts'
import { PublicResearchService } from './research-service'

/** Independently composed metadata tools; central registration stays P1-owned. */
export const PublicResearchToolkit = Toolkit.make(
  Tool.make('search_catalogue', {
    description:
      'Search one published GBFM audio/show/post namespace, not canonical music entities. Metadata only. Newest-first, not relevance-ranked. Short queries scan LIKE; FTS matches also require count/sort work not bounded by page size. Default 20/max 50, offset max 10000. No related-show fields, bodies or media. Read-only; content:read required.',
    parameters: PublicSearchInput,
    success: PublicSearchResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('get_mix', {
    description:
      'Read published GBFM audio mix metadata by slug, not a canonical music track. Missing/draft/non-mix audio returns not_found. No body, media, show expansion or playback counting. Read-only; content:read required.',
    parameters: PublicMixInput,
    success: PublicMixResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('get_public_profile', {
    description:
      'Read public identity metadata by username using existing user-first / published artist-DJ fallback behavior. Banned/missing profiles return not_found. Not a hydrated profile page: no content graph, media or social links. Read-only; content:read required.',
    parameters: PublicProfileInput,
    success: PublicProfileResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('get_public_collection', {
    description:
      'Read a published listening collection and a bounded page of its published same-owner saves, including their public notes/status. Not a playlist revision or compiled embed. Missing/private collection returns not_found; empty public collection returns an empty page. Newest-first with ID tie-break; default 20/max 50, offset max 10000. Read-only; content:read required.',
    parameters: PublicCollectionInput,
    success: PublicCollectionResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** Typed handler Layer for the existing authenticated MCP transport. */
export const PublicResearchHandlersLayer = PublicResearchToolkit.toLayer(
  Effect.gen(function* () {
    const reads = yield* PublicResearchService

    return {
      search_catalogue: reads.searchCatalogue,
      get_mix: reads.getMix,
      get_public_profile: reads.getPublicProfile,
      get_public_collection: reads.getPublicCollection,
    }
  }),
)
