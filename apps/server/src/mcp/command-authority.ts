import { AuthenticatedActor, type Actor } from '@gbfm/api/middleware/actor'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { canAuthorizeMcp, type McpPrincipal, type McpScope } from '@gbfm/core/editorial-mcp'
import type { KeyScope } from '@gbfm/core/personal-access-keys'
import { ROLES, Role } from '@gbfm/core/roles'
import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Predicate, Redacted, Schema } from 'effect'

import { Database, type DatabaseClient } from '@/db/layer'
import { hashEditorialOAuthToken } from '@/lib/editorial-oauth-token'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth } from '@/services/editorial-oauth.service'

import { McpToolError } from './contracts'

export interface CommandCheckpoint {
  readonly actorId: string
  readonly clientId: string
  readonly resource: string
  /** AND with the receipt fence on every domain mutation and final assertion. */
  readonly liveGuard: SQL
}

export class CommandAuthority extends Context.Service<
  CommandAuthority,
  {
    readonly checkpoint: (
      requiredScopes: ReadonlyArray<McpScope>,
    ) => Effect.Effect<CommandCheckpoint, McpToolError>
  }
>()('gbfm/mcp/CommandAuthority') {}

const denied = () => new McpToolError({ code: 'access_denied', message: 'Command access denied.' })

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Command authorization unavailable.' })

// Evaluate expiry inside the D1 statement, not against an earlier JS preflight clock.
const databaseNow = sql`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

const accountRoleGuard = (scopes: ReadonlyArray<McpScope>) => {
  const roles = ROLES.filter((role) =>
    canAuthorizeMcp({ role: Role.make(role), banned: false }, scopes),
  )

  return roles.length === 0
    ? sql`0`
    : sql`u.banned = 0 AND u.role IN (${sql.join(
        roles.map((role) => sql`${role}`),
        sql`, `,
      )})`
}

const check = (db: DatabaseClient, liveGuard: SQL) =>
  Effect.tryPromise({
    try: () => db.get(sql`SELECT CASE WHEN ${liveGuard} THEN 1 ELSE 0 END AS authorized`),
    catch: unavailable,
  }).pipe(
    Effect.flatMap((row) =>
      Schema.decodeUnknownEffect(Schema.Struct({ authorized: Schema.Literals([0, 1]) }))(row),
    ),
    Effect.mapError(unavailable),
    Effect.tapError(() =>
      Effect.logError('mcp.command_authority.unavailable', {
        operation: 'authority.lookup',
        dependency: 'database',
      }),
    ),
    Effect.flatMap((row) => (row.authorized === 1 ? Effect.void : Effect.fail(denied()))),
  )

/** Only the authenticated MCP route supplies the credential and pinned principal. */
export const makeOAuthCommandAuthority = Effect.fn('CommandAuthority.oauth')(function* (
  credential: Redacted.Redacted,
  pinned: McpPrincipal,
) {
  const db = yield* Database
  const oauth = yield* EditorialOAuth
  const config = yield* ConfigService

  const hash = yield* Effect.tryPromise({
    try: () => hashEditorialOAuthToken(Redacted.value(credential)),
    catch: unavailable,
  })

  return CommandAuthority.of({
    checkpoint: Effect.fn('CommandAuthority.oauthCheckpoint')(function* (requiredScopes) {
      const principal = yield* oauth
        .verify(credential)
        .pipe(
          Effect.mapError((error) =>
            Predicate.isTagged(error, 'EditorialOAuthInvalidToken') ? denied() : unavailable(),
          ),
        )

      if (
        !config.mcp ||
        principal.userId !== pinned.userId ||
        principal.clientId !== pinned.clientId ||
        !requiredScopes.every((scope) => principal.scopes.includes(scope))
      )
        return yield* denied()

      const resource = config.mcp.resourceUrl

      // Keep the exact freshly verified scope set pinned in the SQL predicate.
      // JSON() normalizes whitespace without relying on a storage encoding detail.
      const liveGuard = sql`EXISTS (
        SELECT 1 FROM oauth_access_token t
        JOIN oauth_client c ON c.client_id = t.client_id
        JOIN user u ON u.id = t.user_id
        JOIN oauth_resource r ON r.identifier = ${resource}
        LEFT JOIN session s ON s.id = t.session_id
        WHERE t.token = ${hash} AND t.user_id = ${principal.userId}
          AND t.client_id = ${principal.clientId}
          AND t.expires_at > ${databaseNow} AND t.revoked IS NULL
          AND t.confirmation IS NULL
          AND COALESCE(c.disabled, 0) = 0 AND COALESCE(r.disabled, 0) = 0
          AND ${accountRoleGuard(principal.scopes)}
          AND (t.session_id IS NULL OR (s.user_id = t.user_id AND s.expires_at > ${databaseNow}))
          AND NOT EXISTS (SELECT 1 FROM editorial_oauth_revoked_grant g
            WHERE g.reference_id = t.reference_id AND g.client_id = t.client_id)
          AND CASE WHEN json_valid(t.scopes) THEN json(t.scopes) = json(${JSON.stringify(principal.scopes)}) ELSE 0 END
          AND CASE WHEN json_valid(t.resources) THEN json(t.resources) = json(${JSON.stringify([resource])}) ELSE 0 END
          AND CASE WHEN r.allowed_scopes IS NULL THEN 1
            WHEN json_valid(r.allowed_scopes) AND json_type(r.allowed_scopes) = 'array' THEN
              NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(principal.scopes)}) granted
                WHERE NOT EXISTS (SELECT 1 FROM json_each(r.allowed_scopes) allowed WHERE allowed.value = granted.value))
            ELSE 0 END
      )`

      yield* check(db, liveGuard)

      return { actorId: principal.userId, clientId: principal.clientId, resource, liveGuard }
    }),
  })
})

const firstPartyAuthority = (
  db: DatabaseClient,
  resource: string,
  actorId: string,
  clientId: string,
  credentialGuard: SQL,
) =>
  CommandAuthority.of({
    checkpoint: Effect.fn('CommandAuthority.firstPartyCheckpoint')(function* (requiredScopes) {
      const liveGuard = sql`EXISTS (SELECT 1 FROM user u WHERE u.id = ${actorId}
        AND ${accountRoleGuard(requiredScopes)} AND ${credentialGuard})`

      yield* check(db, liveGuard)

      return { actorId, clientId, resource, liveGuard }
    }),
  })

/** Existing session-only API handlers: stable actor namespace, live session fence. */
export const makeSessionCommandAuthority = Effect.gen(function* () {
  const identity = yield* AuthSession
  const db = yield* Database
  const config = yield* ConfigService

  return firstPartyAuthority(
    db,
    new URL('/api', config.urls.share).href,
    identity.user.id,
    'gbfm:session',
    sql`EXISTS (SELECT 1 FROM session s WHERE s.id = ${identity.session.id}
      AND s.user_id = u.id AND s.expires_at > ${databaseNow})`,
  )
})

/** Existing ActorMiddleware routes only; this does not add PAT support to session routes.
 * The handler supplies its established PAT operation scopes, never an MCP-to-PAT guess.
 */
export const makeActorCommandAuthority = Effect.fn('CommandAuthority.actor')(function* (
  requiredKeyScopes: ReadonlyArray<KeyScope>,
) {
  const actor: Actor = yield* AuthenticatedActor
  const db = yield* Database
  const config = yield* ConfigService
  const credential = actor.credential
  const resource = new URL('/api', config.urls.share).href

  if (Predicate.isTagged(credential, 'Session'))
    return firstPartyAuthority(
      db,
      resource,
      actor.user.id,
      'gbfm:session',
      sql`EXISTS (SELECT 1 FROM session s WHERE s.id = ${credential.sessionId}
        AND s.user_id = u.id AND s.expires_at > ${databaseNow})`,
    )

  if (requiredKeyScopes.length === 0) return yield* denied()

  const authority = firstPartyAuthority(
    db,
    resource,
    actor.user.id,
    `gbfm:pat:${credential.keyId}`,
    sql`EXISTS (SELECT 1 FROM personal_access_keys k WHERE k.id = ${credential.keyId}
      AND k.owner_user_id = u.id AND k.environment = ${config.app.stage}
      AND k.environment = ${credential.environment}
      AND k.revoked_at IS NULL AND k.expires_at > ${databaseNow}
      AND CASE WHEN json_valid(k.scopes) AND json_type(k.scopes) = 'array' THEN
        NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(requiredKeyScopes)}) required
          WHERE NOT EXISTS (SELECT 1 FROM json_each(k.scopes) granted WHERE granted.value = required.value))
        ELSE 0 END
      AND (u.role IN ('creator', 'editor', 'admin'))
      AND (${requiredKeyScopes.includes('posts:publish') ? 1 : 0} = 0 OR u.role IN ('editor', 'admin'))
    )`,
  )

  return CommandAuthority.of({
    checkpoint: (requiredScopes) => {
      // PATs currently authorize post operations only, even for an admin owner.
      if (
        requiredScopes.some(
          (scope) => !['posts:read', 'drafts:write', 'content:publish'].includes(scope),
        ) ||
        (requiredScopes.includes('drafts:write') &&
          !requiredKeyScopes.some(
            (scope) => scope === 'posts:create' || scope === 'posts:update',
          )) ||
        (requiredScopes.includes('content:publish') && !requiredKeyScopes.includes('posts:publish'))
      )
        return Effect.fail(denied())

      return authority.checkpoint(requiredScopes)
    },
  })
})
