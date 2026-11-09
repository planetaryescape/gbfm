import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError, McpToolError } from '../contracts'
import {
  ListFavoritesResult,
  ListOwnedInput,
  ListShowSubscriptionsResult,
  SetFavoriteInput,
  SetMembershipResult,
  SetShowSubscriptionInput,
} from './contracts'
import { FavoritesMcpService } from './service'

const Failure = Schema.Union([EditorialToolError, McpToolError])

export const FavoritesToolkit = Toolkit.make(
  Tool.make('list_favorites', {
    description:
      'List your own favorites: public mixes, tracks, miscellaneous audio and shows only. Requires favorites:read. Read only; default 20, maximum 50. Private references do not grant visibility. No content bodies, media URLs or other owners’ records. Long titles are truncated; invalid public summaries are counted in pagination.omitted. Advance offset by limit, not returned count, while hasMore is true.',
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
      'List your own subscriptions to public shows. Requires subscriptions:read. Read only; default 20, maximum 50. Does not subscribe, queue or send notifications. No subscriber identities, private shows or content bodies. Long titles are truncated; invalid public summaries are counted in pagination.omitted. Advance offset by limit, not returned count, while hasMore is true.',
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
  Tool.make('set_favorite', {
    description:
      'Set your own favorite on a public audio item or show. Requires favorites:write; show targets also require subscriptions:write because both memberships change together. Supply the owner revision observed in a list/state result and a fresh UUIDv4 requestId. Retry uncertain results only with identical input and requestId. Conflicts require reviewing fresh state and explicit new intent, never automatic retry. No notifications are sent. A replay returns the original committed result, not current state.',
    parameters: SetFavoriteInput,
    success: SetMembershipResult,
    failure: Failure,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['favorites:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('set_show_subscription', {
    description:
      'Set your own subscription to a public show. Requires subscriptions:write; subscribing also requires favorites:write because it adds the show favorite. Unsubscribing retains the favorite. Supply the observed owner revision and a fresh UUIDv4 requestId. Retry uncertain results only with identical input and key. On conflict review fresh state before explicit new intent. No notifications or provider jobs are sent. Replays return the original committed result.',
    parameters: SetShowSubscriptionInput,
    success: SetMembershipResult,
    failure: Failure,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['subscriptions:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
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
      set_favorite: service.setFavorite,
      set_show_subscription: service.setShowSubscription,
    }
  }),
)
