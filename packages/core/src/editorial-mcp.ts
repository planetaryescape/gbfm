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

export const EDITORIAL_DRAFT_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000

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

export const EditorialScope = Schema.Literals(['posts:read', 'offline_access', 'drafts:write'])

export type EditorialScope = typeof EditorialScope.Type

export const EditorialScopes = Schema.Array(EditorialScope).check(
  Schema.makeFilter(
    (scopes) => scopes.includes('posts:read') && new Set(scopes).size === scopes.length,
  ),
)

export type EditorialScopes = typeof EditorialScopes.Type

export const EditorialPrincipal = Schema.Struct({
  userId: UserId,
  clientId: OAuthClientId,
  scopes: EditorialScopes,
})

export type EditorialPrincipal = typeof EditorialPrincipal.Type

export const EditorialAccount = Schema.Struct({ role: Role, banned: Schema.NullOr(Schema.Boolean) })

export type EditorialAccount = typeof EditorialAccount.Type

export const canReadEditorial = (account: EditorialAccount) =>
  !account.banned && canCreatePosts(account.role)

// Separate from EditorialScopes: a listener grant must not require posts:read.
export const McpScope = Schema.Literals([
  ...EditorialScope.literals,
  'catalogue:read',
  'catalogue:write',
  'catalogue:import',
  'catalogue:propose',
  'catalogue:inspect',
  'catalogue:repair',
  'content:read',
  'providers:read',
  'playlists:write',
  'playlists:publish',
  'listening:read',
  'listening:write',
  'listening:publish',
  'favorites:read',
  'favorites:write',
  'subscriptions:read',
  'subscriptions:write',
  'reminders:read',
  'reminders:write',
  'creator:read',
  'creator:write',
  'micros:publish',
  'assets:read',
  'assets:upload',
  'content:publish',
  'content:delete',
  'admin:read',
])

export type McpScope = typeof McpScope.Type

export const McpScopes = Schema.Array(McpScope).check(
  Schema.makeFilter(
    (scopes) =>
      scopes.some((scope) => scope !== 'offline_access') &&
      new Set(scopes).size === scopes.length &&
      (!scopes.includes('drafts:write') || scopes.includes('posts:read')),
  ),
)

export type McpScopes = typeof McpScopes.Type

export const McpPrincipal = Schema.Struct({
  ...EditorialPrincipal.fields,
  scopes: McpScopes,
})

export type McpPrincipal = typeof McpPrincipal.Type

export const canAuthorizeMcp = (account: EditorialAccount, scopes: McpScopes) =>
  !account.banned &&
  scopes.every((scope) => {
    switch (scope) {
      case 'catalogue:write':
      case 'catalogue:import':
      case 'catalogue:inspect':
      case 'catalogue:repair':
      case 'playlists:write':
      case 'playlists:publish':
      case 'admin:read':
        return account.role === 'admin'
      case 'posts:read':
      case 'drafts:write':
      case 'creator:read':
      case 'creator:write':
      case 'micros:publish':
      case 'assets:read':
      case 'assets:upload':
      case 'content:publish':
      case 'content:delete':
        return canCreatePosts(account.role)
      default:
        return true
    }
  })

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
