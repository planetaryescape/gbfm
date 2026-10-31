import { KeyEnvironment, KeyScopes } from '@gbfm/core/personal-access-keys'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

import { AuthMiddleware } from './middleware/auth'

export class InvalidKeyCredential extends Schema.TaggedError<InvalidKeyCredential>()(
  'InvalidKeyCredential',
  {},
  { httpApiStatus: 401 },
) {}

export class KeyAccessDenied extends Schema.TaggedError<KeyAccessDenied>()(
  'KeyAccessDenied',
  {},
  { httpApiStatus: 403 },
) {}

export class KeyInputInvalid extends Schema.TaggedError<KeyInputInvalid>()(
  'KeyInputInvalid',
  {},
  { httpApiStatus: 422 },
) {}

export class KeyStoreUnavailable extends Schema.TaggedError<KeyStoreUnavailable>()(
  'KeyStoreUnavailable',
  {},
  { httpApiStatus: 503 },
) {}

export class KeyRateLimited extends Schema.TaggedError<KeyRateLimited>()(
  'KeyRateLimited',
  { retryAfterSeconds: Schema.Number },
  { httpApiStatus: 429 },
) {}

export class KeyLimitReached extends Schema.TaggedError<KeyLimitReached>()(
  'KeyLimitReached',
  {},
  { httpApiStatus: 409 },
) {}

export class KeyIssuanceConflict extends Schema.TaggedError<KeyIssuanceConflict>()(
  'KeyIssuanceConflict',
  { keyId: Schema.String },
  { httpApiStatus: 409 },
) {}

export const KeyErrors = [
  InvalidKeyCredential,
  KeyAccessDenied,
  KeyStoreUnavailable,
  KeyRateLimited,
]

export const KeyMetadata = Schema.Struct({
  id: Schema.String,
  ownerUserId: Schema.String,
  name: Schema.String,
  environment: KeyEnvironment,
  scopes: KeyScopes,
  displayPrefix: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  lastUsedAt: Schema.NullOr(Schema.String),
})

export const IssueKeyInput = Schema.Struct({
  requestId: Schema.String.pipe(
    Schema.check(
      Schema.isPattern(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    ),
  ),
  name: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter(
        (name) =>
          name.length >= 1 &&
          name.length <= 80 &&
          name
            .split('')
            .every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
      ),
    ),
  ),
  scopes: KeyScopes,
  expiresInSeconds: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 3600, maximum: 7776000 })),
    ),
  ),
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export type IssueKeyInput = typeof IssueKeyInput.Type

const PageInteger = Schema.NumberFromString.pipe(Schema.check(Schema.isInt()))

export const PersonalAccessKeyGroup = HttpApiGroup.make('personalAccessKeys')
  .add(
    HttpApiEndpoint.post('issueKey', '/api/user/api-keys', {
      payload: IssueKeyInput,
      success: Schema.Struct({ key: KeyMetadata, secret: Schema.String }).annotate({
        httpApiStatus: 201,
      }),
      error: [
        KeyInputInvalid,
        KeyAccessDenied,
        KeyLimitReached,
        KeyIssuanceConflict,
        KeyStoreUnavailable,
      ],
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.get('listKeys', '/api/user/api-keys', {
      query: {
        limit: Schema.optional(
          PageInteger.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
        ),
        offset: Schema.optional(PageInteger.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
      },
      success: Schema.Struct({
        data: Schema.Array(KeyMetadata),
        pagination: Schema.Struct({
          total: Schema.Number,
          limit: Schema.Number,
          offset: Schema.Number,
          hasMore: Schema.Boolean,
        }),
      }),
      error: KeyStoreUnavailable,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.delete('revokeKey', '/api/user/api-keys/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: [KeyStoreUnavailable, HttpApiError.NotFound, KeyAccessDenied],
    }).middleware(AuthMiddleware),
  )
