import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'

export const ListOwnedInput = Schema.Struct({
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

const Summary = Schema.Struct({
  id: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  title: Schema.String.check(Schema.isMaxLength(500)),
  slug: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
})

const Pagination = Schema.Struct({
  limit: Schema.Int,
  offset: Schema.Int,
  hasMore: Schema.Boolean,
})

export const ListFavoritesResult = Schema.Struct({
  endpoint: EndpointIdentity,
  favorites: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(['mix', 'track', 'misc', 'show']),
      target: Summary,
    }),
  ).check(Schema.isMaxLength(50)),
  pagination: Pagination,
})

export const ListShowSubscriptionsResult = Schema.Struct({
  endpoint: EndpointIdentity,
  subscriptions: Schema.Array(Schema.Struct({ show: Summary })).check(Schema.isMaxLength(50)),
  pagination: Pagination,
})
