import { McpResourceUrl, PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Effect, Match, Schema } from 'effect'

import {
  EditorialEnvironment,
  EditorialFrontendUrl,
  EditorialToolError,
  GetPostResult,
  PostKind,
  PostSlug,
} from './contracts'

export const EditorialMcpSettings = Schema.Struct({
  readScope: Schema.Literal('posts:read'),
  environment: EditorialEnvironment,
  resourceUrl: McpResourceUrl,
  frontendUrl: EditorialFrontendUrl,
})

export const PostSource = Schema.TaggedUnion({
  Editorial: {},
  Tweet: {},
})

export const postSource = Match.type<typeof PostKind.Type | null>().pipe(
  Match.when('micro', () => PostSource.cases.Tweet.make({})),
  Match.whenOr('post', null, () => PostSource.cases.Editorial.make({})),
  Match.exhaustive,
)

export const PersistedPost = Schema.Struct({
  id: PostId,
  slug: PostSlug,
  type: Schema.NullOr(PostKind),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  updatedAt: Schema.Date,
  content: Schema.NullOr(Schema.String),
  thumbnailUrl: Schema.NullOr(Schema.String),
  bannerImageUrl: Schema.NullOr(Schema.String),
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  creators: Schema.optional(Schema.Array(Schema.Struct({ id: UserId }))),
  createdAt: Schema.Date,
  musicEntityType: Schema.NullOr(Schema.String),
  musicEntityId: Schema.NullOr(Schema.String),
  parentPostId: Schema.NullOr(PostId),
  rootPostId: Schema.NullOr(PostId),
  depth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  quotedPostId: Schema.NullOr(PostId),
})

export const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Editorial content is unavailable.' })

export const notFound = () =>
  new EditorialToolError({ code: 'not_found', message: 'Post not found.' })

export const projectPost = Effect.fn('EditorialMcp.projectPost')(function* (
  post: typeof PersistedPost.Type,
  config: typeof EditorialMcpSettings.Type,
) {
  const source = postSource(post.type)

  const destination = Match.value(source).pipe(
    Match.tag('Editorial', () => ({ path: '/new/editorial', type: 'post' })),
    Match.tag('Tweet', () => ({ path: '/new/tweet', type: 'micro' })),
    Match.exhaustive,
  )

  const reviewUrl = new URL(destination.path, config.frontendUrl)
  reviewUrl.searchParams.set('edit', post.slug)

  const projection = {
    postId: post.id,
    slug: post.slug,
    type: destination.type,
    title: post.title,
    description: post.description,
    draft: post.draft,
    updatedAt: post.updatedAt.toISOString(),
    reviewUrl: reviewUrl.href,
    content: post.content,
    thumbnailUrl: post.thumbnailUrl,
    tags: (post.tags ?? []).toSorted(),
    creatorIds: (post.creators ?? []).map((creator) => creator.id).toSorted(),
    createdAt: post.createdAt.toISOString(),
  }

  const digest = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify({
            ...projection,
            bannerImageUrl: post.bannerImageUrl,
            musicEntityType: post.musicEntityType,
            musicEntityId: post.musicEntityId,
            parentPostId: post.parentPostId,
            rootPostId: post.rootPostId,
            depth: post.depth,
            quotedPostId: post.quotedPostId,
          }),
        ),
      ),
    catch: unavailable,
  })

  const version = yield* Schema.decodeUnknownEffect(PostVersion)(
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
  ).pipe(Effect.mapError(unavailable))

  return yield* Schema.decodeUnknownEffect(GetPostResult.fields.post)({
    ...projection,
    version,
  }).pipe(Effect.mapError(unavailable))
})
