import { Context, Effect, Layer, Option } from 'effect'
import { McpProtocol, McpServer, Tool, Toolkit } from 'effect/ai'

import { McpPermission } from './authorization'
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
import { MCP_SERVER_INFO } from './wire-response'

export const EditorialToolkit = Toolkit.make(
  Tool.make('create_draft', {
    description:
      'Create your own unpublished editorial draft. Requires drafts:write. Generate a UUIDv4 requestId once and reuse it after a timeout. For 24 hours, identical retries return the original saved result, even after later edits. Changed payloads conflict; expired retries never create another draft. Never publishes.',
    parameters: CreateDraftInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('update_draft', {
    description:
      'Edit title, content or description of your own unpublished editorial draft. Requires drafts:write, a new UUIDv4 requestId per edit and the latest get_post version as expectedVersion. Reuse the exact request within 24 hours after a timeout to replay the original saved result. Stale versions and changed retry payloads conflict; expired retries never repeat a mutation. Never publishes.',
    parameters: UpdateDraftInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write'] })
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
    .annotate(McpPermission, { scopes: ['posts:read'] })
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
    .annotate(McpPermission, { scopes: ['posts:read'] })
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

// Effect's merge is last-writer-wins. A wire-name collision is a composition defect.
export const composeMcpToolkits = <const Toolkits extends ReadonlyArray<Toolkit.Any>>(
  ...toolkits: Toolkits
) => {
  const names = new Set<string>()

  for (const toolkit of toolkits) {
    for (const tool of Object.values(toolkit.tools)) {
      if (names.has(tool.name)) throw new Error(`Duplicate MCP tool: ${tool.name}`)

      if (Option.isNone(Context.getOption(tool.annotations, McpPermission)))
        throw new Error(`Missing MCP permission: ${tool.name}`)
      names.add(tool.name)
    }
  }

  return Toolkit.merge(...toolkits)
}

export const makeMcpLayer = <Tools extends Record<string, Tool.Any>>(
  allowedOrigins: ReadonlyArray<string>,
  toolkit: Toolkit.Toolkit<Tools>,
) =>
  McpServer.toolkit(toolkit).pipe(
    Layer.provideMerge(
      McpServer.layerHttpRequestScoped({
        ...MCP_SERVER_INFO,
        path: '/mcp',
        protocols: [McpProtocol.v2026_07_28],
        allowedOrigins,
      }),
    ),
  )

export const makeEditorialMcpLayer = (allowedOrigins: ReadonlyArray<string>) =>
  makeMcpLayer(allowedOrigins, EditorialToolkit).pipe(Layer.provide(EditorialToolHandlersLayer))

export const EditorialMcpLayer = makeEditorialMcpLayer([])
