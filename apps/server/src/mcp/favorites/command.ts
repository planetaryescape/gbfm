import { type MembershipMutationInput, MembershipMutationResult } from '@gbfm/api/favorites'
import type { McpScope } from '@gbfm/core/editorial-mcp'
import { Effect, Schema } from 'effect'

import type { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'
import type { OperationResult } from '../operations/store'
import type { MembershipWriteContext } from './membership'

/** Adapt a request-scoped authority without retaining the request's credential in a receipt. */
export const membershipWriteContext = Effect.fn('membership.commandContext')(function* (
  authority: typeof CommandAuthority.Service,
  scopes: ReadonlyArray<McpScope>,
  input: typeof MembershipMutationInput.Type,
) {
  const services = yield* Effect.context()
  const checkpoint = yield* authority.checkpoint(scopes)

  return {
    ...input,
    actorId: checkpoint.actorId,
    clientId: checkpoint.clientId,
    resource: checkpoint.resource,
    now: Date.now(),
    live: checkpoint.liveGuard,
    authorize: () =>
      Effect.runPromiseWith(services)(
        authority.checkpoint(scopes).pipe(
          Effect.map(
            (fresh) =>
              fresh.actorId === checkpoint.actorId &&
              fresh.clientId === checkpoint.clientId &&
              fresh.resource === checkpoint.resource,
          ),
          Effect.catchTag('McpToolError', (error) =>
            error.code === 'access_denied' ? Effect.succeed(false) : Effect.fail(error),
          ),
        ),
      ),
  } satisfies MembershipWriteContext
})

/** A replay returns the original committed projection, never a later membership read. */
export const membershipOutcome = (result: OperationResult) => {
  if (result.status !== 'applied' && result.status !== 'replayed')
    return Effect.fail(
      new McpToolError({ code: result.status, message: 'Membership command was not applied.' }),
    )

  return Schema.decodeUnknownEffect(MembershipMutationResult)(result.outcome.result).pipe(
    Effect.mapError(
      () => new McpToolError({ code: 'unavailable', message: 'Membership receipt unavailable.' }),
    ),
  )
}
