import { Schema } from 'effect'

import { UserId } from './identity'
import { canCreatePosts, Role } from './roles'

const OpaqueIdentity = Schema.NonEmptyString.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(/^[^\s\p{Cc}]+$/u),
)

export const OAuthClientId = OpaqueIdentity.pipe(Schema.brand('OAuthClientId'))

export type OAuthClientId = typeof OAuthClientId.Type

export const OAuthGrantId = Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand('OAuthGrantId'))

export type OAuthGrantId = typeof OAuthGrantId.Type

export const PostId = Schema.NonEmptyString.check(Schema.isMaxLength(200)).pipe(
  Schema.brand('PostId'),
)

export type PostId = typeof PostId.Type

export const PostVersion = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)).pipe(
  Schema.brand('PostVersion'),
)

export type PostVersion = typeof PostVersion.Type

const HttpsEndpoint = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    const url = URL.parse(value)

    return url !== null &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !value.includes('?') &&
      !value.includes('#') &&
      url.href === value
      ? undefined
      : 'Expected a canonical HTTPS endpoint without credentials, query or fragment'
  }),
)

export const McpResourceUrl = HttpsEndpoint.check(
  Schema.makeFilter((value) => URL.parse(value)?.pathname === '/mcp'),
).pipe(Schema.brand('McpResourceUrl'))

export type McpResourceUrl = typeof McpResourceUrl.Type

export const OAuthIssuerUrl = HttpsEndpoint.check(
  Schema.makeFilter((value) => URL.parse(value)?.pathname === '/auth'),
).pipe(Schema.brand('OAuthIssuerUrl'))

export type OAuthIssuerUrl = typeof OAuthIssuerUrl.Type

export const EditorialReadScope = Schema.Literals(['posts:read', 'offline_access'])

export type EditorialReadScope = typeof EditorialReadScope.Type

export const EditorialReadScopes = Schema.Array(EditorialReadScope).check(
  Schema.makeFilter(
    (scopes) => scopes.includes('posts:read') && new Set(scopes).size === scopes.length,
  ),
)

export type EditorialReadScopes = typeof EditorialReadScopes.Type

export const EditorialPrincipal = Schema.Struct({
  userId: UserId,
  clientId: OAuthClientId,
  scopes: EditorialReadScopes,
})

export type EditorialPrincipal = typeof EditorialPrincipal.Type

export const EditorialAccount = Schema.Struct({ role: Role, banned: Schema.NullOr(Schema.Boolean) })

export type EditorialAccount = typeof EditorialAccount.Type

export const canReadEditorial = (account: EditorialAccount) =>
  !account.banned && canCreatePosts(account.role)

export const EditorialOAuthSettings = Schema.Struct({
  resourceUrl: McpResourceUrl,
  issuer: OAuthIssuerUrl,
}).check(
  Schema.makeFilter(
    (settings) => URL.parse(settings.resourceUrl)?.origin === URL.parse(settings.issuer)?.origin,
  ),
)

export type EditorialOAuthSettings = typeof EditorialOAuthSettings.Type

export const EditorialOAuthConfiguration = Schema.TaggedUnion({
  Disabled: {},
  Enabled: { settings: EditorialOAuthSettings },
})

export type EditorialOAuthConfiguration = typeof EditorialOAuthConfiguration.Type
