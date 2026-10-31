import { Api } from '@gbfm/api/api'
import { AuthenticatedActor } from '@gbfm/api/middleware/actor'
import { AuthSession } from '@gbfm/api/middleware/auth'
import {
  GetEditorialPostsResponse,
  GetEditorialSummariesResponse,
  CompiledEditorialPostResponse,
  GetEditorialTagsResponse,
  GetMicroTagsResponse,
  GetPostTagsResponse,
  PostMusicResolutionError,
  ValidationHttpError,
} from '@gbfm/api/post'
import { canCreatePosts } from '@gbfm/core/roles'
import { Effect, Predicate, Schema } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import {
  dieOnDatabaseError as makeDieOnDatabaseError,
  getOptionalActor,
} from '@/http/handler-utils'
import { requireKeyScope } from '@/lib/key-post-authorization'
import { omitUndefined } from '@/lib/omit-undefined'
import { resolvePostMusic } from '@/services/post-music-resolution'
import { PostService } from '@/services/post.service'

import { cachedEditorialList } from './editorial-list-cache'
import { mapMusicIdentityErrors } from './music-identity-http'

const dieOnDatabaseError = makeDieOnDatabaseError('post')

const toDateStrings = <
  T extends {
    createdAt: Date
    updatedAt: Date
    blueskySource?: {
      readonly authorDid: string
      readonly authorHandle: string | null
      readonly publicUrl: string
      readonly sourceCreatedAt: Date | string
      readonly sourceStatus: string
      readonly locallyEdited: boolean
      readonly lastError: string | null
    }
  },
>(
  post: T,
) => {
  const { blueskySource, ...rest } = post

  const response = {
    ...rest,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  }

  if (!blueskySource) return response

  return {
    ...response,
    blueskySource: {
      ...blueskySource,
      sourceCreatedAt:
        blueskySource.sourceCreatedAt instanceof Date
          ? blueskySource.sourceCreatedAt.toISOString()
          : blueskySource.sourceCreatedAt,
    },
  }
}

export const PostHandlersLive = HttpApiBuilder.group(Api, 'post', (handlers) =>
  handlers
    .handle('getPosts', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc.getAll(
            omitUndefined({
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
              type: query.type,
            }),
          ),
        )

        return {
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getPostsForEdit', ({ query }) =>
      Effect.gen(function* () {
        const actor = yield* AuthenticatedActor
        const { user } = actor
        yield* requireKeyScope(actor, ['posts:read'])
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc.getAllForEdit(
            omitUndefined({
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
              type: query.type,
              source: query.source,
              draft: query.status === undefined ? undefined : query.status === 'draft',
              q: query.q,
            }),
            user.id,
            user.role ?? 'user',
            Predicate.isTagged(actor.credential, 'PersonalAccessKey') ? 'owned' : 'role',
          ),
        )

        return { data: result.data.map(toDateStrings), pagination: result.pagination }
      }),
    )
    .handle('getPostTags', () =>
      Effect.gen(function* () {
        const svc = yield* PostService
        const tags = yield* dieOnDatabaseError(svc.getPostTags())
        const body = yield* Schema.encodeEffect(GetPostTagsResponse)(tags).pipe(Effect.orDie)

        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json(body).pipe(Effect.orDie),
          'Cache-Control',
          'public, max-age=3600, stale-while-revalidate=86400',
        )
      }),
    )
    .handle('getEditorialTags', () =>
      Effect.gen(function* () {
        const svc = yield* PostService
        const tags = yield* dieOnDatabaseError(svc.getEditorialTags())
        const body = yield* Schema.encodeEffect(GetEditorialTagsResponse)(tags).pipe(Effect.orDie)

        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json(body).pipe(Effect.orDie),
          'Cache-Control',
          'public, max-age=3600, stale-while-revalidate=86400',
        )
      }),
    )
    .handle('getEditorialPosts', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const options = omitUndefined({
          limit: query.limit ?? 20,
          offset: query.offset ?? 0,
          tag: query.tag,
        })

        const cached = yield* cachedEditorialList(
          options,
          dieOnDatabaseError(svc.getEditorials(options)).pipe(
            Effect.map((result) => ({
              data: result.data.map(toDateStrings),
              pagination: result.pagination,
            })),
          ),
        )

        const encoded = yield* Schema.encodeEffect(GetEditorialPostsResponse)(cached.body).pipe(
          Effect.orDie,
        )

        return (yield* HttpServerResponse.json(encoded).pipe(Effect.orDie)).pipe(
          HttpServerResponse.setHeader(
            'Cache-Control',
            'public, max-age=60, stale-while-revalidate=300',
          ),
          HttpServerResponse.setHeader('Age', String(cached.ageSeconds)),
        )
      }),
    )
    .handle('getEditorialSummaries', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService
        const actor = yield* getOptionalActor

        const result = yield* dieOnDatabaseError(
          svc.getEditorialSummaries(
            omitUndefined({
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
              tag: query.tag,
              readerId: actor?.userId,
            }),
          ),
        )

        const body = yield* Schema.encodeEffect(GetEditorialSummariesResponse)({
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }).pipe(Effect.orDie)

        return (yield* HttpServerResponse.json(body).pipe(Effect.orDie)).pipe(
          HttpServerResponse.setHeader('Cache-Control', 'private, no-store'),
          HttpServerResponse.setHeader('Vary', 'Cookie, Authorization'),
        )
      }),
    )
    .handle('getEditorialPostBySlug', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* PostService
        const actor = yield* getOptionalActor

        const post = yield* dieOnDatabaseError(
          svc
            .getEditorialBySlug(params.slug, actor?.userId)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const body = yield* Schema.encodeEffect(CompiledEditorialPostResponse)(
          toDateStrings(post),
        ).pipe(Effect.orDie)

        const response = (yield* HttpServerResponse.json(body).pipe(Effect.orDie)).pipe(
          HttpServerResponse.setHeader('Cache-Control', 'private, no-store'),
          HttpServerResponse.setHeader('Vary', 'Cookie, Authorization'),
        )

        return post.draft
          ? HttpServerResponse.setHeader(response, 'X-Robots-Tag', 'noindex, nofollow')
          : response
      }),
    )
    .handle('getMicroPosts', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc.getMicroPosts(
            omitUndefined({
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
              tag: query.tag,
              musicEntityType: query.musicEntityType,
              musicEntityId: query.musicEntityId,
            }),
          ),
        )

        const musicByPostId = yield* dieOnDatabaseError(svc.getMicroPostScreenMusic(result.data))

        return {
          data: result.data.map((post) => ({
            ...toDateStrings(post),
            music: musicByPostId.get(post.id) ?? null,
          })),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getLatestMicroPost', () =>
      Effect.gen(function* () {
        const svc = yield* PostService

        return yield* dieOnDatabaseError(svc.getLatestMicroPost)
      }),
    )
    .handle('getMicroTags', () =>
      Effect.gen(function* () {
        const svc = yield* PostService
        const tags = yield* dieOnDatabaseError(svc.getMicroTags())
        const body = yield* Schema.encodeEffect(GetMicroTagsResponse)(tags).pipe(Effect.orDie)

        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json(body).pipe(Effect.orDie),
          'Cache-Control',
          'public, max-age=3600, stale-while-revalidate=86400',
        )
      }),
    )
    .handle('searchMicroPosts', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc.searchMicroPosts({ q: query.q, limit: query.limit ?? 20, offset: query.offset ?? 0 }),
        )

        return {
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getMicroPostBySlug', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const post = yield* dieOnDatabaseError(
          svc
            .getMicroPostBySlug(params.slug)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toDateStrings(post)
      }),
    )
    .handle('getMicroPostScreen', ({ params, query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          Effect.all(
            {
              post: svc.getMicroPostBySlug(params.slug),
              replies:
                query.part === 'main'
                  ? Effect.succeed({ data: [] })
                  : svc.getMicroPostReplies(params.slug, { limit: 100, offset: 0 }),
            },
            { concurrency: 'unbounded' },
          ).pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const related = yield* dieOnDatabaseError(
          Effect.all(
            {
              root: result.post.rootPostId
                ? svc.getMicroPostById(result.post.rootPostId)
                : Effect.succeed(result.post),
              quote: result.post.quotedPostId
                ? svc.getMicroPostById(result.post.quotedPostId)
                : Effect.succeed(null),
            },
            { concurrency: 'unbounded' },
          ).pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const screenPosts = [
          ...new Map(
            [result.post, related.root, related.quote, ...result.replies.data].flatMap((post) =>
              post ? [[post.id, post] as const] : [],
            ),
          ).values(),
        ]

        const musicByPostId = yield* dieOnDatabaseError(svc.getMicroPostScreenMusic(screenPosts))

        const toScreenPost = (post: (typeof screenPosts)[number]) => ({
          ...toDateStrings(post),
          music: musicByPostId.get(post.id) ?? null,
        })

        return {
          post: toScreenPost(result.post),
          replies: result.replies.data.map(toScreenPost),
          root: toScreenPost(related.root),
          quote: related.quote ? toScreenPost(related.quote) : null,
        }
      }).pipe(Effect.withSpan('post.getMicroPostScreen', { attributes: { slug: params.slug } })),
    )
    .handle('getMicroPostScreenReplies', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const replies = yield* dieOnDatabaseError(
          svc
            .getMicroPostReplies(params.slug, { limit: 100, offset: 0 })
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const musicByPostId = yield* dieOnDatabaseError(svc.getMicroPostScreenMusic(replies.data))

        return replies.data.map((reply) => ({
          ...toDateStrings(reply),
          music: musicByPostId.get(reply.id) ?? null,
        }))
      }).pipe(
        Effect.withSpan('post.getMicroPostScreenReplies', { attributes: { slug: params.slug } }),
      ),
    )
    .handle('getMicroPostById', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const post = yield* dieOnDatabaseError(
          svc
            .getMicroPostById(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toDateStrings(post)
      }),
    )
    .handle('createMicroPostReply', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* PostService

        const reply = yield* dieOnDatabaseError(
          svc
            .createMicroPostReply(
              omitUndefined({
                parentSlug: params.parentSlug,
                actorUserId: user.id,
                title: payload.title,
                content: payload.content,
                musicEntityType: payload.musicEntityType,
                musicEntityId: payload.musicEntityId,
                quotedPostId: payload.quotedPostId,
              }),
            )
            .pipe(
              Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
              Effect.catchTag('ParentPostNotReplyableError', () => new ValidationHttpError()),
              Effect.catchTag('QuotedPostNotEmbeddableError', () => new ValidationHttpError()),
            ),
        )

        return toDateStrings(reply)
      }),
    )
    .handle('getMicroPostReplies', ({ params, query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc
            .getMicroPostReplies(params.parentSlug, {
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
            })
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return {
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getMicroPostThread', ({ params, query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc
            .getMicroPostThread(params.slug, {
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
            })
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return {
          root: toDateStrings(result.root),
          focus: toDateStrings(result.focus),
          posts: result.posts.map(toDateStrings),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getPostBySlug', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const post = yield* dieOnDatabaseError(
          svc
            .getBySlug(params.slug)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toDateStrings(post)
      }),
    )
    .handle('getPostBySlugForEdit', ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* AuthenticatedActor
        const { user } = actor
        yield* requireKeyScope(actor, ['posts:read'])
        const svc = yield* PostService

        const post = yield* dieOnDatabaseError(
          svc
            .getBySlugForEdit(
              params.slug,
              user.id,
              user.role ?? 'user',
              Predicate.isTagged(actor.credential, 'PersonalAccessKey') ? 'owned' : 'role',
            )
            .pipe(
              Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
            ),
        )

        return toDateStrings(post)
      }),
    )
    .handle('previewPostContent', ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* AuthenticatedActor
        const { user } = actor
        yield* requireKeyScope(actor, ['posts:create', 'posts:update'])

        if (!canCreatePosts(user.role)) return yield* new HttpApiError.Forbidden()

        const svc = yield* PostService

        return { richContent: yield* svc.renderPreview(payload.content) }
      }),
    )
    .handle('createPost', ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* AuthenticatedActor
        const { user } = actor

        if (!canCreatePosts(user.role)) {
          return yield* new HttpApiError.Forbidden()
        }

        const { creatorIds, ...postData } = payload
        const finalCreatorIds = creatorIds?.length ? [...creatorIds] : [user.id]

        const svc = yield* PostService

        const post = yield* dieOnDatabaseError(
          svc
            .create(
              omitUndefined({ ...postData, tags: postData.tags ? [...postData.tags] : undefined }),
              finalCreatorIds,
              { userId: user.id, userRole: user.role ?? 'user', credential: actor.credential },
            )
            .pipe(
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
              Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
              Effect.catchTag('QuotedPostNotEmbeddableError', () => new ValidationHttpError()),
            ),
        )

        return toDateStrings(post)
      }),
    )
    .handle('resolvePostMusic', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* dieOnDatabaseError(
          mapMusicIdentityErrors(
            resolvePostMusic(
              params.id,
              { userId: user.id, userRole: user.role ?? 'user' },
              payload.url,
            ),
          ).pipe(
            Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
            Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
            Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
            Effect.catchTag(
              'ValidationError',
              ({ message }) => new PostMusicResolutionError({ message }),
            ),
          ),
        )
      }),
    )
    .handle('updatePostBySlug', ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* AuthenticatedActor
        const { user } = actor
        const { tags, creatorIds, ...updateData } = payload

        const svc = yield* PostService

        const post = yield* dieOnDatabaseError(
          svc
            .update(
              params.slug,
              user.id,
              user.role || 'user',
              omitUndefined({
                ...updateData,
                ...(tags && { tags: [...tags] }),
                ...(creatorIds && { creatorIds: [...creatorIds] }),
              }),
              actor.credential,
            )
            .pipe(
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
            ),
        )

        return toDateStrings(post)
      }),
    )
    .handle('getPostsByTag', ({ params, query }) =>
      Effect.gen(function* () {
        const svc = yield* PostService

        const result = yield* dieOnDatabaseError(
          svc.getByTag(params.tag, { limit: query.limit ?? 20, offset: query.offset ?? 0 }),
        )

        return {
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }
      }),
    ),
)
