import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

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
  UnpublishContentInput,
  UpdateCreatorMetadataInput,
} from './contracts'

/** Candidate toolkit only; P1 owns registration. Reply awaits the named ancestry prerequisite. */
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
  Tool.make('publish_editorial', {
    description:
      'Publish your unpublished editorial using its observed shared PostVersion and UUIDv4 requestId. Requires posts:read,drafts:write and separately consented content:publish. Private-media copy recovery is not yet supported and such commands fail closed. No announcement or media-byte revocation. Retries acknowledge only the original transition.',
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
      publish_editorial: service.publishEditorial,
      unpublish_content: service.unpublishContent,
      delete_content: service.deleteContent,
    }
  }),
)
