import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { CreatorPostCommands } from '@/services/creator-command/post-command'
import { CreatorCommandService } from '@/services/creator-command/service'

import { McpPermission } from '../authorization'
import { McpToolError } from '../contracts'
import {
  CreateMicroPostInput,
  CreatorCommandResult,
  DeleteContentInput,
  ListCreatorDraftsInput,
  ListCreatorDraftsResult,
  PublishEditorialInput,
  QuoteMicroPostInput,
  ReplyToMicroPostInput,
  UnpublishContentInput,
  UpdateCreatorMetadataInput,
} from './contracts'

export const CreatorToolkit = Toolkit.make(
  Tool.make('list_creator_drafts', {
    description:
      'List only your unpublished mixes and shows, with persisted revisions and review links. No private bodies or media URLs. Requires creator:read; default20/max50 with explicit pagination.',
    parameters: ListCreatorDraftsInput,
    success: ListCreatorDraftsResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['creator:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('update_creator_metadata', {
    description:
      'Replace supplied title/description fields on your unpublished mix or show. No publication, owner, media, body or tag edits. Requires creator:write, observed expectedRevision and UUIDv4 requestId. Identical retries return the original acknowledgement for24hours; changed payload conflicts.',
    parameters: UpdateCreatorMetadataInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['creator:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('create_micro_post', {
    description:
      'Publish a new canonical micro post publicly as yourself. Requires separately consented micros:publish and UUIDv4 requestId. No announcement, provider operation or private-media copying. Identical retries create one logical post and return its original shared PostVersion for later explicit lifecycle commands.',
    parameters: CreateMicroPostInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['micros:publish'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('reply_to_micro_post', {
    description:
      'Publish a canonical reply as yourself to a public micro. Requires separately consented micros:publish, canonical parentPostId and UUIDv4 requestId. The complete public, unbanned ancestor chain is checked inside the INSERT; server derives root and depth, capped at8. No private-media copy or notification. Identical retries return one original reply and its shared PostVersion.',
    parameters: ReplyToMicroPostInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['micros:publish'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('quote_micro_post', {
    description:
      'Publish a native top-level quote-tweet as yourself with exact content and quotedPostId, never a reply or source edit. Requires micros:publish and UUIDv4 requestId. The quoted micro and its complete ancestor chain must be public and unbanned, checked again inside the INSERT. No provider calls, media copying or notifications. Identical retries within 24 hours return one original quote and its shared PostVersion; changed input conflicts and expired keys never publish again.',
    parameters: QuoteMicroPostInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['micros:publish'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('publish_editorial', {
    description:
      'Publish your unpublished editorial using its observed shared PostVersion and UUIDv4 requestId. Requires posts:read,drafts:write and separately consented content:publish. Generate requestId once; reuse identical arguments after a timeout. Within 24 hours retries replay the original transition and repair unfinished deterministic artwork copies without publishing again. Expired keys never publish again. No announcement; public media copies are permanent.',
    parameters: PublishEditorialInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write', 'content:publish'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('unpublish_content', {
    description:
      'Unpublish your exact post,micro,mix or show at its observed version/revision. Requires separately consented content:publish plus target write scopes: posts:read+drafts:write for posts, micros:publish for micros, creator:write for mixes/shows. UUIDv4 requestId required. Does not revoke permanent public media copies or change dependents; replay returns only the saved acknowledgement.',
    parameters: UnpublishContentInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:publish'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('delete_content', {
    description:
      'Delete exactly your observed post,micro,mix or show. Requires separately consented content:delete plus target write scopes: posts:read+drafts:write for posts, micros:publish for micros, creator:write for mixes/shows. UUIDv4 requestId required. Refuses dependent content or user state; does not revoke public media bytes. Identical retry returns only its saved deletion acknowledgement after current access checks.',
    parameters: DeleteContentInput,
    success: CreatorCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:delete'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const CreatorToolHandlersLayer = CreatorToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* CreatorCommandService

    return {
      list_creator_drafts: service.listCreatorDrafts,
      update_creator_metadata: service.updateCreatorMetadata,
      create_micro_post: service.createMicroPost,
      reply_to_micro_post: service.replyToMicroPost,
      quote_micro_post: service.quoteMicroPost,
      publish_editorial: service.publishEditorial,
      unpublish_content: service.unpublishContent,
      delete_content: service.deleteContent,
    }
  }),
)

export const PublishingToolkit = Toolkit.make(
  CreatorToolkit.tools.create_micro_post,
  CreatorToolkit.tools.reply_to_micro_post,
  CreatorToolkit.tools.quote_micro_post,
  CreatorToolkit.tools.publish_editorial,
)

export const PublishingToolHandlersLayer = PublishingToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* CreatorPostCommands

    return {
      create_micro_post: service.createMicroPost,
      reply_to_micro_post: service.replyToMicroPost,
      quote_micro_post: service.quoteMicroPost,
      publish_editorial: service.publishEditorial,
    }
  }),
)
