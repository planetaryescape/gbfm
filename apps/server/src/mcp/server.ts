import { Effect, Layer } from 'effect'
import { McpProtocol, McpServer, Tool, Toolkit } from 'effect/ai'

import {
  EditorialToolError,
  GetPostInput,
  GetPostResult,
  ListDraftsInput,
  ListDraftsResult,
} from './contracts'
import { EditorialReadService } from './editorial'

export const EditorialToolkit = Toolkit.make(
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
  Effect.map(EditorialReadService, (reads) => ({
    list_drafts: reads.listDrafts,
    get_post: reads.getPost,
  })),
)

export const makeEditorialMcpLayer = (allowedOrigins: ReadonlyArray<string>) =>
  McpServer.toolkit(EditorialToolkit).pipe(
    Layer.provide(EditorialToolHandlersLayer),
    Layer.provideMerge(
      McpServer.layerHttpRequestScoped({
        name: 'GBFM Editorial',
        version: '1.0.0',
        description: 'Read-only editorial access. Review and publishing stay in the GBFM frontend.',
        path: '/mcp',
        protocols: [McpProtocol.v2026_07_28],
        allowedOrigins,
      }),
    ),
  )

export const EditorialMcpLayer = makeEditorialMcpLayer([])
