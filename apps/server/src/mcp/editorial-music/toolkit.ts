import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError, GetPostResult } from '../contracts'
import { EditorialPreviewResult, EditorialSourceInput, MusicMentionsResult } from './content'
import {
  AttachMusicInput,
  DetachMusicInput,
  InsertMusicEmbedInput,
  ReferenceWriteResult,
  SetDraftTagsInput,
} from './contracts'
import { EditorialMusicService } from './service'

/** Six selected E1 operations. P1 owns composition into the live registry. */
export const EditorialMusicToolkit = Toolkit.make(
  Tool.make('attach_music_to_draft', {
    description:
      'Attach an existing public album, track or playlist to your unpublished editorial at an explicit position. Explicit primary flag. Never imports URLs or edits body text. Requires posts:read, drafts:write and catalogue:read. Caller version and requestId required; identical retries return the original saved result for 24 hours.',
    parameters: AttachMusicInput,
    success: ReferenceWriteResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write', 'catalogue:read'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('detach_music_from_draft', {
    description:
      'Remove an explicit music association from your unpublished editorial, leaving body embeds unchanged. Supply the resulting primary target or null; no automatic promotion. Requires posts:read, drafts:write and catalogue:read. Caller version and requestId required; original-result retries last 24 hours.',
    parameters: DetachMusicInput,
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
  Tool.make('insert_music_embed', {
    description:
      'Insert an inert existing-catalogue music directive at a saved-source UTF-16 offset (start, end or a blank paragraph boundary). Does not attach or import music, publish or upload. Requires posts:read, drafts:write and catalogue:read. Caller version and requestId required; exact replay for 24 hours.',
    parameters: InsertMusicEmbedInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write', 'catalogue:read'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('set_draft_tags', {
    description:
      'Replace up to 20 distinct tags on your unpublished editorial, atomically advancing its version. Preserves title, body and music. Requires posts:read and drafts:write; requestId and current expectedVersion required. Exact original-result replay for 24 hours.',
    parameters: SetDraftTagsInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('find_music_mentions', {
    description:
      'Parse supplied editorial source for at most 50 distinct catalogue references and supported music URLs. No post lookup, catalogue resolution, provider request, import or save. Requires posts:read. Maximum 100,000 characters and 100 KiB UTF-8 source.',
    parameters: EditorialSourceInput,
    success: MusicMentionsResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('preview_editorial', {
    description:
      'Parse and safely render supplied source through the shared inert rich-content renderer, with diagnostics and explicit unavailable music placeholders. No persistence or provider requests, no fresh catalogue display. Requires posts:read. Maximum 100,000 characters/100 KiB source and 256 KiB output.',
    parameters: EditorialSourceInput,
    success: EditorialPreviewResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** Handler layer is separate from the registry and transport. */
export const EditorialMusicToolHandlersLayer = EditorialMusicToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* EditorialMusicService

    return {
      attach_music_to_draft: service.attachMusic,
      detach_music_from_draft: service.detachMusic,
      find_music_mentions: service.findMentions,
      insert_music_embed: service.insertMusicEmbed,
      preview_editorial: service.preview,
      set_draft_tags: service.setDraftTags,
    }
  }),
)
