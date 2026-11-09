import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  ConnectionsInput,
  ConnectionsResult,
  SequenceInput,
  SequenceResult,
  SimilarInput,
  SimilarResult,
} from './contracts'
import { MusicRecommendationService } from './service'

export const MusicRecommendationToolkit = Toolkit.make(
  Tool.make('suggest_editorial_connections', {
    description:
      'Suggest public editorials from exact primary music references and bounded same-kind catalogue relations. Not body search or comprehensive coverage. Explicit authored draft additionally needs posts:read; expectedVersion conflicts. Artist/playlist relation unsupported explicitly. No providers or writes.',
    parameters: ConnectionsInput,
    success: ConnectionsResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read', 'content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('suggest_playlist_sequence', {
    description:
      'Propose complete public GBFM playlist order using album_blocks_v1 recorded track numbering. At most 100 distinct eligible tracks, expectedRevision required. Hidden albums become singleton tracks; hidden tracks fail the whole call. Not a DJ mix, playback, provider or reorder write.',
    parameters: SequenceInput,
    success: SequenceResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('find_similar_music', {
    description:
      'Find same-kind catalogue-related music, NOT sonic similarity. Published evidence only; ranks same album, shared artist, explicit music-label affiliation, then direct genre. Examines at most 200 visible candidates, 50 seed edges per kind; default 10/max 20 outputs. Empty evidence is unknown, not dissimilarity. No providers, models, listening data or writes.',
    parameters: SimilarInput,
    success: SimilarResult,
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

export const MusicRecommendationHandlersLayer = MusicRecommendationToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* MusicRecommendationService

    return {
      find_similar_music: service.findSimilarMusic,
      suggest_editorial_connections: service.suggestEditorialConnections,
      suggest_playlist_sequence: service.suggestPlaylistSequence,
    }
  }),
)
