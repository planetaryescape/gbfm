import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from 'effect/http-api'

import { MusicServiceUnavailableHttpError } from './errors'
import { ActorMiddleware } from './middleware/actor'
import { AuthMiddleware } from './middleware/auth'
import { KeyAccessDenied, KeyInputInvalid } from './personal-access-keys'

const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Uuid = Schema.String.pipe(Schema.check(Schema.isPattern(UuidPattern)))

// effect@4.0.0-beta.93's HttpApiError has no built-in 422 -- the old routes
// declared UNPROCESSABLE_ENTITY for post/audio validation failures
// (PostService.create/.update's ValidationError, mapped by the old
// effect-hono.ts mapErrors), so it's declared here the same way admin.ts
// declares a custom 429.
export class ValidationHttpError extends Schema.TaggedError<ValidationHttpError>()(
  'ValidationHttpError',
  {},
  { httpApiStatus: 422 },
) {}

const PostType = Schema.Literals(['post', 'micro'])

const MusicEntityType = Schema.Literals(['album', 'track', 'playlist'])

export const ResolvePostMusicResponse = Schema.Struct({
  updatedAt: Schema.optional(Schema.String),
  postId: Schema.String,
  entityType: MusicEntityType,
  entityId: Schema.String,
  url: Schema.String,
  title: Schema.String,
  artistNames: Schema.Array(Schema.String),
  coverImageUrl: Schema.NullOr(Schema.String),
})

export class PostMusicResolutionError extends Schema.TaggedError<PostMusicResolutionError>()(
  'PostMusicResolutionError',
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

const Creator = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  username: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
})

const BlueskySource = Schema.Struct({
  authorDid: Schema.String,
  authorHandle: Schema.NullOr(Schema.String),
  publicUrl: Schema.String,
  sourceCreatedAt: Schema.String,
  sourceStatus: Schema.String,
  locallyEdited: Schema.Boolean,
  lastError: Schema.NullOr(Schema.String),
})

export const PostResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  thumbnailUrl: Schema.NullOr(Schema.String),
  slug: Schema.String,
  content: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  type: Schema.NullOr(PostType),
  musicEntityType: Schema.NullOr(Schema.String),
  musicEntityId: Schema.NullOr(Schema.String),
  parentPostId: Schema.NullOr(Schema.String),
  rootPostId: Schema.NullOr(Schema.String),
  depth: Schema.Number,
  quotedPostId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  blueskySource: Schema.optional(BlueskySource),
})

export const CompiledPostResponse = Schema.Struct({
  ...PostResponse.fields,
  compiledContent: Schema.String,
  richContent: Schema.optional(RichContentDocument),
  creators: Schema.optional(Schema.Array(Creator)),
  replyCount: Schema.optional(Schema.Number),
})

export const CompiledEditorialPostResponse = Schema.Struct({
  ...CompiledPostResponse.fields,
  title: Schema.String,
  content: Schema.String,
  type: Schema.Literal('post'),
})

export const CompiledMicroPostResponse = Schema.Struct({
  ...CompiledPostResponse.fields,
  type: Schema.Literal('micro'),
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

export const GetPostsQuery = {
  ...PaginationQuery,
  type: Schema.optional(PostType),
}

export const PostSourceFilter = Schema.Literals(['bluesky', 'native'])

export const ManagePostsQuery = {
  ...GetPostsQuery,
  source: Schema.optional(PostSourceFilter),
  status: Schema.optional(Schema.Literals(['draft', 'live'])),
  q: Schema.optional(Schema.String),
}

export const GetPostsResponse = Schema.Struct({
  data: Schema.Array(CompiledPostResponse),
  pagination: PaginationMeta,
})

export const GetEditorialPostsQuery = {
  ...PaginationQuery,
  tag: Schema.optional(Schema.String),
}

export const GetEditorialPostsResponse = Schema.Struct({
  data: Schema.Array(CompiledEditorialPostResponse),
  pagination: PaginationMeta,
})

export const EditorialPostSummary = Schema.Struct({
  id: PostResponse.fields.id,
  slug: PostResponse.fields.slug,
  title: Schema.String,
  thumbnailUrl: PostResponse.fields.thumbnailUrl,
  description: PostResponse.fields.description,
  createdAt: PostResponse.fields.createdAt,
  updatedAt: PostResponse.fields.updatedAt,
  creators: Schema.Array(Creator),
  tags: PostResponse.fields.tags,
  draft: Schema.optional(Schema.Boolean),
})

export const GetEditorialSummariesResponse = Schema.Struct({
  data: Schema.Array(EditorialPostSummary),
  pagination: PaginationMeta,
})

export const GetMicroPostsResponse = Schema.Struct({
  data: Schema.Array(CompiledMicroPostResponse),
  pagination: PaginationMeta,
})

export const LatestMicroPostResponse = Schema.NullOr(Schema.Struct({ slug: Schema.String }))

export const GetPostsByTagResponse = Schema.Struct({
  data: Schema.Array(PostResponse),
  pagination: PaginationMeta,
})

export const GetPostTagsResponse = Schema.Array(Schema.String)

export const GetEditorialTagsResponse = Schema.Array(Schema.String)

export const GetMicroTagsResponse = Schema.Array(Schema.String)

export const GetMicroPostsQuery = {
  ...PaginationQuery,
  tag: Schema.optional(Schema.String),
  musicEntityType: Schema.optional(MusicEntityType),
  musicEntityId: Schema.optional(Uuid),
}

const MicroPostSummary = Schema.Struct({
  slug: Schema.String,
  title: Schema.NullOr(Schema.String),
})

export const GetAdjacentMicroPostsResponse = Schema.Struct({
  prev: Schema.NullOr(MicroPostSummary),
  next: Schema.NullOr(MicroPostSummary),
})

export const GetRandomMicroPostResponse = Schema.Struct({
  slug: Schema.String,
})

const SearchMicroPostsQuery = {
  ...PaginationQuery,
  q: Schema.NonEmptyString,
}

const insertPostFields = {
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.String),
  thumbnailUrl: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.NonEmptyString),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  draft: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  type: Schema.optional(Schema.NullOr(PostType)),
  musicEntityType: Schema.optional(Schema.NullOr(MusicEntityType)),
  musicEntityId: Schema.optional(Schema.NullOr(Uuid)),
}

const quotedPostIdField = {
  quotedPostId: Schema.optional(Schema.NullOr(Uuid)),
}

export const CreatePostInput = Schema.Struct({
  ...insertPostFields,
  ...quotedPostIdField,
  // Old zod schema had .min(1) on creatorIds, but the handler already
  // treats an empty array the same as omitted (falls back to [user.id]),
  // same no-op pattern established for shows/label.
  creatorIds: Schema.optional(Schema.Array(Schema.String)),
})

export type CreatePostInput = typeof CreatePostInput.Type

export const UpdatePostInput = Schema.Struct({
  expectedUpdatedAt: Schema.optional(Schema.DateFromString),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.String),
  thumbnailUrl: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.NonEmptyString),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  draft: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  type: Schema.optional(Schema.NullOr(PostType)),
  musicEntityType: Schema.optional(Schema.NullOr(MusicEntityType)),
  musicEntityId: Schema.optional(Schema.NullOr(Uuid)),
  creatorIds: Schema.optional(Schema.Array(Schema.String)),
})

export type UpdatePostInput = typeof UpdatePostInput.Type

const TagParam = { tag: Schema.NonEmptyString }

const SlugParam = { slug: Schema.String }

const ParentSlugParam = { parentSlug: Schema.String }

const IdParam = { id: Uuid }

export const CreateMicroPostReplyInput = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  musicEntityType: Schema.optional(Schema.NullOr(MusicEntityType)),
  musicEntityId: Schema.optional(Schema.NullOr(Uuid)),
  ...quotedPostIdField,
})

export type CreateMicroPostReplyInput = typeof CreateMicroPostReplyInput.Type

export const MicroPostThreadResponse = Schema.Struct({
  root: CompiledMicroPostResponse,
  focus: CompiledMicroPostResponse,
  posts: Schema.Array(CompiledMicroPostResponse),
  pagination: PaginationMeta,
})

const MicroPostScreenMusic = Schema.Struct({
  entity: Schema.Struct({
    id: Schema.String,
    type: MusicEntityType,
    title: Schema.String,
    artistNames: Schema.NullOr(Schema.Array(Schema.String)),
    coverImageUrl: Schema.NullOr(Schema.String),
  }),
  links: Schema.Array(
    Schema.Struct({
      platform: Schema.String,
      url: Schema.String,
    }),
  ),
})

const MicroPostScreenPost = Schema.Struct({
  ...CompiledMicroPostResponse.fields,
  music: Schema.NullOr(MicroPostScreenMusic),
})

export const MicroPostScreenResponse = Schema.Struct({
  post: MicroPostScreenPost,
  replies: Schema.Array(MicroPostScreenPost),
  root: MicroPostScreenPost,
  quote: Schema.NullOr(MicroPostScreenPost),
})

export const MicroPostScreenRepliesResponse = Schema.Array(MicroPostScreenPost)

/** `music` is optional so clients keep decoding feeds from servers that predate it. */
const MicroPostListPost = Schema.Struct({
  ...CompiledMicroPostResponse.fields,
  music: Schema.optional(Schema.NullOr(MicroPostScreenMusic)),
})

export const GetMicroPostListResponse = Schema.Struct({
  data: Schema.Array(MicroPostListPost),
  pagination: PaginationMeta,
})

export type MicroPostListPost = typeof MicroPostListPost.Type

export type MicroPostScreenResponse = typeof MicroPostScreenResponse.Type

export type MicroPostScreenPost = typeof MicroPostScreenPost.Type

export type MicroPostScreenMusic = typeof MicroPostScreenMusic.Type

export type PostCreator = typeof Creator.Type

/** Draft source rendered exactly as publishing would, so creators preview resolved embeds. */
export const PreviewPostContentInput = Schema.Struct({
  content: Schema.String.pipe(Schema.check(Schema.isMaxLength(100 * 1024))),
})

export const PreviewPostContentResponse = Schema.Struct({ richContent: RichContentDocument })

export const PostGroup = /* @__PURE__ */ (() =>
  HttpApiGroup.make('post')
    .add(
      HttpApiEndpoint.get('getPosts', '/api/content/posts', {
        query: GetPostsQuery,
        success: GetPostsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getPostsForEdit', '/api/content/posts/manage', {
        query: ManagePostsQuery,
        success: GetPostsResponse,
        error: [HttpApiError.Unauthorized, HttpApiError.InternalServerError, KeyAccessDenied],
      }).middleware(ActorMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getPostTags', '/api/content/posts/tags', {
        success: GetPostTagsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getEditorialTags', '/api/content/posts/editorials/tags', {
        success: GetEditorialTagsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getEditorialPosts', '/api/content/posts/editorials', {
        query: GetEditorialPostsQuery,
        success: GetEditorialPostsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getEditorialSummaries', '/api/content/editorial-summaries', {
        query: GetEditorialPostsQuery,
        success: GetEditorialSummariesResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getEditorialPostBySlug', '/api/content/posts/editorials/:slug', {
        params: SlugParam,
        success: CompiledEditorialPostResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getMicroPosts', '/api/content/posts/micro', {
        query: GetMicroPostsQuery,
        success: GetMicroPostListResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getLatestMicroPost', '/api/content/posts/micro/latest', {
        success: LatestMicroPostResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getMicroTags', '/api/content/posts/micro/tags', {
        success: GetMicroTagsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('searchMicroPosts', '/api/content/posts/micro/search', {
        query: SearchMicroPostsQuery,
        success: GetMicroPostsResponse,
        error: HttpApiError.InternalServerError,
      }),
    )
    .add(
      HttpApiEndpoint.get('getMicroPostById', '/api/content/posts/micro/by-id/:id', {
        params: IdParam,
        success: CompiledMicroPostResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getMicroPostBySlug', '/api/content/posts/micro/:slug', {
        params: SlugParam,
        success: CompiledMicroPostResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getMicroPostScreen', '/api/content/posts/micro/:slug/screen', {
        params: SlugParam,
        query: { part: Schema.optional(Schema.Literal('main')) },
        success: MicroPostScreenResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get(
        'getMicroPostScreenReplies',
        '/api/content/posts/micro/:slug/screen/replies',
        {
          params: SlugParam,
          success: MicroPostScreenRepliesResponse,
          error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
        },
      ),
    )
    .add(
      HttpApiEndpoint.post('createMicroPostReply', '/api/content/posts/micro/:parentSlug/replies', {
        params: ParentSlugParam,
        payload: CreateMicroPostReplyInput,
        success: CompiledMicroPostResponse,
        error: [
          ValidationHttpError,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.InternalServerError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getMicroPostReplies', '/api/content/posts/micro/:parentSlug/replies', {
        params: ParentSlugParam,
        query: PaginationQuery,
        success: GetMicroPostsResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getMicroPostThread', '/api/content/posts/micro/:slug/thread', {
        params: SlugParam,
        query: PaginationQuery,
        success: MicroPostThreadResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getPostBySlug', '/api/content/posts/:slug', {
        params: SlugParam,
        success: CompiledPostResponse,
        error: [HttpApiError.NotFound, HttpApiError.InternalServerError],
      }),
    )
    .add(
      HttpApiEndpoint.get('getPostBySlugForEdit', '/api/content/posts/:slug/edit', {
        params: SlugParam,
        success: CompiledPostResponse,
        error: [
          HttpApiError.NotFound,
          HttpApiError.Unauthorized,
          HttpApiError.InternalServerError,
          KeyAccessDenied,
        ],
      }).middleware(ActorMiddleware),
    )
    .add(
      HttpApiEndpoint.post('previewPostContent', '/api/content/posts/preview', {
        payload: PreviewPostContentInput,
        success: PreviewPostContentResponse,
        error: [HttpApiError.Forbidden, KeyAccessDenied],
      }).middleware(ActorMiddleware),
    )
    .add(
      HttpApiEndpoint.post('createPost', '/api/content/post', {
        payload: CreatePostInput,
        success: PostResponse,
        error: [
          KeyAccessDenied,
          KeyInputInvalid,
          ValidationHttpError,
          HttpApiError.Forbidden,
          HttpApiError.Conflict,
          HttpApiError.NotFound,
          HttpApiError.InternalServerError,
        ],
      }).middleware(ActorMiddleware),
    )
    .add(
      HttpApiEndpoint.post('resolvePostMusic', '/api/content/posts/:id/resolve-music-entity', {
        params: IdParam,
        payload: Schema.Struct({
          url: Schema.optional(Schema.String),
          expectedUpdatedAt: Schema.optional(Schema.DateFromString),
        }),
        success: ResolvePostMusicResponse,
        error: [
          PostMusicResolutionError,
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Unauthorized,
          HttpApiError.Forbidden,
          HttpApiError.Conflict,
          MusicServiceUnavailableHttpError,
          HttpApiError.InternalServerError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.patch('updatePostBySlug', '/api/content/posts/:slug', {
        params: SlugParam,
        payload: UpdatePostInput,
        success: CompiledPostResponse,
        error: [
          KeyAccessDenied,
          KeyInputInvalid,
          HttpApiError.Conflict,
          ValidationHttpError,
          HttpApiError.NotFound,
          HttpApiError.Unauthorized,
          HttpApiError.InternalServerError,
        ],
      }).middleware(ActorMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getPostsByTag', '/api/content/tag/:tag', {
        params: TagParam,
        query: PaginationQuery,
        success: GetPostsByTagResponse,
        error: HttpApiError.InternalServerError,
      }),
    ))()
