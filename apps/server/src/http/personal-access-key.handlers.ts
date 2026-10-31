import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { IssueKeyInput, KeyAccessDenied, KeyInputInvalid } from '@gbfm/api/personal-access-keys'
import { Clock, Effect, Redacted, Schema } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'

import { hasSessionCookie } from '@/http/personal-access-key-policy'
import { Auth } from '@/lib/auth'
import { browserOrigins } from '@/lib/browser-origins'
import { ConfigService } from '@/services/config.service'
import { PersonalAccessKeys } from '@/services/personal-access-keys'

const authorizeMutation = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const headers = new Headers(request.headers)
  const config = yield* ConfigService
  const origin = headers.get('origin')

  if (
    (origin && !browserOrigins(config.urls.frontend).includes(origin)) ||
    headers.get('sec-fetch-site') === 'cross-site' ||
    (!origin &&
      (hasSessionCookie(headers) || !/^Bearer /i.test(headers.get('authorization') ?? '')))
  )
    return yield* new KeyAccessDenied()

  return yield* Effect.void
})

export const PersonalAccessKeyHandlersLive = HttpApiBuilder.group(
  Api,
  'personalAccessKeys',
  (handlers) =>
    handlers
      .handle('issueKey', () =>
        Effect.gen(function* () {
          yield* authorizeMutation
          const request = yield* HttpServerRequest.HttpServerRequest

          const payload = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(IssueKeyInput, { onExcessProperty: 'error' }),
            ),
            Effect.mapError(() => new KeyInputInvalid()),
          )

          const auth = yield* Auth

          const session = yield* Effect.tryPromise({
            try: () => auth.api.getSession({ headers: new Headers(request.headers) }),
            catch: () => new KeyAccessDenied(),
          })

          const now = yield* Clock.currentTimeMillis

          if (
            !session ||
            session.session.impersonatedBy ||
            session.session.createdAt.getTime() > now ||
            now - session.session.createdAt.getTime() > 600000
          )
            return yield* new KeyAccessDenied()
          const keys = yield* PersonalAccessKeys
          const issued = yield* keys.issue(session.user.id, payload)

          return { key: issued.key, secret: Redacted.value(issued.secret) }
        }),
      )
      .handle('listKeys', ({ query }) =>
        Effect.gen(function* () {
          const { user } = yield* AuthSession
          const keys = yield* PersonalAccessKeys

          return yield* keys.list(user.id, query.limit ?? 20, query.offset ?? 0)
        }),
      )
      .handle('revokeKey', ({ params }) =>
        Effect.gen(function* () {
          yield* authorizeMutation
          const { user } = yield* AuthSession
          const keys = yield* PersonalAccessKeys

          return yield* keys.revoke(user.id, params.id)
        }),
      ),
)
