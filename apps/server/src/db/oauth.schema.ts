import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { session, user } from './auth.schema'

const id = () => text('id').primaryKey()

const date = (name: string) => integer(name, { mode: 'timestamp_ms' })

const strings = (name: string) => text(name)

const json = (name: string) => text(name)

const bool = (name: string) => integer(name, { mode: 'boolean' })

export const oauthClient = sqliteTable('oauth_client', {
  id: id(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  clientDiscoveryId: text('client_discovery_id'),
  disabled: bool('disabled').default(false),
  skipConsent: bool('skip_consent'),
  enableEndSession: bool('enable_end_session'),
  subjectType: text('subject_type'),
  scopes: strings('scopes'),
  clientCredentialsScopes: strings('client_credentials_scopes').default('[]'),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: date('created_at'),
  updatedAt: date('updated_at'),
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: strings('contacts'),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  softwareStatement: text('software_statement'),
  redirectUris: strings('redirect_uris').notNull(),
  postLogoutRedirectUris: strings('post_logout_redirect_uris'),
  backchannelLogoutUri: text('backchannel_logout_uri'),
  backchannelLogoutSessionRequired: bool('backchannel_logout_session_required'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  applicationType: text('application_type'),
  jwks: text('jwks'),
  jwksUri: text('jwks_uri'),
  grantTypes: strings('grant_types'),
  responseTypes: strings('response_types'),
  requirePKCE: bool('require_pkce'),
  dpopBoundAccessTokens: bool('dpop_bound_access_tokens').default(false),
  referenceId: text('reference_id'),
  metadata: json('metadata'),
})

export const oauthResource = sqliteTable('oauth_resource', {
  id: id(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: strings('allowed_scopes'),
  customClaims: json('custom_claims'),
  dpopBoundAccessTokensRequired: bool('dpop_bound_access_tokens_required').default(false),
  disabled: bool('disabled').default(false),
  createdAt: date('created_at'),
  updatedAt: date('updated_at'),
  policyVersion: integer('policy_version').default(1),
  metadata: json('metadata'),
})

export const oauthClientResource = sqliteTable(
  'oauth_client_resource',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: json('metadata'),
    createdAt: date('created_at'),
  },
  (table) => [uniqueIndex('oauth_client_resource_pair').on(table.clientId, table.resourceId)],
)

const grantFields = () => ({
  id: id(),
  token: text('token').notNull().unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  referenceId: text('reference_id'),
  authorizationCodeId: text('authorization_code_id'),
  resources: strings('resources'),
  requestedUserInfoClaims: strings('requested_user_info_claims'),
  expiresAt: date('expires_at').notNull(),
  createdAt: date('created_at').notNull(),
  revoked: date('revoked'),
  confirmation: json('confirmation'),
  scopes: strings('scopes').notNull(),
})

export const oauthRefreshToken = sqliteTable(
  'oauth_refresh_token',
  {
    ...grantFields(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rotatedAt: date('rotated_at'),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: date('rotation_replay_expires_at'),
    authTime: date('auth_time'),
  },
  (table) => [
    index('oauth_refresh_token_user_client').on(table.userId, table.clientId),
    index('oauth_refresh_token_code').on(table.authorizationCodeId),
    index('oauth_refresh_token_client_id_idx').on(table.clientId),
    index('oauth_refresh_token_session_id_idx').on(table.sessionId),
  ],
)

export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    ...grantFields(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('oauth_access_token_user_client').on(table.userId, table.clientId),
    index('oauth_access_token_code').on(table.authorizationCodeId),
    index('oauth_access_token_client_id_idx').on(table.clientId),
    index('oauth_access_token_session_id_idx').on(table.sessionId),
    index('oauth_access_token_refresh_id_idx').on(table.refreshId),
  ],
)

export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    resources: strings('resources'),
    requestedUserInfoClaims: strings('requested_user_info_claims'),
    scopes: strings('scopes').notNull(),
    createdAt: date('created_at').notNull(),
    updatedAt: date('updated_at').notNull(),
  },
  (table) => [index('oauth_consent_user_client').on(table.userId, table.clientId)],
)

export const oauthClientAssertion = sqliteTable('oauth_client_assertion', {
  id: id(),
  expiresAt: date('expires_at').notNull(),
})

export const editorialOAuthRevokedGrant = sqliteTable(
  'editorial_oauth_revoked_grant',
  {
    id: id(),
    referenceId: text('reference_id').notNull(),
    clientId: text('client_id').notNull(),
  },
  (table) => [
    uniqueIndex('editorial_oauth_revoked_grant_pair').on(table.referenceId, table.clientId),
  ],
)

export const editorialOAuthEpoch = sqliteTable('editorial_oauth_epoch', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  generation: text('generation').notNull(),
})

export const rateLimit = sqliteTable('rate_limit', {
  id: id(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
})
