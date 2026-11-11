import type { D1PreparedStatement } from '@cloudflare/workers-types'
import type { SQL } from 'drizzle-orm'
import { Context, type Effect } from 'effect'

import type { MusicIdentityStorageError } from './errors'
import type { CanonicalCommit } from './repository'

export class CanonicalImportPersistence extends Context.Service<
  CanonicalImportPersistence,
  {
    readonly commit: (
      input: CanonicalCommit,
      build: (guard: SQL) => ReadonlyArray<D1PreparedStatement>,
    ) => Effect.Effect<boolean, MusicIdentityStorageError>
  }
>()('gbfm/CanonicalImportPersistence') {}
