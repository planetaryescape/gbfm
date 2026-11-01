import { KeyEnvironment, KeyId, KeyScopes } from '@gbfm/core/personal-access-keys'
import { Role } from '@gbfm/core/roles'
import { Context, Data, Schema } from 'effect'
import { HttpApiError, HttpApiMiddleware } from 'effect/http-api'

import { KeyErrors } from '../personal-access-keys'

/** Opaque auth identities are non-empty, but are not necessarily UUIDs. */
export const UserId = Schema.String.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand('UserId'))

export const SessionId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand('SessionId'),
)

/** An email address supplied by the authentication provider. */
export const EmailAddress = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  Schema.brand('EmailAddress'),
)

/** The parsed user projection shared by session and personal-key actors. */
export const ActorUser = Schema.Struct({
  id: UserId,
  name: Schema.NullishOr(Schema.String),
  email: EmailAddress,
  role: Schema.optional(Schema.NullishOr(Role)),
})

export type ActorUser = typeof ActorUser.Type

/** A personal-key actor reconstructed from persisted credentials. */
export const PersonalAccessKeyActor = Schema.Struct({
  user: ActorUser,
  credential: Schema.Struct({
    _tag: Schema.Literal('PersonalAccessKey'),
    keyId: KeyId,
    environment: KeyEnvironment,
    scopes: KeyScopes,
  }),
})

export type PersonalAccessKeyActor = typeof PersonalAccessKeyActor.Type

/** Validated request identity; raw Better Auth and database records stay outside. */
export const Actor = Schema.Union([
  PersonalAccessKeyActor,
  Schema.Struct({
    user: ActorUser,
    credential: Schema.Struct({ _tag: Schema.Literal('Session'), sessionId: SessionId }),
  }),
])

export type Actor = typeof Actor.Type

export const Credential = Data.taggedEnum<Actor['credential']>()

export class AuthenticatedActor extends Context.Service<AuthenticatedActor, Actor>()(
  'api/AuthenticatedActor',
) {}

export class ActorMiddleware extends HttpApiMiddleware.Service<
  ActorMiddleware,
  { provides: AuthenticatedActor }
>()('api/ActorMiddleware', { error: [HttpApiError.Unauthorized, ...KeyErrors] }) {}
