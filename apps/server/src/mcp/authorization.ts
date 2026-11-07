import {
  canAuthorizeMcp,
  EditorialAccount,
  type McpPrincipal,
  type McpScope,
} from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'

import { EditorialToolError } from './contracts'

export const McpActor = Context.Service<McpPrincipal>('gbfm/mcp/EditorialActor')

export const McpPermission = Context.Service<{
  readonly scopes: ReadonlyArray<McpScope>
}>('gbfm/mcp/Permission')

const denied = () =>
  new EditorialToolError({ code: 'access_denied', message: 'MCP access denied.' })

const makeAuthorization = Effect.gen(function* () {
  const db = yield* Database

  const requireScopes = Effect.fn('McpAuthorization.requireScopes')(function* (
    scopes: ReadonlyArray<McpScope>,
  ) {
    const identity = yield* Effect.serviceOption(McpActor)

    if (Option.isNone(identity)) return yield* denied()
    const principal = identity.value

    if (!scopes.every((scope) => principal.scopes.includes(scope))) return yield* denied()

    const [row] = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ role: user.role, banned: user.banned })
          .from(user)
          .where(eq(user.id, principal.userId))
          .limit(1),
      catch: () =>
        new EditorialToolError({ code: 'unavailable', message: 'MCP authorization unavailable.' }),
    }).pipe(
      Effect.tapError(() =>
        Effect.logError('mcp.authorization.unavailable', {
          operation: 'account.lookup',
          dependency: 'database',
        }),
      ),
    )

    const account = yield* Schema.decodeUnknownEffect(EditorialAccount)(row).pipe(
      Effect.mapError(denied),
    )

    if (!canAuthorizeMcp(account, scopes)) return yield* denied()

    return { ...principal, role: account.role }
  })

  return {
    requireScopes,
    listener: requireScopes,
    catalogue: requireScopes(['catalogue:read']),
    editorial: (write = false) =>
      requireScopes(write ? ['posts:read', 'drafts:write'] : ['posts:read']),
    highTrust: (scope: McpScope) =>
      requireScopes([scope]).pipe(
        Effect.flatMap((actor) =>
          actor.role === 'admin' ? Effect.succeed(actor) : Effect.fail(denied()),
        ),
      ),
  }
})

export class McpAuthorization extends Context.Service<
  McpAuthorization,
  Effect.Success<typeof makeAuthorization>
>()('gbfm/mcp/Authorization') {}

export const McpAuthorizationLive = Layer.effect(McpAuthorization, makeAuthorization)
