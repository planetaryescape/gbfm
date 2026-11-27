import { Context, Effect } from 'effect'

import { readPosition, savePosition } from './position'

export interface ReaderCheckpointStore {
  readonly read: (identity: string) => Effect.Effect<string | null>
  readonly write: (identity: string, slug: string | null) => Effect.Effect<void>
}

export const ReaderCheckpointStore = Context.Reference<ReaderCheckpointStore>(
  'reader/ReaderCheckpointStore',
  {
    defaultValue: () => ({
      read: (identity) => Effect.sync(() => readPosition(identity)),
      write: (identity, slug) => Effect.sync(() => savePosition(identity, slug)),
    }),
  },
)
