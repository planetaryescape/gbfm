import { RichContentDocument } from '@gbfm/rich-content/schema'
import { SiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from 'effect/http-api'

import { AudioPagePrincipal, AudioResponse } from './audio'
import { MembershipMutationInput, MembershipMutationResult } from './favorites'
import { AuthMiddleware } from './middleware/auth'
import { ValidationHttpError } from './post'

const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Uuid = Schema.String.pipe(Schema.check(Schema.isPattern(UuidPattern)))

const ShowHost = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  username: Schema.optional(Schema.NullOr(Schema.String)),
})

const ShowResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  thumbnailUrl: Schema.NullOr(Schema.String),
  bannerImageUrl: Schema.NullOr(Schema.String),
  slug: Schema.String,
  content: Schema.String,
  draft: Schema.Boolean,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

const ShowWithHostsResponse = Schema.Struct({
  ...ShowResponse.fields,
  hosts: Schema.Array(ShowHost),
})

const CompiledShowResponse = Schema.Struct({
  ...ShowResponse.fields,
  compiledContent: Schema.String,
  richContent: Schema.optional(RichContentDocument),
  hosts: Schema.optional(Schema.Array(ShowHost)),
})

const PaginationMeta = Schema.Struct({
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  hasMore: Schema.Boolean,
})

const PaginationQuery = {
  limit: Schema.optional(
    Schema.NumberFromString.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  ),
  offset: Schema.optional(
    Schema.NumberFromString.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
}

export const GetAllShowsResponse = Schema.Struct({
  data: Schema.Array(ShowWithHostsResponse),
  pagination: PaginationMeta,
})

// Episodes include audio columns and the creators projected by getEpisodesEffect.
const EpisodeResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  thumbnailUrl: Schema.NullOr(Schema.String),
  bannerImageUrl: Schema.NullOr(Schema.String),
  slug: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  draft: Schema.Boolean,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  content: Schema.String,
  type: Schema.Literals(['mix', 'track', 'misc']),
  url: Schema.String,
  showId: Schema.NullOr(Schema.String),
  episodeNumber: Schema.NullOr(Schema.Number),
  playCount: Schema.Number,
  creators: AudioResponse.fields.creators,
  artists: AudioResponse.fields.artists,
})

export const GetShowEpisodesResponse = Schema.Struct({
  data: Schema.Array(EpisodeResponse),
  pagination: PaginationMeta,
})

export const ShowPageResponse = Schema.TaggedUnion({
  Ready: {
    principal: Schema.NullOr(AudioPagePrincipal),
    show: CompiledShowResponse,
    shows: Schema.Array(ShowWithHostsResponse),
    episodes: Schema.NullOr(GetShowEpisodesResponse),
    metadata: Schema.NullOr(SiteMetadata),
    subscription: Schema.Literals(['anonymous', 'active', 'inactive', 'unavailable']),
  },
  NotFound: { principal: Schema.NullOr(AudioPagePrincipal) },
  Unavailable: { principal: Schema.NullOr(AudioPagePrincipal) },
})

export type ShowPageResponse = typeof ShowPageResponse.Type

export const CreateShowInput = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  thumbnailUrl: Schema.optional(Schema.String),
  bannerImageUrl: Schema.optional(Schema.String),
  slug: Schema.NonEmptyString,
  content: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  // Old zod schema had .min(1) on hostIds, but the handler already treats
  // an empty array the same as omitted (falls back to [user.id] via
  // hostIds?.length ? hostIds : [user.id]), so the constraint was never
  // load-bearing -- not preserved here rather than reaching for a custom
  // Schema.check predicate for a no-op validation.
  hostIds: Schema.optional(Schema.Array(Schema.String)),
})

export type CreateShowInput = typeof CreateShowInput.Type

export const UpdateShowInput = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.String),
  thumbnailUrl: Schema.optional(Schema.String),
  bannerImageUrl: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.NonEmptyString),
  content: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  hostIds: Schema.optional(Schema.Array(Schema.String)),
})

export type UpdateShowInput = typeof UpdateShowInput.Type

export const ShowSubscriptionStatusResponse = Schema.Struct({ subscribed: Schema.Boolean })

export const QRPdfResponse = Schema.Struct({
  url: Schema.String,
  cached: Schema.Boolean,
})

export const ShowsGroup = /* @__PURE__ */ (() =>
  HttpApiGroup.make('shows')
    .add(
      HttpApiEndpoint.get('getShowPage', '/api/shows/:slug/page', {
        params: { slug: Schema.String },
        success: ShowPageResponse,
      }),
    )
    .add(
      HttpApiEndpoint.get('getAllShows', '/api/shows', {
        query: PaginationQuery,
        success: GetAllShowsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getShowsForEdit', '/api/shows/manage', {
        query: PaginationQuery,
        success: GetAllShowsResponse,
        error: [HttpApiError.Unauthorized, HttpApiError.InternalServerError],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getShowBySlug', '/api/shows/:slug', {
        params: { slug: Schema.String },
        success: CompiledShowResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getShowBySlugForEdit', '/api/shows/:slug/edit', {
        params: { slug: Schema.String },
        success: CompiledShowResponse,
        error: [HttpApiError.NotFound, HttpApiError.Unauthorized, HttpApiError.InternalServerError],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post('createShow', '/api/shows', {
        payload: CreateShowInput,
        success: ShowResponse,
        error: [
          HttpApiError.Forbidden,
          HttpApiError.Conflict,
          ValidationHttpError,
          HttpApiError.InternalServerError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.patch('updateShowBySlug', '/api/shows/:slug', {
        params: { slug: Schema.String },
        payload: UpdateShowInput,
        success: CompiledShowResponse,
        error: [
          HttpApiError.NotFound,
          HttpApiError.Unauthorized,
          ValidationHttpError,
          HttpApiError.InternalServerError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteShowBySlug', '/api/shows/:slug', {
        params: { slug: Schema.String },
        error: [HttpApiError.NotFound, HttpApiError.Unauthorized, HttpApiError.InternalServerError],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getShowEpisodes', '/api/shows/:slug/episodes', {
        params: { slug: Schema.String },
        query: PaginationQuery,
        success: GetShowEpisodesResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.post('subscribeToShow', '/api/shows/:id/subscribe', {
        params: { id: Uuid },
        payload: MembershipMutationInput,
        success: MembershipMutationResult,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.Forbidden,
          HttpApiError.Conflict,
          HttpApiError.Gone,
          HttpApiError.ServiceUnavailable,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('unsubscribeFromShow', '/api/shows/:id/unsubscribe', {
        params: { id: Uuid },
        payload: MembershipMutationInput,
        success: MembershipMutationResult,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.Forbidden,
          HttpApiError.Conflict,
          HttpApiError.Gone,
          HttpApiError.ServiceUnavailable,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getShowSubscriptionStatus', '/api/shows/:id/subscription', {
        params: { id: Uuid },
        success: ShowSubscriptionStatusResponse,
        error: [HttpApiError.Unauthorized, HttpApiError.InternalServerError],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getShowQRPdf', '/api/shows/:slug/qr-pdf', {
        params: { slug: Schema.String },
        success: QRPdfResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    ))()
