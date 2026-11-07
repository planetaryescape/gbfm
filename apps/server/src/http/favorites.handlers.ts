import { Api } from '@gbfm/api/api'
import { MembershipStateResponse } from '@gbfm/api/favorites'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { Effect, Schema } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { dieOnDatabaseError as makeDieOnDatabaseError } from '@/http/handler-utils'
import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { membershipOutcome, membershipWriteContext } from '@/mcp/favorites/command'
import { membershipHttpError } from '@/mcp/favorites/http'
import { FavoriteService } from '@/services/favorite.service'

const dieOnDatabaseError = makeDieOnDatabaseError('favorites')

const toFavoriteResponse = (favorite: {
  id: string
  userId: string
  audioId: string | null
  showId: string | null
  membershipRevision: number
  createdAt: Date
  audio: {
    id: string
    title: string
    slug: string
    thumbnailUrl: string | null
    type: 'mix' | 'track' | 'misc'
    url: string
  } | null
  show: { id: string; title: string; slug: string; thumbnailUrl: string | null } | null
}) => ({
  ...favorite,
  createdAt: favorite.createdAt.toISOString(),
})

export const FavoritesHandlersLive = HttpApiBuilder.group(Api, 'favorites', (handlers) =>
  handlers
    .handle('getMembershipState', ({ params }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* FavoriteService

        const state = yield* dieOnDatabaseError(
          svc
            .getMembershipState(user.id, params.targetKind, params.targetId)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const encoded = yield* Schema.encodeEffect(MembershipStateResponse)(state).pipe(
          Effect.orDie,
        )

        return (yield* HttpServerResponse.json(encoded).pipe(Effect.orDie)).pipe(
          HttpServerResponse.setHeader('Cache-Control', 'private, no-store'),
          HttpServerResponse.setHeader('Vary', 'Cookie, Authorization'),
        )
      }),
    )
    .handle('addFavorite', ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* FavoriteService

        if (Boolean(payload.audioId) === Boolean(payload.showId))
          return yield* new HttpApiError.BadRequest()
        const authority = yield* makeSessionCommandAuthority

        const context = yield* membershipWriteContext(
          authority,
          payload.showId ? ['favorites:write', 'subscriptions:write'] : ['favorites:write'],
          payload,
        )

        const result = payload.audioId
          ? yield* svc.addFavorite(context, payload.audioId)
          : payload.showId
            ? yield* svc.addShowFavorite(context, payload.showId)
            : yield* new HttpApiError.BadRequest()

        return yield* membershipOutcome(result)
      }).pipe(Effect.catchTag('McpToolError', membershipHttpError)),
    )
    .handle('removeFavorite', ({ params, payload }) =>
      Effect.gen(function* () {
        const svc = yield* FavoriteService
        const authority = yield* makeSessionCommandAuthority
        const context = yield* membershipWriteContext(authority, ['favorites:write'], payload)

        return yield* membershipOutcome(yield* svc.removeFavorite(context, params.audioId))
      }).pipe(Effect.catchTag('McpToolError', membershipHttpError)),
    )
    .handle('removeShowFavorite', ({ params, payload }) =>
      Effect.gen(function* () {
        const svc = yield* FavoriteService
        const authority = yield* makeSessionCommandAuthority

        const context = yield* membershipWriteContext(
          authority,
          ['favorites:write', 'subscriptions:write'],
          payload,
        )

        return yield* membershipOutcome(yield* svc.removeShowFavorite(context, params.showId))
      }).pipe(Effect.catchTag('McpToolError', membershipHttpError)),
    )
    .handle('getFavorites', ({ query }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* FavoriteService

        const favorites = yield* dieOnDatabaseError(
          svc.getFavorites(user.id, query.limit, query.offset),
        )

        return {
          success: true,
          favorites: favorites.map(toFavoriteResponse),
          total: favorites.length,
        }
      }),
    ),
)
