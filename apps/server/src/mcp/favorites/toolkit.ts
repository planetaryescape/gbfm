import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError, McpToolError } from '../contracts'
import { ListFavoritesResult, ListOwnedInput, ListShowSubscriptionsResult } from './contracts'
import { FavoritesMcpService } from './service'

const Failure = Schema.Union([EditorialToolError, McpToolError])

export const FavoritesToolkit = Toolkit.make(
  Tool.make('list_favorites', {
    description:
      'List your own favorites: public mixes, tracks, miscellaneous audio and shows only. Requires favorites:read. Read only; default 20, maximum 50. Private references do not grant visibility. No content bodies, media URLs or other owners’ records.',
    parameters: ListOwnedInput,
    success: ListFavoritesResult,
    failure: Failure,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['favorites:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('list_show_subscriptions', {
    description:
      'List your own subscriptions to public shows. Requires subscriptions:read. Read only; default 20, maximum 50. Does not subscribe, queue or send notifications. No subscriber identities, private shows or content bodies.',
    parameters: ListOwnedInput,
    success: ListShowSubscriptionsResult,
    failure: Failure,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['subscriptions:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const FavoritesToolHandlersLayer = FavoritesToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* FavoritesMcpService

    return {
      list_favorites: service.listFavorites,
      list_show_subscriptions: service.listShowSubscriptions,
    }
  }),
)
