import { Context, Effect, Layer, Option, Schema } from 'effect'

import { FavoriteService } from '@/services/favorite.service'
import { ShowSubscriptionService } from '@/services/show-subscription.service'

import { McpAuthorization } from '../authorization'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import {
  ListFavoritesResult,
  ListOwnedInput,
  ListShowSubscriptionsResult,
  SavedItemSummary,
} from './contracts'

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Saved items are unavailable.' })

const invalidInput = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid pagination.' })

const projectSummary = (target: typeof SavedItemSummary.Type) =>
  Schema.decodeUnknownOption(SavedItemSummary)({
    id: target.id,
    title:
      target.title.length > 500
        ? `${target.title.slice(0, 499).replace(/[\uD800-\uDBFF]$/u, '')}…`
        : target.title,
    slug: target.slug,
  })

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

    const window = rows.slice(0, limit)

    const items = window.flatMap((row) => {
      const target = row.audio ?? row.show

      if (!target) return []
      const summary = projectSummary(target)

      return Option.isSome(summary)
        ? [{ kind: row.audio?.type ?? 'show', target: summary.value }]
        : []
    })

    return yield* Schema.decodeUnknownEffect(ListFavoritesResult)({
      endpoint,
      favorites: items,
      pagination: {
        limit,
        offset,
        hasMore: rows.length > limit,
        omitted: window.length - items.length,
      },
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

    const window = result.data.slice(0, limit)

    const items = window.flatMap(({ show }) => {
      const summary = projectSummary(show)

      return Option.isSome(summary) ? [{ show: summary.value }] : []
    })

    return yield* Schema.decodeUnknownEffect(ListShowSubscriptionsResult)({
      endpoint,
      subscriptions: items,
      pagination: {
        limit,
        offset,
        hasMore: result.data.length > limit,
        omitted: window.length - items.length,
      },
    }).pipe(Effect.mapError(unavailable))
  })

  return { listFavorites, listShowSubscriptions }
})

export class FavoritesMcpService extends Context.Service<
  FavoritesMcpService,
  Effect.Success<typeof make>
>()('gbfm/mcp/Favorites') {}

export const FavoritesMcpServiceLayer = Layer.effect(FavoritesMcpService, make)
