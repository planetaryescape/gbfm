import { UserId } from '@gbfm/core/identity'
import {
  KeyDisplayPrefix,
  KeyEnvironment,
  KeyId,
  KeyIssuanceId,
  KeyName,
  KeyScopes,
  KeyTimestamp,
} from '@gbfm/core/personal-access-keys'
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
  { keyId: KeyId },
  { httpApiStatus: 409 },
) {}

export const KeyErrors = [
  InvalidKeyCredential,
  KeyAccessDenied,
  KeyStoreUnavailable,
  KeyRateLimited,
]

export const KeyMetadata = Schema.Struct({
  id: KeyId,
  ownerUserId: UserId,
  name: KeyName,
  environment: KeyEnvironment,
  scopes: KeyScopes,
  displayPrefix: KeyDisplayPrefix,
  createdAt: KeyTimestamp,
  expiresAt: KeyTimestamp,
  revokedAt: Schema.NullOr(KeyTimestamp),
  lastUsedAt: Schema.NullOr(KeyTimestamp),
})

export const IssueKeyInput = Schema.Struct({
  requestId: KeyIssuanceId,
  name: KeyName,
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
      params: { id: KeyId },
      success: HttpApiSchema.NoContent,
      error: [KeyStoreUnavailable, HttpApiError.NotFound, KeyAccessDenied],
    }).middleware(AuthMiddleware),
  )
