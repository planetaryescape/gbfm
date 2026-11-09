import {
  MembershipMutationInput,
  MembershipMutationResult,
  MembershipRevision,
  MembershipTargetId,
  MembershipTargetKind,
} from '@gbfm/api/favorites'
import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'

export const ListOwnedInput = Schema.Struct({
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

export const SavedItemSummary = Schema.Struct({
  id: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  title: Schema.String.check(Schema.isMaxLength(500)),
  slug: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
})

export const SetFavoriteInput = Schema.Struct({
  ...MembershipMutationInput.fields,
  targetKind: MembershipTargetKind,
  targetId: MembershipTargetId,
  desiredState: Schema.Boolean,
})

export const SetShowSubscriptionInput = Schema.Struct({
  ...MembershipMutationInput.fields,
  showId: MembershipTargetId,
  desiredState: Schema.Boolean,
})

export const SetMembershipResult = Schema.Struct({
  endpoint: EndpointIdentity,
  ...MembershipMutationResult.fields,
})

const Pagination = Schema.Struct({
  limit: Schema.Int,
  offset: Schema.Int,
  hasMore: Schema.Boolean,
  omitted: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
})

export const ListFavoritesResult = Schema.Struct({
  endpoint: EndpointIdentity,
  revision: MembershipRevision,
  favorites: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(['mix', 'track', 'misc', 'show']),
      target: SavedItemSummary,
    }),
  ).check(Schema.isMaxLength(50)),
  pagination: Pagination,
})

export const ListShowSubscriptionsResult = Schema.Struct({
  endpoint: EndpointIdentity,
  revision: MembershipRevision,
  subscriptions: Schema.Array(Schema.Struct({ show: SavedItemSummary })).check(
    Schema.isMaxLength(50),
  ),
  pagination: Pagination,
})
