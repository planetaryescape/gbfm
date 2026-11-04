import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { UserId } from '@gbfm/core/identity'
import { Effect, Match, Schema } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { browserOrigins } from '@/lib/browser-origins'
import { ConfigService } from '@/services/config.service'
import {
  EditorialOAuth,
  type EditorialOAuthForbidden,
  type EditorialOAuthUnavailable,
} from '@/services/editorial-oauth.service'

const managementFailure = Match.type<EditorialOAuthForbidden | EditorialOAuthUnavailable>().pipe(
  Match.tag('EditorialOAuthForbidden', () => new HttpApiError.Forbidden()),
  Match.tag('EditorialOAuthUnavailable', () => new HttpApiError.ServiceUnavailable()),
  Match.exhaustive,
)

const sessionOwner = Effect.gen(function* () {
  const session = yield* AuthSession

  if (session.session.impersonatedBy) return yield* new HttpApiError.Forbidden()

  return yield* Schema.decodeUnknownEffect(UserId)(session.user.id).pipe(
    Effect.mapError(() => new HttpApiError.Forbidden()),
  )
})

export const McpConnectionsHandlersLive = HttpApiBuilder.group(Api, 'mcpConnections', (handlers) =>
  handlers
    .handle('listConnections', () =>
      Effect.gen(function* () {
        const owner = yield* sessionOwner
        const oauth = yield* EditorialOAuth

        const connections = yield* oauth
          .listConnections(owner)
          .pipe(Effect.mapError(managementFailure))

        return { connections }
      }),
    )
    .handle('revokeConnection', ({ params }) =>
      Effect.gen(function* () {
        const owner = yield* sessionOwner
        const request = yield* HttpServerRequest.HttpServerRequest
        const config = yield* ConfigService

        if (
          !browserOrigins(config.urls.frontend).includes(request.headers.origin ?? '') ||
          request.headers['sec-fetch-site'] === 'cross-site'
        )
          return yield* new HttpApiError.Forbidden()

        const oauth = yield* EditorialOAuth
        yield* oauth.disconnect(owner, params.clientId).pipe(Effect.mapError(managementFailure))

        return { success: true }
      }),
    ),
)
