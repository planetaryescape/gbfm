import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { McpToolError } from '../contracts'
import { ListeningCommandService } from './commands'
import {
  CollectionCommandResult,
  CreateCollectionInput,
  SavedMixCommandResult,
  SaveMixInput,
  SetCollectionMembershipInput,
  SetListeningStatusInput,
  UpdateCollectionInput,
  UpdateListeningNotesInput,
} from './contracts'

/** Separate from read composition: P1 activates this only with the common receipt layer. */
export const ListeningCommandToolkit = Toolkit.make(
  Tool.make('save_mix', {
    description:
      'Save a supported external mix privately. Existing saves retain their title, notes, status and visibility. Reuse the same requestId only for the same intent.',
    parameters: SaveMixInput,
    success: SavedMixCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read', 'listening:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('update_listening_notes', {
    description:
      'Replace only the notes of your unpublished saved mix at the version you read. Cannot publish or edit public notes. Retry the identical requestId after a lost response.',
    parameters: UpdateListeningNotesInput,
    success: SavedMixCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read', 'listening:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('set_listening_status', {
    description:
      'Set your unpublished mix’s listening status at the version you read, without changing its notes or publication. Retry with the identical requestId and arguments.',
    parameters: SetListeningStatusInput,
    success: SavedMixCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read', 'listening:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('create_collection', {
    description:
      'Create a private listening collection. Reuse the identical requestId and arguments after a lost response to recover the original collection, not create another.',
    parameters: CreateCollectionInput,
    success: CollectionCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read', 'listening:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('update_collection', {
    description:
      'Edit only supplied title/description fields on your private collection at the version you read. Empty description clears it; omitted fields stay unchanged. Cannot publish.',
    parameters: UpdateCollectionInput,
    success: CollectionCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read', 'listening:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('set_collection_membership', {
    description:
      'Include or remove your private saved mix in your private collection at the collection version you read. Both targets must be yours. Retry the identical requestId, never replay an old desired state under a new key.',
    parameters: SetCollectionMembershipInput,
    success: CollectionCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['listening:read', 'listening:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const ListeningCommandToolHandlersLayer = ListeningCommandToolkit.toLayer(
  Effect.gen(function* () {
    const commands = yield* ListeningCommandService

    return {
      save_mix: commands.saveMix,
      update_listening_notes: commands.updateListeningNotes,
      set_listening_status: commands.setListeningStatus,
      create_collection: commands.createCollection,
      update_collection: commands.updateCollection,
      set_collection_membership: commands.setCollectionMembership,
    }
  }),
)
