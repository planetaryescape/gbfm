import { Schema } from 'effect'

const Credential = Schema.RedactedFromValue(Schema.NonEmptyString.check(Schema.isMaxLength(1024)))

export const EditorialTokenExchange = Schema.Union([
  Schema.Struct({ grant_type: Schema.Literal('authorization_code'), code: Credential }),
  Schema.Struct({ grant_type: Schema.Literal('refresh_token'), refresh_token: Credential }),
])

export const NativeOAuthRegistration = Schema.Struct({
  token_endpoint_auth_method: Schema.Literal('none'),
  application_type: Schema.optional(Schema.Literal('native')),
  redirect_uris: Schema.Array(Schema.NonEmptyString.check(Schema.isMaxLength(2048))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(5),
  ),
})

export const BoundedOAuthRegistrationPayload = Schema.Unknown.check(
  Schema.makeFilter((input) => {
    const serialized = JSON.stringify(input)

    return serialized !== undefined && serialized.length <= 8192
      ? undefined
      : 'Registration metadata exceeds the supported size'
  }),
)
