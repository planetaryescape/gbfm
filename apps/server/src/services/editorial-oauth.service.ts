import {
  EditorialPrincipal,
  EditorialReadScope,
  EditorialReadScopes,
  McpResourceUrl,
  OAuthClientId,
  OAuthGrantId,
} from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { canCreatePosts, Role } from '@gbfm/core/roles'
import { and, eq, gt, isNull, notExists, sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Redacted, Schema } from 'effect'

import { session, user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  editorialOAuthEpoch,
  editorialOAuthRevokedGrant,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
} from '@/db/oauth.schema'
import { hashEditorialOAuthToken } from '@/lib/editorial-oauth-token'
import { ConfigService } from '@/services/config.service'

export class EditorialOAuthInvalidToken extends Schema.TaggedError<
  EditorialOAuthInvalidToken,
  { readonly brand: unique symbol }
>()('EditorialOAuthInvalidToken', {}) {}

export class EditorialOAuthUnavailable extends Schema.TaggedError<
  EditorialOAuthUnavailable,
  { readonly brand: unique symbol }
>()('EditorialOAuthUnavailable', {}) {}

export type EditorialOAuthPrincipal = EditorialPrincipal

const PersistedGrant = Schema.Struct({
  userId: UserId,
  clientId: OAuthClientId,
  referenceId: OAuthGrantId,
  scopes: Schema.fromJsonString(EditorialReadScopes),
  resources: Schema.fromJsonString(Schema.Array(McpResourceUrl)),
  sessionId: Schema.NullOr(Schema.String),
  sessionExpiresAt: Schema.NullOr(Schema.Date),
  confirmation: Schema.NullOr(Schema.String),
  clientDisabled: Schema.NullOr(Schema.Boolean),
  userBanned: Schema.NullOr(Schema.Boolean),
  role: Role,
})

const PersistedConnection = Schema.Struct({
  clientId: OAuthClientId,
  name: Schema.NullOr(Schema.String),
  scopes: Schema.fromJsonString(EditorialReadScopes),
  createdAt: Schema.Date,
})

const makeEditorialOAuth = Effect.gen(function* () {
  const db = yield* Database
  const config = yield* ConfigService

  const storage = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: () => new EditorialOAuthUnavailable() })

  const verify = Effect.fn('EditorialOAuth.verify')(function* (credential: Redacted.Redacted) {
    const mcp = config.mcp
    const token = Redacted.value(credential)

    if (!mcp || token.length > 1024 || !token.length)
      return yield* Effect.fail(new EditorialOAuthInvalidToken())
    const hash = yield* storage(() => hashEditorialOAuthToken(token))
    const now = new Date(yield* Clock.currentTimeMillis)

    const [row] = yield* storage(() =>
      db
        .select({
          userId: user.id,
          clientId: oauthClient.clientId,
          referenceId: oauthAccessToken.referenceId,
          scopes: oauthAccessToken.scopes,
          resources: oauthAccessToken.resources,
          sessionId: oauthAccessToken.sessionId,
          sessionExpiresAt: session.expiresAt,
          confirmation: oauthAccessToken.confirmation,
          clientDisabled: oauthClient.disabled,
          userBanned: user.banned,
          role: user.role,
        })
        .from(oauthAccessToken)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
        .innerJoin(user, eq(user.id, oauthAccessToken.userId))
        .leftJoin(session, eq(session.id, oauthAccessToken.sessionId))
        .where(
          and(
            eq(oauthAccessToken.token, hash),
            gt(oauthAccessToken.expiresAt, now),
            isNull(oauthAccessToken.revoked),
            notExists(
              db
                .select()
                .from(editorialOAuthRevokedGrant)
                .where(
                  and(
                    eq(editorialOAuthRevokedGrant.referenceId, oauthAccessToken.referenceId),
                    eq(editorialOAuthRevokedGrant.clientId, oauthAccessToken.clientId),
                  ),
                ),
            ),
          ),
        )
        .limit(1),
    )

    const grant = yield* Schema.decodeUnknownEffect(PersistedGrant)(row).pipe(
      Effect.mapError(() => new EditorialOAuthInvalidToken()),
    )

    if (
      grant.clientDisabled ||
      grant.userBanned ||
      !canCreatePosts(grant.role) ||
      grant.confirmation ||
      (grant.sessionId && (!grant.sessionExpiresAt || grant.sessionExpiresAt <= now)) ||
      grant.resources.length !== 1 ||
      grant.resources[0] !== mcp.resourceUrl
    )
      return yield* Effect.fail(new EditorialOAuthInvalidToken())

    const [resource] = yield* storage(() =>
      db
        .select({ disabled: oauthResource.disabled, allowedScopes: oauthResource.allowedScopes })
        .from(oauthResource)
        .where(eq(oauthResource.identifier, mcp.resourceUrl))
        .limit(1),
    )

    const policy = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        disabled: Schema.NullOr(Schema.Boolean),
        allowedScopes: Schema.NullOr(Schema.fromJsonString(Schema.Array(EditorialReadScope))),
      }),
    )(resource).pipe(Effect.mapError(() => new EditorialOAuthInvalidToken()))

    if (
      policy.disabled ||
      (policy.allowedScopes && grant.scopes.some((scope) => !policy.allowedScopes?.includes(scope)))
    )
      return yield* Effect.fail(new EditorialOAuthInvalidToken())

    return yield* Schema.decodeUnknownEffect(EditorialPrincipal)({
      userId: grant.userId,
      clientId: grant.clientId,
      scopes: grant.scopes,
    }).pipe(Effect.mapError(() => new EditorialOAuthInvalidToken()))
  })

  const listConnections = Effect.fn('EditorialOAuth.listConnections')(function* (userId: UserId) {
    const rows = yield* storage(() =>
      db
        .select({
          clientId: oauthClient.clientId,
          name: oauthClient.name,
          scopes: oauthConsent.scopes,
          createdAt: oauthConsent.createdAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
        .where(eq(oauthConsent.userId, userId))
        .limit(100),
    )

    const parsed = yield* Schema.decodeUnknownEffect(Schema.Array(PersistedConnection))(rows).pipe(
      Effect.mapError(() => new EditorialOAuthUnavailable()),
    )

    const connections = new Map<
      OAuthClientId,
      { clientId: OAuthClientId; name: string; scopes: EditorialReadScopes; createdAt: string }
    >()

    for (const row of parsed) {
      const previous = connections.get(row.clientId)
      connections.set(row.clientId, {
        clientId: row.clientId,
        name: row.name ?? 'OAuth client',
        scopes: [...new Set([...(previous?.scopes ?? []), ...row.scopes])],
        createdAt: previous?.createdAt ?? row.createdAt.toISOString(),
      })
    }

    return [...connections.values()]
  })

  const disconnect = Effect.fn('EditorialOAuth.disconnect')(function* (
    userId: UserId,
    clientId: OAuthClientId,
  ) {
    const now = new Date(yield* Clock.currentTimeMillis)
    yield* storage(() =>
      db.batch([
        db
          .insert(editorialOAuthEpoch)
          .values({ userId, generation: crypto.randomUUID() })
          .onConflictDoNothing(),
        db
          .insert(editorialOAuthRevokedGrant)
          .select(
            db
              .select({
                id: sql<string>`${editorialOAuthEpoch.generation} || ':' || ${clientId}`.as('id'),
                referenceId: editorialOAuthEpoch.generation,
                clientId: sql<string>`${clientId}`.as('client_id'),
              })
              .from(editorialOAuthEpoch)
              .where(eq(editorialOAuthEpoch.userId, userId)),
          )
          .onConflictDoNothing(),
        db
          .insert(editorialOAuthRevokedGrant)
          .select(
            db
              .select({
                id: sql<string>`${oauthConsent.referenceId} || ':' || ${clientId}`.as('id'),
                referenceId: sql<string>`${oauthConsent.referenceId}`.as('reference_id'),
                clientId: oauthConsent.clientId,
              })
              .from(oauthConsent)
              .where(
                and(
                  eq(oauthConsent.userId, userId),
                  eq(oauthConsent.clientId, clientId),
                  sql`${oauthConsent.referenceId} IS NOT NULL`,
                ),
              ),
          )
          .onConflictDoNothing(),
        db
          .insert(editorialOAuthRevokedGrant)
          .select(
            db
              .select({
                id: sql<string>`${oauthRefreshToken.referenceId} || ':' || ${clientId}`.as('id'),
                referenceId: sql<string>`${oauthRefreshToken.referenceId}`.as('reference_id'),
                clientId: oauthRefreshToken.clientId,
              })
              .from(oauthRefreshToken)
              .where(
                and(
                  eq(oauthRefreshToken.userId, userId),
                  eq(oauthRefreshToken.clientId, clientId),
                  sql`${oauthRefreshToken.referenceId} IS NOT NULL`,
                ),
              ),
          )
          .onConflictDoNothing(),
        db
          .insert(editorialOAuthRevokedGrant)
          .select(
            db
              .select({
                id: sql<string>`${oauthAccessToken.referenceId} || ':' || ${clientId}`.as('id'),
                referenceId: sql<string>`${oauthAccessToken.referenceId}`.as('reference_id'),
                clientId: oauthAccessToken.clientId,
              })
              .from(oauthAccessToken)
              .where(
                and(
                  eq(oauthAccessToken.userId, userId),
                  eq(oauthAccessToken.clientId, clientId),
                  sql`${oauthAccessToken.referenceId} IS NOT NULL`,
                ),
              ),
          )
          .onConflictDoNothing(),
        db
          .update(editorialOAuthEpoch)
          .set({ generation: crypto.randomUUID() })
          .where(eq(editorialOAuthEpoch.userId, userId)),
        db
          .update(oauthRefreshToken)
          .set({ revoked: now, rotationReplayResponse: null, rotationReplayExpiresAt: null })
          .where(
            and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)),
          ),
        db
          .update(oauthAccessToken)
          .set({ revoked: now })
          .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId))),
        db
          .delete(oauthConsent)
          .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))),
      ]),
    )

    return undefined
  })

  return { verify, listConnections, disconnect }
})

export class EditorialOAuth extends Context.Service<
  EditorialOAuth,
  Effect.Success<typeof makeEditorialOAuth>
>()('EditorialOAuth') {}

export const EditorialOAuthLive = Layer.effect(EditorialOAuth, makeEditorialOAuth)
