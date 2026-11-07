import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import { SimilarInput, SimilarResult } from './contracts'
import { MusicRecommendationService } from './service'

export const MusicRecommendationToolkit = Toolkit.make(
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

    return { find_similar_music: service.findSimilarMusic }
  }),
)
