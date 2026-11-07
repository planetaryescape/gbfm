import { Context, Effect, Layer, Schema } from 'effect'

import { FavoriteService } from '@/services/favorite.service'
import { ShowSubscriptionService } from '@/services/show-subscription.service'

import { McpAuthorization } from '../authorization'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { ListFavoritesResult, ListOwnedInput, ListShowSubscriptionsResult } from './contracts'

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Saved items are unavailable.' })

const invalidInput = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid pagination.' })

const make = Effect.gen(function* () {
  const authorization = yield* McpAuthorization
  const favorites = yield* FavoriteService
  const subscriptions = yield* ShowSubscriptionService
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const listFavorites = Effect.fn('FavoritesMcp.listFavorites')(function* (
    input: typeof ListOwnedInput.Type,
  ) {
    const actor = yield* authorization.requireScopes(['favorites:read'])

    const page = yield* Schema.decodeUnknownEffect(ListOwnedInput, {
      onExcessProperty: 'error',
    })(input).pipe(Effect.mapError(invalidInput))

    const limit = page.limit ?? 20
    const offset = page.offset ?? 0

    const rows = yield* favorites
      .getFavorites(actor.userId, limit + 1, offset)
      .pipe(Effect.mapError(unavailable))

    return yield* Schema.decodeUnknownEffect(ListFavoritesResult)({
      endpoint,
      favorites: rows.slice(0, limit).map((row) => ({
        kind: row.audio?.type ?? 'show',
        target: row.audio
          ? { id: row.audio.id, title: row.audio.title, slug: row.audio.slug }
          : row.show
            ? { id: row.show.id, title: row.show.title, slug: row.show.slug }
            : null,
      })),
      pagination: { limit, offset, hasMore: rows.length > limit },
    }).pipe(Effect.mapError(unavailable))
  })

  const listShowSubscriptions = Effect.fn('FavoritesMcp.listShowSubscriptions')(function* (
    input: typeof ListOwnedInput.Type,
  ) {
    const actor = yield* authorization.requireScopes(['subscriptions:read'])

    const page = yield* Schema.decodeUnknownEffect(ListOwnedInput, {
      onExcessProperty: 'error',
    })(input).pipe(Effect.mapError(invalidInput))

    const limit = page.limit ?? 20
    const offset = page.offset ?? 0

    const result = yield* subscriptions
      .getUserSubscriptions(actor.userId, { limit: limit + 1, offset })
      .pipe(Effect.mapError(unavailable))

    return yield* Schema.decodeUnknownEffect(ListShowSubscriptionsResult)({
      endpoint,
      subscriptions: result.data.slice(0, limit).map(({ show }) => ({
        show: { id: show.id, title: show.title, slug: show.slug },
      })),
      pagination: { limit, offset, hasMore: result.data.length > limit },
    }).pipe(Effect.mapError(unavailable))
  })

  return { listFavorites, listShowSubscriptions }
})

export class FavoritesMcpService extends Context.Service<
  FavoritesMcpService,
  Effect.Success<typeof make>
>()('gbfm/mcp/Favorites') {}

export const FavoritesMcpServiceLayer = Layer.effect(FavoritesMcpService, make)
