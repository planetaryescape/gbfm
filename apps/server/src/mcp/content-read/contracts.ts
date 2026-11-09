import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'

/** Public read paging: bounded independently of the authenticated account's role. */
export const ContentPageInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

/** Public metadata only; neither source bodies nor personalized creator fields. */
export const PublishedPost = Schema.Struct({
  postId: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  reviewUrl: Schema.String,
})

/** Pagination describes the existing public editorial source window, including blank rows. */
export const ContentPagination = Schema.Struct({
  limit: Schema.Int,
  offset: Schema.Int,
  total: Schema.Int,
  hasMore: Schema.Boolean,
})

/** Published editorial summaries, never hydrated embeds or private drafts. */
export const PublishedPostsResult = Schema.Struct({
  endpoint: EndpointIdentity,
  posts: Schema.Array(PublishedPost),
  pagination: ContentPagination,
})

/** Show lookup accepts a bounded public slug, never an actor or draft override. */
export const PublicShowInput = Schema.Struct({
  slug: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
})

/** Public show metadata without source, unsigned media or hydrated relationships. */
export const PublicShow = Schema.Struct({
  showId: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  reviewUrl: Schema.String,
})

/** A missing show and an unpublished show both fail with not_found. */
export const PublicShowResult = Schema.Struct({ endpoint: EndpointIdentity, show: PublicShow })

/** Paging applies only to published audio under a published show. */
export const ShowEpisodesInput = Schema.Struct({
  ...PublicShowInput.fields,
  ...ContentPageInput.fields,
})

/** Audio episode IDs are not music-track entity IDs. No playback is recorded by this read. */
export const ShowEpisodesResult = Schema.Struct({
  endpoint: EndpointIdentity,
  episodes: Schema.Array(
    Schema.Struct({
      audioId: Schema.NonEmptyString,
      type: Schema.Literals(['mix', 'track', 'misc']),
      slug: Schema.NonEmptyString,
      title: Schema.String,
      description: Schema.NullOr(Schema.String),
      createdAt: Schema.String,
      updatedAt: Schema.String,
      reviewUrl: Schema.String,
    }),
  ),
  pagination: ContentPagination,
})
