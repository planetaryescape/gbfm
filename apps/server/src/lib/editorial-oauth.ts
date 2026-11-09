import { oauthProvider } from '@better-auth/oauth-provider'
import {
  canAuthorizeMcp,
  EditorialAccount,
  McpScope,
  McpScopes,
  OAuthClientId,
  OAuthGrantId,
} from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { Effect, Match, Option, Redacted, Schema } from 'effect'

import { user as userTable, verification } from '@/db/auth.schema'
import type { DatabaseClient } from '@/db/layer'
import {
  editorialOAuthEpoch,
  editorialOAuthRevokedGrant,
  oauthRefreshToken,
  oauthResource,
} from '@/db/oauth.schema'
import {
  BoundedOAuthRegistrationPayload,
  EditorialTokenExchange,
  NativeOAuthRegistration,
} from '@/lib/editorial-oauth-policy-model'
import { hashEditorialOAuthToken } from '@/lib/editorial-oauth-token'
import type { ConfigService } from '@/services/config.service'

export const editorialOAuthPlugins = (config: ConfigService, db: DatabaseClient) => {
  const mcp = config.mcp

  if (!mcp) return []

  const forbidden = () =>
    new APIError('FORBIDDEN', {
      code: 'EDITORIAL_PERMISSION_REQUIRED',
      message: 'Editorial permission required',
    })

  const parseUserId = (value: string) =>
    Schema.decodeUnknownOption(UserId)(value).pipe(Option.getOrThrowWith(forbidden))

  const GrantSession = Schema.Struct({ impersonatedBy: Schema.optional(Schema.NullOr(UserId)) })

  const authorizeAccount = async (userId: UserId, scopes: McpScopes = ['posts:read']) => {
    const [resource] = await db
      .select({ disabled: oauthResource.disabled, allowedScopes: oauthResource.allowedScopes })
      .from(oauthResource)
      .where(eq(oauthResource.identifier, mcp.resourceUrl))
      .limit(1)
      .catch(() => {
        throw new APIError('SERVICE_UNAVAILABLE', { message: 'MCP resource unavailable' })
      })

    const policy = Schema.decodeUnknownOption(
      Schema.Struct({
        disabled: Schema.NullOr(Schema.Boolean),
        allowedScopes: Schema.NullOr(Schema.fromJsonString(Schema.Array(McpScope))),
      }),
    )(resource).pipe(
      Option.getOrThrowWith(
        () => new APIError('SERVICE_UNAVAILABLE', { message: 'MCP resource unavailable' }),
      ),
    )

    if (
      policy.disabled ||
      scopes.some((scope) => policy.allowedScopes !== null && !policy.allowedScopes.includes(scope))
    )
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_scope',
        error_description:
          'Requested permissions are not enabled for this GBFM environment. An operator must enable them before you reconnect; signing in again cannot enable them.',
      })

    const [row] = await db
      .select({ role: userTable.role, banned: userTable.banned })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1)
      .catch(async () => {
        await Effect.runPromise(
          Effect.logError('editorial.authorization.unavailable', {
            operation: 'account.lookup',
            dependency: 'database',
          }),
        )
        throw new APIError('SERVICE_UNAVAILABLE', { message: 'Editorial account unavailable' })
      })

    const account = Schema.decodeUnknownOption(EditorialAccount)(row).pipe(
      Option.getOrThrowWith(forbidden),
    )

    if (!canAuthorizeMcp(account, scopes)) throw forbidden()
  }

  return [
    {
      id: 'editorial-oauth-policy' satisfies 'editorial-oauth-policy',
      hooks: {
        before: [
          {
            matcher: (ctx) => ctx.path?.startsWith('/oauth2/') ?? false,
            handler: createAuthMiddleware(async (ctx) => {
              if (['/oauth2/authorize', '/oauth2/consent', '/oauth2/continue'].includes(ctx.path)) {
                const session = await getSessionFromCtx(ctx)

                if (session) {
                  const grantSession = Schema.decodeUnknownOption(GrantSession)(
                    session.session,
                  ).pipe(Option.getOrThrowWith(forbidden))

                  if (grantSession.impersonatedBy) throw forbidden()
                  const query = Schema.decodeUnknownOption(Schema.String)(ctx.query?.scope)

                  // Signed continuations are validated by the provider and postLogin below.
                  const scopes = Option.isSome(query)
                    ? Schema.decodeUnknownOption(McpScopes)(query.value.split(/\s+/)).pipe(
                        Option.getOrUndefined,
                      )
                    : undefined

                  if (ctx.path === '/oauth2/authorize')
                    await authorizeAccount(parseUserId(session.user.id), scopes)
                }
              }

              if (ctx.path === '/oauth2/token') {
                const requestedScope = Schema.decodeUnknownOption(
                  Schema.Struct({ scope: Schema.optional(Schema.String) }),
                )(ctx.body).pipe(Option.getOrUndefined)?.scope

                if (requestedScope !== undefined)
                  Schema.decodeUnknownOption(McpScopes)(requestedScope.split(/\s+/)).pipe(
                    Option.getOrThrowWith(
                      () =>
                        new APIError('BAD_REQUEST', {
                          error: 'invalid_scope',
                          error_description: 'Invalid MCP scope set',
                        }),
                    ),
                  )

                const exchange = Schema.decodeUnknownOption(EditorialTokenExchange)(ctx.body).pipe(
                  Option.getOrUndefined,
                )

                if (exchange)
                  await Match.value(exchange).pipe(
                    Match.discriminator('grant_type')('authorization_code', async (body) => {
                      const hash = await hashEditorialOAuthToken(Redacted.value(body.code))

                      const [code] = await db
                        .select()
                        .from(verification)
                        .where(eq(verification.identifier, hash))
                        .limit(1)

                      if (code) {
                        const payload = Schema.decodeUnknownOption(
                          Schema.fromJsonString(
                            Schema.Struct({
                              userId: UserId,
                              referenceId: Schema.optional(OAuthGrantId),
                              query: Schema.optional(
                                Schema.Struct({
                                  client_id: OAuthClientId,
                                  scope: Schema.optional(Schema.String),
                                }),
                              ),
                            }),
                          ),
                        )(code.value).pipe(
                          Option.getOrThrowWith(
                            () =>
                              new APIError('BAD_REQUEST', {
                                error: 'invalid_grant',
                                error_description: 'Invalid editorial grant',
                              }),
                          ),
                        )

                        const scopes =
                          payload.query?.scope === undefined
                            ? undefined
                            : Schema.decodeUnknownOption(McpScopes)(
                                payload.query.scope.split(/\s+/),
                              ).pipe(Option.getOrThrowWith(forbidden))

                        await authorizeAccount(payload.userId, scopes)

                        if (!payload.referenceId || !payload.query)
                          throw new APIError('BAD_REQUEST', {
                            error: 'invalid_grant',
                            error_description: 'Invalid editorial grant',
                          })

                        const [revoked] = await db
                          .select({ id: editorialOAuthRevokedGrant.id })
                          .from(editorialOAuthRevokedGrant)
                          .where(
                            and(
                              eq(editorialOAuthRevokedGrant.referenceId, payload.referenceId),
                              eq(editorialOAuthRevokedGrant.clientId, payload.query.client_id),
                            ),
                          )
                          .limit(1)

                        if (revoked)
                          throw new APIError('BAD_REQUEST', {
                            error: 'invalid_grant',
                            error_description: 'Editorial grant revoked',
                          })
                      }
                    }),
                    Match.discriminator('grant_type')('refresh_token', async (body) => {
                      const hash = await hashEditorialOAuthToken(Redacted.value(body.refresh_token))

                      const [refresh] = await db
                        .select()
                        .from(oauthRefreshToken)
                        .where(eq(oauthRefreshToken.token, hash))
                        .limit(1)

                      if (refresh)
                        await authorizeAccount(
                          parseUserId(refresh.userId),
                          Schema.decodeUnknownOption(Schema.fromJsonString(McpScopes))(
                            refresh.scopes,
                          ).pipe(Option.getOrThrowWith(forbidden)),
                        )
                    }),
                    Match.exhaustive,
                  )
              }

              if (ctx.path === '/oauth2/register') {
                const registrationError = () =>
                  new APIError('BAD_REQUEST', {
                    message: 'Only bounded public native clients are supported',
                  })

                const payload = Schema.decodeUnknownOption(BoundedOAuthRegistrationPayload)(
                  ctx.body,
                ).pipe(Option.getOrThrowWith(registrationError))

                Schema.decodeUnknownOption(NativeOAuthRegistration)(payload).pipe(
                  Option.getOrThrowWith(registrationError),
                )
              }
            }),
          },
        ],
      },
    },
    oauthProvider({
      disableJwtPlugin: true,
      scopes: [...McpScope.literals],
      grantTypes: ['authorization_code', 'refresh_token'],
      loginPage: `${config.urls.frontend}/connect/gbfm`,
      consentPage: `${config.urls.frontend}/connect/gbfm/consent`,
      allowPublicClientPrelogin: true,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'native',
      clientRegistrationRequirePKCE: true,
      clientRegistrationDefaultScopes: ['posts:read', 'offline_access'],
      clientRegistrationAllowedScopes: McpScope.literals.filter(
        (scope) => scope !== 'posts:read' && scope !== 'offline_access',
      ),
      resources: [
        {
          identifier: mcp.resourceUrl,
          name: 'GBFM Editorial',
          allowedScopes: ['posts:read', 'offline_access', 'drafts:write'],
        },
      ],
      resourceSeedMode: 'insertOnly',
      clientRegistrationDefaultResources: [mcp.resourceUrl],
      enforcePerClientResources: true,
      resourcePrivileges: () => false,
      clientPrivileges: () => false,
      accessTokenExpiresIn: 900,
      refreshTokenReuseInterval: 0,
      codeExpiresIn: 120,
      rateLimit: { register: { window: 60, max: 5 } },
      postLogin: {
        page: `${config.urls.frontend}/connect/gbfm`,
        consentReferenceId: async ({ user, session, scopes }) => {
          const parsedScopes = Schema.decodeUnknownOption(McpScopes)(scopes).pipe(
            Option.getOrThrowWith(
              () =>
                new APIError('BAD_REQUEST', {
                  error: 'invalid_scope',
                  error_description: 'Invalid MCP scope set',
                }),
            ),
          )

          const grantSession = Schema.decodeUnknownOption(GrantSession)(session).pipe(
            Option.getOrThrowWith(forbidden),
          )

          if (grantSession.impersonatedBy) throw forbidden()
          await authorizeAccount(parseUserId(user.id), parsedScopes)

          await db
            .insert(editorialOAuthEpoch)
            .values({ userId: user.id, generation: crypto.randomUUID() })
            .onConflictDoNothing()

          const [epoch] = await db
            .select()
            .from(editorialOAuthEpoch)
            .where(eq(editorialOAuthEpoch.userId, user.id))
            .limit(1)

          if (!epoch)
            throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Editorial grant unavailable' })

          return Schema.decodeUnknownSync(OAuthGrantId)(epoch.generation)
        },
        shouldRedirect: () => false,
      },
    }),
  ] satisfies Array<BetterAuthPlugin>
}
