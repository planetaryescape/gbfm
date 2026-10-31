import { ActorMiddleware, AuthenticatedActor, Credential } from '@gbfm/api/middleware/actor'
import { InvalidKeyCredential } from '@gbfm/api/personal-access-keys'
import { Effect, Layer, Redacted } from 'effect'
import { HttpServerRequest } from 'effect/http'
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
          catch: () => new HttpApiError.Unauthorized(),
        })

        if (!session) return yield* new HttpApiError.Unauthorized()

        return yield* Effect.provideService(httpEffect, AuthenticatedActor, {
          user: session.user,
          credential: Credential.Session({ sessionId: session.session.id }),
        })
      })
  }),
)
