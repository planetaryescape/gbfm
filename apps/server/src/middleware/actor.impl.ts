import {
  ActorUser,
  ActorMiddleware,
  AuthenticatedActor,
  Credential,
} from '@gbfm/api/middleware/actor'
import { InvalidKeyCredential } from '@gbfm/api/personal-access-keys'
import { SessionId } from '@gbfm/core/identity'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApiError } from 'effect/http-api'

import { isPersonalKeyRequest, personalKeyToken } from '@/http/personal-access-key-policy'
import { Auth } from '@/lib/auth'
import { PersonalAccessKeys } from '@/services/personal-access-keys'

export const ActorMiddlewareLive = Layer.effect(
  ActorMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth
    const keys = yield* PersonalAccessKeys

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const headers = new Headers(request.headers)

        if (isPersonalKeyRequest(headers)) {
          const token = personalKeyToken(headers)

          if (!token) return yield* new InvalidKeyCredential()
          const actor = yield* keys.authenticate(Redacted.make(token))

          return yield* Effect.provideService(httpEffect, AuthenticatedActor, actor)
        }

        const session = yield* Effect.tryPromise({
          try: () => auth.api.getSession({ headers }),
          catch: () => new HttpApiError.InternalServerError(),
        }).pipe(
          Effect.tapError(() =>
            Effect.logError('auth.session_lookup_failed', {
              method: request.method,
              // Dependency errors may contain credentials; never record the raw cause or URL.
              credentialKind: 'session',
            }),
          ),
          Effect.orDie,
        )

        if (!session) return yield* new HttpApiError.Unauthorized()

        const user = yield* Schema.decodeUnknownEffect(ActorUser)(session.user).pipe(
          Effect.mapError(() => new HttpApiError.Unauthorized()),
        )

        const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(session.session.id).pipe(
          Effect.mapError(() => new HttpApiError.Unauthorized()),
        )

        return yield* Effect.provideService(httpEffect, AuthenticatedActor, {
          user,
          credential: Credential.Session({ sessionId }),
        })
      }).pipe(
        Effect.catchTag('KeyRateLimited', (error) =>
          HttpServerResponse.json(
            { _tag: error._tag, retryAfterSeconds: error.retryAfterSeconds },
            {
              status: 429,
              headers: { 'retry-after': String(error.retryAfterSeconds) },
            },
          ).pipe(Effect.orDie),
        ),
      )
  }),
)
