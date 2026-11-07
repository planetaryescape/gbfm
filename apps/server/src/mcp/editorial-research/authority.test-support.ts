import type { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'

/** Explicit domain fixture only. Persisted credential proof lives in continuation.d1.test.ts. */
export const domainReadAuthority = (actor: McpPrincipal) =>
  CommandAuthority.of({
    checkpoint: (scopes) =>
      scopes.every((scope) => actor.scopes.includes(scope))
        ? Effect.succeed({
            actorId: actor.userId,
            clientId: actor.clientId,
            resource: 'https://api.example.test/mcp',
            // The fixture admits these domain reads; real credential guards are tested separately.
            liveGuard: sql`1`,
          })
        : Effect.fail(
            new McpToolError({ code: 'access_denied', message: 'Fixture scope denied.' }),
          ),
  })
