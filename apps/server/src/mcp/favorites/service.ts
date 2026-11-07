import { Context, Effect, Layer, Option, Schema } from 'effect'

import { FavoriteService } from '@/services/favorite.service'
import { ShowSubscriptionService } from '@/services/show-subscription.service'

import { McpAuthorization } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { McpOperationStore } from '../operations/store'
import { membershipOutcome, membershipWriteContext } from './command'
import {
  ListFavoritesResult,
  ListOwnedInput,
  ListShowSubscriptionsResult,
  SavedItemSummary,
  SetFavoriteInput,
  SetMembershipResult,
  SetShowSubscriptionInput,
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
  const store = yield* McpOperationStore
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

    const result = yield* favorites
      .getMembershipPage(actor.userId, 'favorites', limit + 1, offset)
      .pipe(Effect.mapError(unavailable))

    const window = result.items.slice(0, limit)

    const items = window.flatMap((row) => {
      const summary = projectSummary(row)

      return Option.isSome(summary) ? [{ kind: row.kind, target: summary.value }] : []
    })

    return yield* Schema.decodeUnknownEffect(ListFavoritesResult)({
      endpoint,
      revision: result.revision,
      favorites: items,
      pagination: {
        limit,
        offset,
        hasMore: result.items.length > limit,
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

    const result = yield* favorites
      .getMembershipPage(actor.userId, 'subscriptions', limit + 1, offset)
      .pipe(Effect.mapError(unavailable))

    const window = result.items.slice(0, limit)

    const items = window.flatMap((row) => {
      const summary = projectSummary(row)

      return Option.isSome(summary) ? [{ show: summary.value }] : []
    })

    return yield* Schema.decodeUnknownEffect(ListShowSubscriptionsResult)({
      endpoint,
      revision: result.revision,
      subscriptions: items,
      pagination: {
        limit,
        offset,
        hasMore: result.items.length > limit,
        omitted: window.length - items.length,
      },
    }).pipe(Effect.mapError(unavailable))
  })

  const setFavorite = Effect.fn('FavoritesMcp.setFavorite')(
    function* (input: typeof SetFavoriteInput.Type) {
      const parsed = yield* Schema.decodeUnknownEffect(SetFavoriteInput, {
        onExcessProperty: 'error',
      })(input).pipe(Effect.mapError(invalidInput))

      const authority = yield* Effect.serviceOption(CommandAuthority)

      if (Option.isNone(authority))
        return yield* new McpToolError({ code: 'access_denied', message: 'Command access denied.' })

      const context = yield* membershipWriteContext(
        authority.value,
        parsed.targetKind === 'show'
          ? ['favorites:write', 'subscriptions:write']
          : ['favorites:write'],
        parsed,
      )

      const result =
        parsed.targetKind === 'audio'
          ? parsed.desiredState
            ? yield* favorites.addFavorite(context, parsed.targetId)
            : yield* favorites.removeFavorite(context, parsed.targetId)
          : parsed.desiredState
            ? yield* favorites.addShowFavorite(context, parsed.targetId)
            : yield* favorites.removeShowFavorite(context, parsed.targetId)

      return yield* Schema.decodeUnknownEffect(SetMembershipResult)({
        endpoint,
        ...(yield* membershipOutcome(result)),
      }).pipe(Effect.mapError(unavailable))
    },
    Effect.provideService(McpOperationStore, store),
  )

  const setShowSubscription = Effect.fn('FavoritesMcp.setShowSubscription')(
    function* (input: typeof SetShowSubscriptionInput.Type) {
      const parsed = yield* Schema.decodeUnknownEffect(SetShowSubscriptionInput, {
        onExcessProperty: 'error',
      })(input).pipe(Effect.mapError(invalidInput))

      const authority = yield* Effect.serviceOption(CommandAuthority)

      if (Option.isNone(authority))
        return yield* new McpToolError({ code: 'access_denied', message: 'Command access denied.' })

      const context = yield* membershipWriteContext(
        authority.value,
        parsed.desiredState ? ['subscriptions:write', 'favorites:write'] : ['subscriptions:write'],
        parsed,
      )

      const result = parsed.desiredState
        ? yield* subscriptions.subscribe(context, parsed.showId)
        : yield* subscriptions.unsubscribe(context, parsed.showId)

      return yield* Schema.decodeUnknownEffect(SetMembershipResult)({
        endpoint,
        ...(yield* membershipOutcome(result)),
      }).pipe(Effect.mapError(unavailable))
    },
    Effect.provideService(McpOperationStore, store),
  )

  return { listFavorites, listShowSubscriptions, setFavorite, setShowSubscription }
})

export class FavoritesMcpService extends Context.Service<
  FavoritesMcpService,
  Effect.Success<typeof make>
>()('gbfm/mcp/Favorites') {}

export const FavoritesMcpServiceLayer = Layer.effect(FavoritesMcpService, make)
