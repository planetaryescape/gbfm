import { oauthProvider } from '@better-auth/oauth-provider'
import { EditorialReadScopes, OAuthClientId, OAuthGrantId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { Match, Option, Redacted, Schema } from 'effect'

import { verification } from '@/db/auth.schema'
import type { DatabaseClient } from '@/db/layer'
import {
  editorialOAuthEpoch,
  editorialOAuthRevokedGrant,
  oauthRefreshToken,
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

                if (session && session.user.id !== mcp.ownerUserId)
                  throw new APIError('FORBIDDEN', {
                    message: 'Editorial access is restricted to the owner',
                  })
              }

              if (ctx.path === '/oauth2/token') {
                const requestedScope = Schema.decodeUnknownOption(
                  Schema.Struct({ scope: Schema.optional(Schema.String) }),
                )(ctx.body).pipe(Option.getOrUndefined)?.scope

                if (requestedScope !== undefined)
                  Schema.decodeUnknownOption(EditorialReadScopes)(requestedScope.split(/\s+/)).pipe(
                    Option.getOrThrowWith(
                      () =>
                        new APIError('BAD_REQUEST', {
                          error: 'invalid_scope',
                          error_description: 'Editorial tokens require posts:read',
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
                              query: Schema.optional(Schema.Struct({ client_id: OAuthClientId })),
                            }),
                          ),
                        )(code.value).pipe(
                          Option.getOrThrowWith(
                            () =>
                              new APIError('BAD_REQUEST', { message: 'Invalid editorial grant' }),
                          ),
                        )

                        if (payload.userId !== mcp.ownerUserId)
                          throw new APIError('FORBIDDEN', {
                            message: 'Editorial access is restricted to the owner',
                          })

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

                      if (refresh && refresh.userId !== mcp.ownerUserId)
                        throw new APIError('FORBIDDEN', {
                          message: 'Editorial access is restricted to the owner',
                        })
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
      scopes: ['posts:read', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      loginPage: `${config.urls.frontend}/connect/gbfm`,
      consentPage: `${config.urls.frontend}/connect/gbfm/consent`,
      allowPublicClientPrelogin: true,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'native',
      clientRegistrationRequirePKCE: true,
      clientRegistrationDefaultScopes: ['posts:read', 'offline_access'],
      resources: [
        {
          identifier: mcp.resourceUrl,
          name: 'GBFM Editorial',
          allowedScopes: ['posts:read', 'offline_access'],
        },
      ],
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
        consentReferenceId: async ({ user, scopes }) => {
          Schema.decodeUnknownOption(EditorialReadScopes)(scopes).pipe(
            Option.getOrThrowWith(
              () =>
                new APIError('BAD_REQUEST', {
                  error: 'invalid_scope',
                  error_description: 'Editorial tokens require posts:read',
                }),
            ),
          )

          if (user.id !== mcp.ownerUserId)
            throw new APIError('FORBIDDEN', {
              message: 'Editorial access is restricted to the owner',
            })

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
