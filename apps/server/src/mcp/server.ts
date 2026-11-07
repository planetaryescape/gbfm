import { Effect, Layer } from 'effect'
import { McpProtocol, McpServer, Tool, Toolkit } from 'effect/ai'

import {
  CreateDraftInput,
  EditorialToolError,
  GetPostInput,
  GetPostResult,
  ListDraftsInput,
  ListDraftsResult,
  UpdateDraftInput,
} from './contracts'
import { EditorialDraftService } from './drafts'
import { EditorialReadService } from './editorial'

export const EditorialToolkit = Toolkit.make(
  Tool.make('create_draft', {
    description:
      'Create your own unpublished editorial draft. Requires drafts:write. Generate a UUIDv4 requestId once and reuse it after a timeout. Identical retries return the original saved result, even after later edits. Changed payloads conflict. Never publishes.',
    parameters: CreateDraftInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('update_draft', {
    description:
      'Edit title, content or description of your own unpublished editorial draft. Requires drafts:write, a new UUIDv4 requestId per edit and the latest get_post version as expectedVersion. Reuse the exact request after a timeout to replay the original saved result. Stale versions and changed retry payloads conflict. Never publishes.',
    parameters: UpdateDraftInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('list_drafts', {
    description: 'List the authenticated owner’s authored drafts. Read only, bounded pagination.',
    parameters: ListDraftsInput,
    success: ListDraftsResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('get_post', {
    description: 'Read a post by its stable postId. Private drafts require authorship.',
    parameters: GetPostInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const EditorialToolHandlersLayer = EditorialToolkit.toLayer(
  Effect.gen(function* () {
    const reads = yield* EditorialReadService
    const drafts = yield* EditorialDraftService

    return {
      list_drafts: reads.listDrafts,
      get_post: reads.getPost,
      create_draft: drafts.createDraft,
      update_draft: drafts.updateDraft,
    }
  }),
)

export const makeEditorialMcpLayer = (allowedOrigins: ReadonlyArray<string>) =>
  McpServer.toolkit(EditorialToolkit).pipe(
    Layer.provide(EditorialToolHandlersLayer),
    Layer.provideMerge(
      McpServer.layerHttpRequestScoped({
        name: 'GBFM Editorial',
        version: '1.0.0',
        description:
          'Editorial reads and separately authorized draft writes. Publishing stays in GBFM.',
        path: '/mcp',
        protocols: [McpProtocol.v2026_07_28],
        allowedOrigins,
      }),
    ),
  )

export const EditorialMcpLayer = makeEditorialMcpLayer([])
