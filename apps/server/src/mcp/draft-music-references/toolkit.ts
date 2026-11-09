import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import { ReferenceWriteResult } from '../editorial-music/contracts'
import { SetDraftMusicReferencesInput } from './contracts'
import { DraftMusicReferencesService } from './service'

/** P1 owns discovery/registration, gated on live authority and authorized reference reads. */
export const DraftMusicReferencesToolkit = Toolkit.make(
  Tool.make('set_draft_music_references', {
    description:
      'Replace all ordered music associations on your unpublished editorial draft with up to 50 distinct existing public albums, tracks or playlists. Supply an explicit member primary or null, current expectedVersion and requestId. An empty list with null clears associations, not text or body embeds. Requires posts:read, drafts:write and catalogue:read. Never imports, publishes or resolves providers. Identical retries return the original saved result for 24 hours, with private display data removed.',
    parameters: SetDraftMusicReferencesInput,
    success: ReferenceWriteResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write', 'catalogue:read'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** Handler layer is separate from production composition. */
export const DraftMusicReferencesToolHandlersLayer = DraftMusicReferencesToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* DraftMusicReferencesService

    return { set_draft_music_references: service.setDraftMusicReferences }
  }),
)
