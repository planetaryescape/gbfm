import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { McpToolError } from '../contracts'
import { CollectionPage, ListeningPageInput, SavedMixPage } from './contracts'
import { ListeningReadService } from './reads'

/** Only safe reads are registered; six selected commands remain schema/replay gated. */
export const ListeningToolkit = Toolkit.make(
  Tool.make('list_saved_mixes', {
    description:
      'List your own saved external mixes, including private notes. Requires listening:read. Bounded pagination; never reads another listener’s library.',
    parameters: ListeningPageInput,
    success: SavedMixPage,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('list_collections', {
    description:
      'List your own listening collection metadata, including private collections. Requires listening:read. Bounded pagination; no membership counts.',
    parameters: ListeningPageInput,
    success: CollectionPage,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** P1 composes this handler layer and toolkit; no registry or OAuth edits in L1. */
export const ListeningToolHandlersLayer = ListeningToolkit.toLayer(
  Effect.gen(function* () {
    const reads = yield* ListeningReadService

    return { list_saved_mixes: reads.listSavedMixes, list_collections: reads.listCollections }
  }),
)
