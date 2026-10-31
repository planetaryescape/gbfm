import type { KeyEnvironment, KeyScope } from '@gbfm/core/personal-access-keys'
import { Context, Data } from 'effect'
import { HttpApiError, HttpApiMiddleware } from 'effect/http-api'

import { KeyErrors } from '../personal-access-keys'

export interface ActorUser {
  readonly id: string
  readonly name: string | null | undefined
  readonly email: string
  readonly role?: string | null | undefined
}

export interface PersonalAccessKeyActor {
  readonly user: ActorUser
  readonly credential: {
    readonly _tag: 'PersonalAccessKey'
    readonly keyId: string
    readonly environment: KeyEnvironment
    readonly scopes: ReadonlyArray<KeyScope>
  }
}

export type Actor =
  | PersonalAccessKeyActor
  | {
      readonly user: ActorUser
      readonly credential: { readonly _tag: 'Session'; readonly sessionId: string }
    }

export const Credential = Data.taggedEnum<Actor['credential']>()

export class AuthenticatedActor extends Context.Service<AuthenticatedActor, Actor>()(
  'api/AuthenticatedActor',
) {}

export class ActorMiddleware extends HttpApiMiddleware.Service<
  ActorMiddleware,
  { provides: AuthenticatedActor }
>()('api/ActorMiddleware', { error: [HttpApiError.Unauthorized, ...KeyErrors] }) {}
