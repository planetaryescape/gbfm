import { Schema } from 'effect'

export const SearchOrigin = Schema.String.check(
  Schema.makeFilter((value) => {
    const url = URL.parse(value)

    return url !== null && ['https:', 'http:'].includes(url.protocol) && value === url.origin
  }),
)

export const SearchQueryScope = Schema.Struct({
  realm: Schema.NonEmptyString,
  principalId: Schema.NullOr(Schema.String),
  known: Schema.Boolean,
  epoch: Schema.Number,
  origin: SearchOrigin,
})

export type SearchQueryScope = typeof SearchQueryScope.Type

export const searchScopeKey = (scope: SearchQueryScope) =>
  JSON.stringify([scope.realm, scope.principalId, scope.known, scope.epoch, scope.origin])
