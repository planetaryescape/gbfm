import { Schema } from 'effect'

/** Opaque auth identities are non-empty, but are not necessarily UUIDs. */
export const UserId = Schema.String.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand('UserId'))

export type UserId = typeof UserId.Type

/** The opaque identity of an authenticated session. */
export const SessionId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand('SessionId'),
)

/** An email address supplied by the authentication provider. */
export const EmailAddress = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  Schema.brand('EmailAddress'),
)
