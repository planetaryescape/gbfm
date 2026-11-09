import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from 'effect/http-api'

import { AuthMiddleware } from './middleware/auth'

const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Uuid = Schema.String.pipe(Schema.check(Schema.isPattern(UuidPattern)))

export const MembershipRevision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)

export const MembershipTargetKind = Schema.Literals(['audio', 'show'])

export const MembershipTargetId = Schema.NonEmptyString.check(Schema.isMaxLength(200))

export const MembershipStateResponse = Schema.Struct({
  revision: MembershipRevision,
  favorited: Schema.Boolean,
  subscribed: Schema.NullOr(Schema.Boolean),
})

export const MembershipMutationInput = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID(4)),
  expectedRevision: MembershipRevision,
})

export const MembershipMutationResult = Schema.Struct({
  requestId: MembershipMutationInput.fields.requestId,
  operationId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  targetKind: MembershipTargetKind,
  targetId: MembershipTargetId,
  desiredState: Schema.Boolean,
  revision: MembershipRevision,
  notifications: Schema.Literal('not_sent'),
})

// Exactly-one-of audioId/showId is enforced in the handler, not the schema.
export const AddFavoriteInput = Schema.Struct({
  ...MembershipMutationInput.fields,
  audioId: Schema.optional(Uuid),
  showId: Schema.optional(Uuid),
})

export type AddFavoriteInput = typeof AddFavoriteInput.Type

// Mirrors FavoriteService's FavoriteWithContent, apps/server/src/services/favorite.service.ts.
const FavoriteAudio = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  type: Schema.Literals(['mix', 'track', 'misc']),
  url: Schema.String,
})

const FavoriteShow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
})

export const FavoriteWithContent = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  audioId: Schema.NullOr(Schema.String),
  showId: Schema.NullOr(Schema.String),
  membershipRevision: MembershipRevision,
  createdAt: Schema.String,
  audio: Schema.NullOr(FavoriteAudio),
  show: Schema.NullOr(FavoriteShow),
})

export const GetFavoritesResponse = Schema.Struct({
  success: Schema.Boolean,
  favorites: Schema.Array(FavoriteWithContent),
  total: Schema.Number,
})

const GetFavoritesQuery = {
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
}

export const FavoritesGroup = /* @__PURE__ */ (() =>
  HttpApiGroup.make('favorites')
    .add(
      HttpApiEndpoint.get('getMembershipState', '/api/favorites/:targetKind/:targetId/state', {
        params: { targetKind: MembershipTargetKind, targetId: MembershipTargetId },
        success: MembershipStateResponse,
        error: HttpApiError.NotFound,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post('addFavorite', '/api/favorites', {
        payload: AddFavoriteInput,
        success: MembershipMutationResult,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          HttpApiError.Gone,
          HttpApiError.ServiceUnavailable,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('removeFavorite', '/api/favorites/:audioId', {
        params: { audioId: Uuid },
        payload: MembershipMutationInput,
        success: MembershipMutationResult,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          HttpApiError.Gone,
          HttpApiError.ServiceUnavailable,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('removeShowFavorite', '/api/favorites/show/:showId', {
        params: { showId: Uuid },
        payload: MembershipMutationInput,
        success: MembershipMutationResult,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          HttpApiError.Gone,
          HttpApiError.ServiceUnavailable,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getFavorites', '/api/favorites', {
        query: GetFavoritesQuery,
        success: GetFavoritesResponse,
      }).middleware(AuthMiddleware),
    ))()
