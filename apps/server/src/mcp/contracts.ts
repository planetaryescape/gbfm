import { McpResourceUrl, PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Schema } from 'effect'

export class EditorialToolError extends Schema.TaggedError<
  EditorialToolError,
  { readonly brand: unique symbol }
>()('EditorialToolError', {
  code: Schema.Literals([
    'access_denied',
    'not_found',
    'unavailable',
    'conflict',
    'invalid_input',
    'expired',
  ]),
  message: Schema.String,
}) {}

const httpUrl = Schema.String.check(
  Schema.makeFilter((value) => {
    const url = URL.parse(value)

    return url !== null &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? undefined
      : 'Expected an HTTP URL without credentials'
  }),
)

export const EditorialFrontendUrl = httpUrl.pipe(Schema.brand('EditorialFrontendUrl'))

export const EditorialReviewUrl = httpUrl.pipe(Schema.brand('EditorialReviewUrl'))

export const EditorialEnvironment = Schema.NonEmptyString.pipe(Schema.brand('EditorialEnvironment'))

export const PostSlug = Schema.NonEmptyString.pipe(Schema.brand('EditorialPostSlug'))

export const PostKind = Schema.Literals(['post', 'micro'])

export const EndpointIdentity = Schema.Struct({
  environment: EditorialEnvironment,
  resourceUrl: McpResourceUrl,
  frontendUrl: EditorialFrontendUrl,
})

export const PostSummary = Schema.Struct({
  postId: PostId,
  slug: PostSlug,
  type: PostKind,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  updatedAt: Schema.String,
  version: PostVersion,
  reviewUrl: EditorialReviewUrl,
})

export const ListDraftsInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

export const ListDraftsResult = Schema.Struct({
  endpoint: EndpointIdentity,
  posts: Schema.Array(PostSummary),
  pagination: Schema.Struct({
    limit: Schema.Int,
    offset: Schema.Int,
    total: Schema.Int,
    hasMore: Schema.Boolean,
  }),
})

export const GetPostInput = Schema.Struct({
  postId: PostId,
})

export const GetPostResult = Schema.Struct({
  endpoint: EndpointIdentity,
  post: Schema.Struct({
    ...PostSummary.fields,
    content: Schema.NullOr(Schema.String),
    thumbnailUrl: Schema.NullOr(Schema.String),
    tags: Schema.Array(Schema.String),
    creatorIds: Schema.Array(UserId),
    createdAt: Schema.String,
  }),
})

const DraftTitle = Schema.NonEmptyString.check(
  Schema.isMaxLength(500),
  Schema.makeFilter((value) => value.trim().length > 0),
)

const DraftContent = Schema.String.check(Schema.isMaxLength(100_000))

const DraftDescription = Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))

export const CreateDraftInput = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID(4)),
  title: DraftTitle,
  content: DraftContent,
  description: Schema.optionalKey(DraftDescription),
})

export const UpdateDraftInput = Schema.Struct({
  requestId: CreateDraftInput.fields.requestId,
  postId: PostId,
  expectedVersion: PostVersion,
  title: Schema.optionalKey(DraftTitle),
  content: Schema.optionalKey(DraftContent),
  description: Schema.optionalKey(DraftDescription),
}).check(
  Schema.makeFilter(
    (input) =>
      input.title !== undefined || input.content !== undefined || input.description !== undefined,
  ),
)
