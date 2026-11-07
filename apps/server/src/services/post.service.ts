import type { Actor } from '@gbfm/api/middleware/actor'
import { KeyAccessDenied, type KeyInputInvalid } from '@gbfm/api/personal-access-keys'
import type { PostId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Role } from '@gbfm/core/roles'
import { LINK_STATUS } from '@gbfm/core/status'
import type { RichContentDocument } from '@gbfm/rich-content/schema'
import type { TweetCardEntityInput, TweetCardPresentationInput } from '@gbfm/social-card'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Match, Schema } from 'effect'

import { user as usersTable } from '@/db/auth.schema'
import { postIdsForCreator } from '@/db/creator-membership'
import { blueskyPostSources } from '@/db/external-account.schema'
import { guardedPostUpdate } from '@/db/guarded-post-update'
import {
  hasEntityLabel,
  hasEntityLabelLike,
  projectEntityLabels,
  projectEntityLabelsForRows,
  replaceEntityLabels,
} from '@/db/labels'
import { Database, type DatabaseClient } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicPlaylistTracksTable,
  musicPlaylistsTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import {
  type InsertPost,
  type PostType,
  postCreators,
  postsTable,
  type SelectMdxCompiledEditorialPost,
  type SelectMdxCompiledMicroPost,
  type SelectMdxCompiledPost,
  type SelectPost,
} from '@/db/post.schema'
import { timeQuery } from '@/db/query-timer'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import {
  ConflictError,
  DatabaseError,
  getErrorMessage,
  NotFoundError,
  ParentPostNotReplyableError,
  QuotedPostNotEmbeddableError,
  type UnauthorizedError,
  ValidationError,
  type S3Error,
} from '@/errors'
import { checkCreatorAuthorship, requireCreatorOrAdmin } from '@/lib/authorization'
import { authorizeKeyPostWrite } from '@/lib/key-post-authorization'
import { MdxService, validateCanonicalContent } from '@/lib/mdx'
import { createPaginationMetadata, type PaginationMetadata } from '@/lib/pagination'
import { ConfigService } from '@/services/config.service'
import {
  attachedMediaUrls,
  makeMediaPublication,
  type MediaActor,
  type MediaPublication,
} from '@/services/media-publication'
import { publicPlaylistPredicate } from '@/services/music-entity/playlist.service'
import { SentryService } from '@/services/sentry.service'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { toSlug } from '@/services/to-slug'
import {
  keyFromAssetUrl,
  markAttachedAssets,
  UploadAssetService,
} from '@/services/upload-asset.service'

export const POST_SOURCE_FILTERS = ['bluesky', 'native'] as const

export type PostSourceFilter = (typeof POST_SOURCE_FILTERS)[number]

export interface MicroPostScreenMusic {
  readonly entity: {
    readonly id: string
    readonly type: 'album' | 'track' | 'playlist'
    readonly title: string
    readonly artistNames: Array<string> | null
    readonly coverImageUrl: string | null
  }
  readonly links: ReadonlyArray<{ readonly platform: string; readonly url: string }>
}

type EditorialSummary = {
  id: string
  slug: string
  title: string
  thumbnailUrl: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
  creators: NonNullable<SelectMdxCompiledPost['creators']>
  tags: SelectMdxCompiledPost['tags']
  draft: boolean
}

export const PostSourceAccess = Schema.TaggedUnion({
  Published: {},
  Authored: { userId: UserId, userRole: Role },
})

export type SourcePost = SelectPost & {
  readonly creators: NonNullable<SelectMdxCompiledPost['creators']>
}

export interface PostService {
  readonly getSourcesForEdit: (
    options: { limit: number; offset: number; draft?: boolean; type?: PostType },
    reader: typeof PostSourceAccess.cases.Authored.Type,
  ) => Effect.Effect<{ data: Array<SourcePost>; pagination: PaginationMetadata }, DatabaseError>
  readonly getSourceById: (
    postId: PostId,
    access: typeof PostSourceAccess.Type,
  ) => Effect.Effect<SourcePost, DatabaseError | NotFoundError>
  readonly getAll: (options: {
    limit: number
    offset: number
    type?: PostType
  }) => Effect.Effect<
    { data: Array<SelectMdxCompiledPost>; pagination: PaginationMetadata },
    DatabaseError
  >
  readonly getAllForEdit: (
    options: {
      limit: number
      offset: number
      type?: PostType
      source?: PostSourceFilter
      draft?: boolean
      q?: string
    },
    userId: string,
    userRole: string,
    access?: 'owned' | 'role',
  ) => Effect.Effect<
    { data: Array<SelectMdxCompiledPost>; pagination: PaginationMetadata },
    DatabaseError
  >
  readonly getBySlug: (
    slug: string,
  ) => Effect.Effect<SelectMdxCompiledPost, DatabaseError | NotFoundError>
  readonly getBySlugForEdit: (
    slug: string,
    userId: string,
    userRole: string,
    access?: 'owned' | 'role',
  ) => Effect.Effect<SelectMdxCompiledPost, DatabaseError | NotFoundError | UnauthorizedError>
  readonly getEditorials: (options: {
    limit: number
    offset: number
    tag?: string
  }) => Effect.Effect<
    { data: Array<SelectMdxCompiledEditorialPost>; pagination: PaginationMetadata },
    DatabaseError,
    SentryService
  >
  readonly getEditorialSummaries: (options: {
    limit: number
    offset: number
    tag?: string
    readerId?: string
  }) => Effect.Effect<
    { data: Array<EditorialSummary>; pagination: PaginationMetadata },
    DatabaseError
  >
  readonly getEditorialBySlug: (
    slug: string,
    readerId?: string,
  ) => Effect.Effect<SelectMdxCompiledEditorialPost, DatabaseError | NotFoundError>
  readonly getMicroPosts: (options: {
    limit: number
    offset: number
    tag?: string
    musicEntityType?: 'album' | 'track' | 'playlist'
    musicEntityId?: string
  }) => Effect.Effect<
    { data: Array<SelectMdxCompiledMicroPost>; pagination: PaginationMetadata },
    DatabaseError,
    SentryService
  >
  readonly getLatestMicroPost: Effect.Effect<{ slug: string } | null, DatabaseError>
  readonly getMicroPostBySlug: (
    slug: string,
  ) => Effect.Effect<SelectMdxCompiledMicroPost, DatabaseError | NotFoundError>
  readonly getTweetCardInput: (
    post: TweetCardPost,
  ) => Effect.Effect<TweetCardPresentationInput, DatabaseError>
  readonly getMicroPostReferenceBySlug: (
    slug: string,
  ) => Effect.Effect<{ readonly id: string; readonly slug: string }, DatabaseError | NotFoundError>
  readonly getMicroPostById: (
    id: string,
  ) => Effect.Effect<SelectMdxCompiledMicroPost, DatabaseError | NotFoundError>
  readonly getMicroPostScreenMusic: (
    posts: ReadonlyArray<SelectMdxCompiledMicroPost>,
  ) => Effect.Effect<ReadonlyMap<string, MicroPostScreenMusic>, DatabaseError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Existing callers use the zero-argument service method contract.
  readonly getPostTags: () => Effect.Effect<Array<string>, DatabaseError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Existing callers use the zero-argument service method contract.
  readonly getEditorialTags: () => Effect.Effect<Array<string>, DatabaseError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Existing callers use the zero-argument service method contract.
  readonly getMicroTags: () => Effect.Effect<Array<string>, DatabaseError>
  readonly getAdjacentMicroPosts: (slug: string) => Effect.Effect<
    {
      prev: { id: string; slug: string; title: string | null } | null
      next: { id: string; slug: string; title: string | null } | null
    },
    DatabaseError | NotFoundError
  >
  readonly getRandomMicroPost: (
    excludeSlugs: Array<string>,
  ) => Effect.Effect<{ id: string; slug: string }, DatabaseError | NotFoundError>
  readonly searchMicroPosts: (options: {
    q: string
    limit: number
    offset: number
  }) => Effect.Effect<
    { data: Array<SelectMdxCompiledMicroPost>; pagination: PaginationMetadata },
    DatabaseError,
    SentryService
  >
  readonly getByTag: (
    tag: string,
    options: { limit: number; offset: number },
  ) => Effect.Effect<{ data: Array<SelectPost>; pagination: PaginationMetadata }, DatabaseError>
  readonly create: (
    data: Partial<InsertPost>,
    creatorIds: Array<string>,
    actor?: MediaActor,
  ) => Effect.Effect<
    SelectPost,
    | KeyAccessDenied
    | KeyInputInvalid
    | DatabaseError
    | ConflictError
    | ValidationError
    | NotFoundError
    | QuotedPostNotEmbeddableError
    | UnauthorizedError
    | S3Error
  >
  readonly createMicroPostReply: (options: {
    parentSlug: string
    actorUserId: string
    title?: string | null
    content?: string | null
    musicEntityType?: string | null
    musicEntityId?: string | null
    quotedPostId?: string | null
  }) => Effect.Effect<
    SelectMdxCompiledMicroPost,
    | DatabaseError
    | NotFoundError
    | ConflictError
    | ValidationError
    | ParentPostNotReplyableError
    | QuotedPostNotEmbeddableError
    | UnauthorizedError
    | S3Error
  >
  readonly getMicroPostReplies: (
    parentSlug: string,
    options: { limit: number; offset: number },
  ) => Effect.Effect<
    { data: Array<SelectMdxCompiledMicroPost>; pagination: PaginationMetadata },
    DatabaseError | NotFoundError,
    SentryService
  >
  readonly getMicroPostThread: (
    slug: string,
    options: { limit: number; offset: number },
  ) => Effect.Effect<
    {
      root: SelectMdxCompiledMicroPost
      focus: SelectMdxCompiledMicroPost
      posts: Array<SelectMdxCompiledMicroPost>
      pagination: PaginationMetadata
    },
    DatabaseError | NotFoundError,
    SentryService
  >
  readonly update: (
    slug: string,
    userId: string,
    userRole: string,
    data: Partial<InsertPost> & { creatorIds?: Array<string>; expectedUpdatedAt?: Date },
    credential?: Actor['credential'],
  ) => Effect.Effect<
    SelectMdxCompiledPost,
    | DatabaseError
    | NotFoundError
    | UnauthorizedError
    | ValidationError
    | S3Error
    | KeyAccessDenied
    | KeyInputInvalid
    | ConflictError
  >
  /** Renders draft source through the publishing pipeline without storing it. */
  readonly renderPreview: (content: string) => Effect.Effect<RichContentDocument>
}

export const PostService = Context.Service<PostService>('PostService')

type PostRow = Omit<SelectPost, 'tags'> & { tags?: Array<string> | null }

const isNonBlankString = (value: string | null | undefined): value is string =>
  value?.trim().length !== 0 && value !== null && value !== undefined

const normalizeBlankString = (value: string | null | undefined) =>
  value?.trim().length === 0 ? null : value

export const validatePostData = (
  data: Partial<InsertPost>,
): Effect.Effect<void, ValidationError> => {
  if (data.type === 'micro') {
    return isNonBlankString(data.title) || isNonBlankString(data.content)
      ? Effect.void
      : Effect.fail(new ValidationError({ message: 'Tweet title or body is required' }))
  }

  if (!isNonBlankString(data.title)) {
    return Effect.fail(new ValidationError({ message: 'Post title is required' }))
  }

  if (!isNonBlankString(data.content)) {
    return Effect.fail(new ValidationError({ message: 'Post content is required' }))
  }

  return Effect.void
}

export function normalizePostData(data: InsertPost, type: PostType | null | undefined): InsertPost
export function normalizePostData(
  data: Partial<InsertPost>,
  type: PostType | null | undefined,
): Partial<InsertPost>
export function normalizePostData(
  data: Partial<InsertPost>,
  type: PostType | null | undefined,
): Partial<InsertPost> {
  if (type !== 'micro') {
    return data
  }

  const normalizedData = { ...data }

  if ('title' in normalizedData) {
    normalizedData.title = normalizeBlankString(normalizedData.title)
  }

  if ('content' in normalizedData) {
    normalizedData.content = normalizeBlankString(normalizedData.content)
  }

  return normalizedData
}

const buildPostWithCreators = (post: PostRow, mdx: MdxService) =>
  Effect.gen(function* () {
    const db = yield* Database

    const { blueskySources, creators, projectedPost } = yield* Effect.all({
      blueskySources: Effect.tryPromise({
        try: () =>
          db
            .select({
              authorDid: blueskyPostSources.authorDid,
              authorHandle: blueskyPostSources.authorHandle,
              publicUrl: blueskyPostSources.publicUrl,
              sourceCreatedAt: blueskyPostSources.sourceCreatedAt,
              sourceStatus: blueskyPostSources.sourceStatus,
              locallyEdited: blueskyPostSources.locallyEdited,
              lastError: blueskyPostSources.lastError,
            })
            .from(blueskyPostSources)
            .where(eq(blueskyPostSources.postId, post.id))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch Bluesky source: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'bluesky_post_sources',
          }),
      }),
      creators: Effect.tryPromise({
        try: () =>
          db
            .select({
              id: usersTable.id,
              name: usersTable.name,
              username: usersTable.username,
              image: usersTable.image,
            })
            .from(postCreators)
            .innerJoin(usersTable, eq(postCreators.creatorId, usersTable.id))
            .where(eq(postCreators.postId, post.id)),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch creators: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'post_creators',
          }),
      }).pipe(Effect.withSpan('post.getCreators', { attributes: { postId: post.id } })),
      projectedPost: Effect.tryPromise({
        try: () => projectEntityLabels(db, 'post', post),
        catch: (error) =>
          new DatabaseError({
            message: getErrorMessage(error),
            operation: 'select',
            table: 'labels',
          }),
      }),
    })

    const compiled = yield* compilePost(projectedPost, creators, mdx)
    const blueskySource = blueskySources[0]

    return blueskySource ? { ...compiled, blueskySource } : compiled
  })

// Compilation only accepts label-projected rows; loading relations belongs to callers.
const compilePost = (
  post: SelectPost,
  creators: SelectMdxCompiledPost['creators'],
  mdx: MdxService,
) =>
  Effect.gen(function* () {
    const compiledContent = post.content
      ? yield* mdx.compile(post.content).pipe(Effect.orElseSucceed(() => ''))
      : ''

    const richContent = yield* mdx.render(post.content ?? '')

    return {
      ...post,
      compiledContent,
      richContent,
      creators,
    } satisfies SelectMdxCompiledPost
  })

const loadPostRelations = (rows: Array<PostRow>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const postIds = rows.map((post) => post.id)
    const creatorsByPostId = new Map<string, NonNullable<SelectMdxCompiledPost['creators']>>()

    if (postIds.length === 0) return { rows: [], creatorsByPostId }

    const [creatorsData, projectedRows] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            db
              .select({
                postId: postCreators.postId,
                id: usersTable.id,
                name: usersTable.name,
                username: usersTable.username,
                image: usersTable.image,
              })
              .from(postCreators)
              .innerJoin(usersTable, eq(postCreators.creatorId, usersTable.id))
              .where(inArray(postCreators.postId, postIds)),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to fetch creators: ${getErrorMessage(error)}`,
              operation: 'select',
              table: 'post_creators',
            }),
        }),
        Effect.tryPromise({
          try: () => projectEntityLabelsForRows(db, 'post', rows),
          catch: (error) =>
            new DatabaseError({
              message: getErrorMessage(error),
              operation: 'select',
              table: 'labels',
            }),
        }),
      ],
      { concurrency: 'unbounded' },
    )

    for (const { postId, ...creator } of creatorsData) {
      const creators = creatorsByPostId.get(postId) ?? []
      creators.push(creator)
      creatorsByPostId.set(postId, creators)
    }

    return { rows: projectedRows, creatorsByPostId }
  })

export const toEditorialPost = (
  post: SelectMdxCompiledPost,
): Effect.Effect<SelectMdxCompiledEditorialPost, DatabaseError> =>
  Effect.gen(function* () {
    const { title, content } = post

    if (post.type === 'post' && isNonBlankString(title) && isNonBlankString(content)) {
      return {
        ...post,
        title,
        content,
        type: 'post' as const,
      }
    }

    return yield* new DatabaseError({
      message: `Expected editorial post with title and content: ${post.slug}`,
      operation: 'post_type_refinement',
      table: 'posts',
    })
  })

export const toMicroPost = (
  post: SelectMdxCompiledPost,
): Effect.Effect<SelectMdxCompiledMicroPost, DatabaseError> =>
  post.type === 'micro'
    ? Effect.succeed({ ...post, type: 'micro' })
    : Effect.fail(
        new DatabaseError({
          message: `Expected micro post: ${post.slug}`,
          operation: 'post_type_refinement',
          table: 'posts',
        }),
      )

export const importedPostIds = (db: Database['Service']) =>
  db
    .select({ postId: blueskyPostSources.postId })
    .from(blueskyPostSources)
    .where(sql`${blueskyPostSources.postId} is not null`)

const fetchReplyCountsByParentId = (postIds: Array<string>) =>
  Effect.gen(function* () {
    const replyCountsByParentId: Record<string, number> = {}

    if (postIds.length === 0) return replyCountsByParentId

    const db = yield* Database

    const replyCountRows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ parentPostId: postsTable.parentPostId, total: count() })
          .from(postsTable)
          .where(inArray(postsTable.parentPostId, postIds))
          .groupBy(postsTable.parentPostId),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to count nested replies: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    for (const row of replyCountRows) {
      if (row.parentPostId) {
        replyCountsByParentId[row.parentPostId] = row.total
      }
    }

    return replyCountsByParentId
  })

const readablePosts = (db: DatabaseClient, readerId?: string) =>
  or(eq(postsTable.draft, false), readerId ? postIdsForCreator(db, readerId) : undefined)

const getPostRowsEffect = (
  options: {
    limit: number
    offset: number
    type?: PostType
    tag?: string
    topLevelOnly?: boolean
    source?: PostSourceFilter
    draft?: boolean
    q?: string
    musicEntityType?: 'album' | 'track' | 'playlist'
    musicEntityId?: string
    readerId?: string
  },
  actor?: { userId: string; userRole: string; access?: 'owned' | 'role' | undefined },
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset, type, tag, topLevelOnly, source, draft, q } = options

    const contentCondition =
      type && tag
        ? and(eq(postsTable.type, type), hasEntityLabel('post', postsTable.id, tag))
        : type
          ? eq(postsTable.type, type)
          : tag
            ? hasEntityLabel('post', postsTable.id, tag)
            : undefined

    const visibilityCondition = Match.value(actor).pipe(
      Match.when(undefined, () => readablePosts(db, options.readerId)),
      Match.when(
        (currentActor) => currentActor.userRole === 'admin' && currentActor.access !== 'owned',
        () => undefined,
      ),
      Match.orElse((currentActor) => postIdsForCreator(db, currentActor.userId)),
    )

    const replyCondition = topLevelOnly ? isNull(postsTable.parentPostId) : undefined

    const sourceCondition = Match.value(source).pipe(
      Match.when('bluesky', () => inArray(postsTable.id, importedPostIds(db))),
      Match.when('native', () => notInArray(postsTable.id, importedPostIds(db))),
      Match.orElse(() => undefined),
    )

    const draftCondition = draft === undefined ? undefined : eq(postsTable.draft, draft)
    const searchTerm = q?.trim()

    const searchCondition = searchTerm
      ? sql`(lower(${postsTable.title}) LIKE ${`%${searchTerm.toLowerCase()}%`} OR lower(${postsTable.slug}) LIKE ${`%${searchTerm.toLowerCase()}%`} OR lower(${postsTable.content}) LIKE ${`%${searchTerm.toLowerCase()}%`})`
      : undefined

    const whereCondition = and(
      visibilityCondition,
      contentCondition,
      replyCondition,
      sourceCondition,
      draftCondition,
      searchCondition,
      options.musicEntityType ? eq(postsTable.musicEntityType, options.musicEntityType) : undefined,
      options.musicEntityId ? eq(postsTable.musicEntityId, options.musicEntityId) : undefined,
    )

    const countResult = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () => db.select({ total: count() }).from(postsTable).where(whereCondition),
          'get-posts-count',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to count posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const total = countResult[0]?.total ?? 0

    const data = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () =>
            db
              .select()
              .from(postsTable)
              .limit(limit)
              .offset(offset)
              .where(whereCondition)
              .orderBy(desc(postsTable.createdAt), desc(postsTable.id)),
          'get-posts-data',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    yield* Effect.annotateCurrentSpan('resultCount', data.length)
    yield* Effect.annotateCurrentSpan('totalCount', total)

    yield* Effect.logInfo('[Content] Posts retrieved', {
      count: data.length,
      total,
      limit,
      offset,
    })

    return { data, pagination: createPaginationMetadata(total, limit, offset) }
  })

const getAllEffect = (
  options: Parameters<typeof getPostRowsEffect>[0],
  mdx: MdxService,
  actor?: { userId: string; userRole: string; access?: 'owned' | 'role' | undefined },
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { data, pagination } = yield* getPostRowsEffect(options, actor)
    const postIds = data.map((p) => p.id)

    const [{ rows: projectedData, creatorsByPostId }, sourcesData] = yield* Effect.all(
      [
        loadPostRelations(data),
        postIds.length > 0
          ? Effect.tryPromise({
              try: () =>
                db
                  .select({
                    postId: blueskyPostSources.postId,
                    authorDid: blueskyPostSources.authorDid,
                    authorHandle: blueskyPostSources.authorHandle,
                    publicUrl: blueskyPostSources.publicUrl,
                    sourceCreatedAt: blueskyPostSources.sourceCreatedAt,
                    sourceStatus: blueskyPostSources.sourceStatus,
                    locallyEdited: blueskyPostSources.locallyEdited,
                    lastError: blueskyPostSources.lastError,
                  })
                  .from(blueskyPostSources)
                  .where(inArray(blueskyPostSources.postId, postIds)),
              catch: (error) =>
                new DatabaseError({
                  message: `Failed to fetch Bluesky sources: ${getErrorMessage(error)}`,
                  operation: 'select',
                  table: 'bluesky_post_sources',
                }),
            })
          : Effect.succeed([]),
      ],
      { concurrency: 'unbounded' },
    )

    const sourceByPostId = new Map(
      sourcesData.flatMap(({ postId, ...source }) => (postId ? [[postId, source] as const] : [])),
    )

    const compiledData: Array<SelectMdxCompiledPost> = yield* Effect.forEach(
      projectedData,
      (post) => {
        const creators = creatorsByPostId.get(post.id) ?? []
        const blueskySource = sourceByPostId.get(post.id)

        return compilePost(post, creators, mdx).pipe(
          Effect.map((compiled) => (blueskySource ? { ...compiled, blueskySource } : compiled)),
        )
      },
      { concurrency: 5 },
    )

    return {
      data: compiledData,
      pagination,
    }
  }).pipe(
    Effect.withSpan('post.getAll', {
      attributes: { 'post.type': options.type ?? 'all' },
    }),
  )

const loadSourcePosts = Effect.fn('post.loadSourcePosts')(function* (rows: Array<PostRow>) {
  const { rows: projectedRows, creatorsByPostId } = yield* loadPostRelations(rows)

  return projectedRows.map((post) => ({
    ...post,
    creators: creatorsByPostId.get(post.id) ?? [],
  }))
})

const getSourcesForEditEffect = Effect.fn('post.getSourcesForEdit')(function* (
  options: Parameters<PostService['getSourcesForEdit']>[0],
  reader: typeof PostSourceAccess.cases.Authored.Type,
) {
  const { data, pagination } = yield* getPostRowsEffect(options, {
    userId: reader.userId,
    userRole: reader.userRole,
    access: 'owned',
  })

  return { data: yield* loadSourcePosts(data), pagination }
})

const getSourceByIdEffect = Effect.fn('post.getSourceById')(function* (
  postId: PostId,
  access: typeof PostSourceAccess.Type,
) {
  const db = yield* Database

  const readerId = Match.value(access).pipe(
    Match.tag('Published', () => undefined),
    Match.tag('Authored', (reader) => reader.userId),
    Match.exhaustive,
  )

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.id, postId), readablePosts(db, readerId)))
        .limit(1),
    catch: () =>
      new DatabaseError({
        message: 'Failed to read post source',
        operation: 'select',
        table: 'posts',
      }),
  })

  const [post] = yield* loadSourcePosts(rows)

  if (!post)
    return yield* new NotFoundError({ message: 'Post not found', resource: 'post', id: postId })

  return post
})

const getPostTagsEffect = () =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .selectDistinct({ tag: labelsTable.name })
          .from(postsTable)
          .innerJoin(
            entityLabelsTable,
            and(
              eq(entityLabelsTable.entityType, 'post'),
              eq(entityLabelsTable.entityId, postsTable.id),
            ),
          )
          .innerJoin(
            labelsTable,
            and(eq(labelsTable.id, entityLabelsTable.labelId), eq(labelsTable.kind, 'tag')),
          )
          .where(eq(postsTable.draft, false)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch post tags: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    return rows
      .map((row) => row.tag)
      .filter((tag) => tag.length > 0)
      .toSorted()
  })

const getEditorialTagsEffect = () =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .selectDistinct({ tag: labelsTable.name })
          .from(postsTable)
          .innerJoin(
            entityLabelsTable,
            and(
              eq(entityLabelsTable.entityType, 'post'),
              eq(entityLabelsTable.entityId, postsTable.id),
            ),
          )
          .innerJoin(
            labelsTable,
            and(eq(labelsTable.id, entityLabelsTable.labelId), eq(labelsTable.kind, 'tag')),
          )
          .where(and(eq(postsTable.type, 'post'), eq(postsTable.draft, false))),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch editorial tags: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    return rows
      .map((r) => r.tag)
      .filter((tag) => tag.length > 0)
      .toSorted()
  })

const getMicroTagsEffect = () =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .selectDistinct({ tag: labelsTable.name })
          .from(postsTable)
          .innerJoin(
            entityLabelsTable,
            and(
              eq(entityLabelsTable.entityType, 'post'),
              eq(entityLabelsTable.entityId, postsTable.id),
            ),
          )
          .innerJoin(
            labelsTable,
            and(eq(labelsTable.id, entityLabelsTable.labelId), eq(labelsTable.kind, 'tag')),
          )
          .where(and(eq(postsTable.type, 'micro'), eq(postsTable.draft, false))),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch micro tags: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    return rows
      .map((r) => r.tag)
      .filter((tag) => tag.length > 0)
      .toSorted()
  })

const getAdjacentMicroPostsEffect = (slug: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const currentRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: postsTable.id, createdAt: postsTable.createdAt })
          .from(postsTable)
          .where(and(eq(postsTable.slug, slug), eq(postsTable.type, 'micro')))
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch micro post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const current = currentRecords[0]

    if (!current) {
      return yield* new NotFoundError({
        message: 'Micro post not found',
        resource: 'post',
        id: slug,
      })
    }

    const baseCondition = and(
      eq(postsTable.type, 'micro'),
      eq(postsTable.draft, false),
      isNull(postsTable.parentPostId),
      ne(postsTable.id, current.id),
    )

    // prev = newer (toward present), next = older (back in time) -- the
    // index redirects to the newest post, so "next" continuing to walk
    // backward through history is the intuitive direction from there.
    // Uses gte/lte + excludes the current row by id, rather than strict
    // gt/lt on createdAt alone: Postgres timestamps store microsecond
    // precision but JS Date only carries milliseconds, so a value read
    // out and passed back in as a query param can silently round down
    // and no longer compare equal to the row it came from.
    const { prevRows, nextRows } = yield* Effect.all({
      prevRows: Effect.tryPromise({
        try: () =>
          db
            .select({ id: postsTable.id, slug: postsTable.slug, title: postsTable.title })
            .from(postsTable)
            .where(and(baseCondition, gte(postsTable.createdAt, current.createdAt)))
            .orderBy(asc(postsTable.createdAt))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch previous micro post: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'posts',
          }),
      }),
      nextRows: Effect.tryPromise({
        try: () =>
          db
            .select({ id: postsTable.id, slug: postsTable.slug, title: postsTable.title })
            .from(postsTable)
            .where(and(baseCondition, lte(postsTable.createdAt, current.createdAt)))
            .orderBy(desc(postsTable.createdAt))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch next micro post: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'posts',
          }),
      }),
    })

    return {
      prev: prevRows[0] ?? null,
      next: nextRows[0] ?? null,
    }
  }).pipe(Effect.withSpan('post.getAdjacentMicroPosts', { attributes: { slug } }))

const getRandomMicroPostEffect = (excludeSlugs: Array<string>) =>
  Effect.gen(function* () {
    const db = yield* Database

    const baseCondition = and(
      eq(postsTable.type, 'micro'),
      eq(postsTable.draft, false),
      isNull(postsTable.parentPostId),
    )

    const withExclude =
      excludeSlugs.length > 0
        ? and(baseCondition, notInArray(postsTable.slug, excludeSlugs))
        : baseCondition

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: postsTable.id, slug: postsTable.slug })
          .from(postsTable)
          .where(withExclude)
          .orderBy(sql`random()`)
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch random micro post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    if (rows[0]) return rows[0]

    const fallback = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: postsTable.id, slug: postsTable.slug })
          .from(postsTable)
          .where(baseCondition)
          .orderBy(sql`random()`)
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch random micro post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const fallbackPost = fallback[0]

    if (!fallbackPost) {
      return yield* new NotFoundError({
        message: 'No micro posts exist',
        resource: 'post',
        id: 'random',
      })
    }

    return fallbackPost
  }).pipe(Effect.withSpan('post.getRandomMicroPost'))

const searchMicroPostsEffect = (
  options: { q: string; limit: number; offset: number },
  mdx: MdxService,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { q, limit, offset } = options
    const pattern = `%${q.toLowerCase()}%`

    const directPostMatch =
      q.length < 3
        ? or(
            like(sql`lower(${postsTable.title})`, pattern),
            like(sql`lower(${postsTable.content})`, pattern),
            hasEntityLabelLike('post', postsTable.id, pattern),
          )
        : sql`rowid IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ${`"${q.replaceAll('"', '""')}"`})`

    const matchCondition = or(
      directPostMatch,
      and(
        eq(postsTable.musicEntityType, 'track'),
        exists(
          db
            .select({ id: musicTracksTable.id })
            .from(musicTracksTable)
            .leftJoin(musicAlbumsTable, eq(musicAlbumsTable.id, musicTracksTable.albumId))
            .where(
              and(
                eq(musicTracksTable.id, postsTable.musicEntityId),
                or(
                  like(sql`lower(${musicTracksTable.title})`, pattern),
                  like(sql`lower(${musicTracksTable.artistNames})`, pattern),
                  like(sql`lower(${musicAlbumsTable.title})`, pattern),
                ),
              ),
            ),
        ),
      ),
      and(
        eq(postsTable.musicEntityType, 'album'),
        exists(
          db
            .select({ id: musicAlbumsTable.id })
            .from(musicAlbumsTable)
            .where(
              and(
                eq(musicAlbumsTable.id, postsTable.musicEntityId),
                or(
                  like(sql`lower(${musicAlbumsTable.title})`, pattern),
                  like(sql`lower(${musicAlbumsTable.artistNames})`, pattern),
                ),
              ),
            ),
        ),
      ),
      and(
        eq(postsTable.musicEntityType, 'playlist'),
        exists(
          db
            .select({ id: musicPlaylistsTable.id })
            .from(musicPlaylistsTable)
            .where(
              and(
                eq(musicPlaylistsTable.id, postsTable.musicEntityId),
                or(
                  like(sql`lower(${musicPlaylistsTable.title})`, pattern),
                  like(sql`lower(${musicPlaylistsTable.description})`, pattern),
                  exists(
                    db
                      .select({ trackId: musicPlaylistTracksTable.trackId })
                      .from(musicPlaylistTracksTable)
                      .innerJoin(
                        musicTracksTable,
                        eq(musicTracksTable.id, musicPlaylistTracksTable.trackId),
                      )
                      .where(
                        and(
                          eq(musicPlaylistTracksTable.playlistId, musicPlaylistsTable.id),
                          or(
                            like(sql`lower(${musicTracksTable.title})`, pattern),
                            like(sql`lower(${musicTracksTable.artistNames})`, pattern),
                          ),
                        ),
                      ),
                  ),
                ),
              ),
            ),
        ),
      ),
    )

    const whereCondition = and(
      eq(postsTable.type, 'micro'),
      eq(postsTable.draft, false),
      matchCondition,
    )

    const countResult = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () => db.select({ total: count() }).from(postsTable).where(whereCondition),
          'search-micro-posts-count',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to count micro posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const total = countResult[0]?.total ?? 0

    const data = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () =>
            db
              .select()
              .from(postsTable)
              .where(whereCondition)
              .orderBy(desc(postsTable.createdAt))
              .limit(limit)
              .offset(offset),
          'search-micro-posts-data',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to search micro posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const postIds = data.map((p) => p.id)
    const { rows: projectedData, creatorsByPostId } = yield* loadPostRelations(data)

    const replyCountsByParentId = yield* fetchReplyCountsByParentId(postIds)

    const compiledData = yield* Effect.forEach(
      projectedData,
      (post) => compilePost(post, creatorsByPostId.get(post.id) ?? [], mdx),
      { concurrency: 5 },
    )

    const sentry = yield* SentryService

    const rawData = yield* Effect.forEach(
      compiledData,
      (post) =>
        toMicroPost(post).pipe(
          Effect.catchTag('DatabaseError', (e) =>
            Effect.andThen(
              sentry.captureException(e, {
                slug: post.slug,
                type: post.type,
                operation: 'toMicroPost',
              }),
              Effect.succeed<SelectMdxCompiledMicroPost | null>(null),
            ),
          ),
        ),
      { concurrency: 5 },
    )

    const filteredData = rawData
      .filter((p): p is SelectMdxCompiledMicroPost => p !== null)
      .map((post) => ({ ...post, replyCount: replyCountsByParentId[post.id] ?? 0 }))

    return {
      data: filteredData,
      pagination: createPaginationMetadata(total, limit, offset),
    }
  }).pipe(
    Effect.withSpan('post.searchMicroPosts', {
      attributes: { queryLength: options.q.length },
    }),
  )

const getEditorialSummariesEffect = (
  options: Parameters<PostService['getEditorialSummaries']>[0],
) =>
  Effect.gen(function* () {
    const posts = yield* getPostRowsEffect({ ...options, type: 'post' })
    const { rows, creatorsByPostId } = yield* loadPostRelations(posts.data)

    const data = rows.flatMap((post) => {
      if (!isNonBlankString(post.title) || !isNonBlankString(post.content)) return []

      return [
        {
          id: post.id,
          slug: post.slug,
          title: post.title,
          thumbnailUrl: post.thumbnailUrl,
          description: post.description,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          creators: creatorsByPostId.get(post.id) ?? [],
          tags: post.tags,
          draft: post.draft,
        },
      ]
    })

    return { data, pagination: posts.pagination }
  }).pipe(Effect.withSpan('post.getEditorialSummaries'))

const getEditorialsEffect = (
  options: { limit: number; offset: number; tag?: string },
  mdx: MdxService,
) =>
  Effect.gen(function* () {
    const posts = yield* getAllEffect({ ...options, type: 'post' }, mdx)
    const sentry = yield* SentryService

    const rawData = yield* Effect.forEach(
      posts.data,
      (post) =>
        toEditorialPost(post).pipe(
          Effect.catchTag('DatabaseError', (e) =>
            Effect.andThen(
              sentry.captureException(e, {
                slug: post.slug,
                type: post.type,
                operation: 'toEditorialPost',
              }),
              Effect.succeed<SelectMdxCompiledEditorialPost | null>(null),
            ),
          ),
        ),
      { concurrency: 5 },
    )

    const data = rawData.filter((p): p is SelectMdxCompiledEditorialPost => p !== null)

    return {
      ...posts,
      data,
    }
  }).pipe(Effect.withSpan('post.getEditorials'))

const getMicroPostsEffect = (
  options: Parameters<PostService['getMicroPosts']>[0],
  mdx: MdxService,
) =>
  Effect.gen(function* () {
    const posts = yield* getAllEffect(
      { ...options, type: 'micro', topLevelOnly: !options.musicEntityId },
      mdx,
    )

    const sentry = yield* SentryService

    const rawData = yield* Effect.forEach(
      posts.data,
      (post) =>
        toMicroPost(post).pipe(
          Effect.catchTag('DatabaseError', (e) =>
            Effect.andThen(
              sentry.captureException(e, {
                slug: post.slug,
                type: post.type,
                operation: 'toMicroPost',
              }),
              Effect.succeed<SelectMdxCompiledMicroPost | null>(null),
            ),
          ),
        ),
      { concurrency: 5 },
    )

    const filteredData = rawData.filter((p): p is SelectMdxCompiledMicroPost => p !== null)

    const replyCountsByParentId = yield* fetchReplyCountsByParentId(
      filteredData.map((post) => post.id),
    )

    const data = filteredData.map((post) => ({
      ...post,
      replyCount: replyCountsByParentId[post.id] ?? 0,
    }))

    return {
      ...posts,
      data,
    }
  }).pipe(Effect.withSpan('post.getMicroPosts'))

const getLatestMicroPostEffect = Effect.gen(function* () {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ slug: postsTable.slug })
        .from(postsTable)
        .where(
          and(
            eq(postsTable.type, 'micro'),
            eq(postsTable.draft, false),
            isNull(postsTable.parentPostId),
          ),
        )
        .orderBy(desc(postsTable.createdAt))
        .limit(1),
    catch: (error) =>
      new DatabaseError({
        message: `Failed to fetch latest tweet: ${getErrorMessage(error)}`,
        operation: 'select',
        table: 'posts',
      }),
  })

  return rows[0] ?? null
}).pipe(Effect.withSpan('post.getLatestMicroPost'))

const getByTagEffect = (tag: string, options: { limit: number; offset: number }) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset } = options

    const whereCondition = and(
      eq(postsTable.draft, false),
      hasEntityLabel('post', postsTable.id, tag),
    )

    const countResult = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () => db.select({ total: count() }).from(postsTable).where(whereCondition),
          'get-posts-by-tag-count',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to count posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const total = countResult[0]?.total ?? 0

    const data = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () =>
            db
              .select()
              .from(postsTable)
              .where(whereCondition)
              .limit(limit)
              .offset(offset)
              .orderBy(desc(postsTable.createdAt)),
          'get-posts-by-tag-data',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    yield* Effect.annotateCurrentSpan('tag', tag)
    yield* Effect.annotateCurrentSpan('resultCount', data.length)
    yield* Effect.annotateCurrentSpan('totalCount', total)

    yield* Effect.logInfo('[Content] Posts retrieved by tag', {
      tag,
      count: data.length,
      total,
      limit,
      offset,
    })

    const projectedData = yield* Effect.tryPromise({
      try: () => projectEntityLabelsForRows(db, 'post', data),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    return {
      data: projectedData,
      pagination: createPaginationMetadata(total, limit, offset),
    }
  })

const getBySlugEffect = (slug: string, mdx: MdxService, includeDrafts = false, readerId?: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const postRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(postsTable)
          .where(
            includeDrafts
              ? eq(postsTable.slug, slug)
              : and(eq(postsTable.slug, slug), readablePosts(db, readerId)),
          )
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    }).pipe(Effect.withSpan('post.getBySlug.query', { attributes: { slug } }))

    const post = postRecords[0]

    if (!post) {
      return yield* new NotFoundError({
        message: 'Post not found',
        resource: 'post',
        id: slug,
      })
    }

    const processedPost = yield* buildPostWithCreators(post, mdx)

    yield* Effect.annotateCurrentSpan('slug', slug)

    yield* Effect.logInfo('[Content] Post retrieved by slug', {
      slug,
      postId: post.id,
    })

    return processedPost
  }).pipe(Effect.withSpan('post.getBySlug', { attributes: { slug } }))

const getEditorialBySlugEffect = (slug: string, mdx: MdxService, readerId?: string) =>
  Effect.gen(function* () {
    const post = yield* getBySlugEffect(slug, mdx, false, readerId)

    return yield* toEditorialPost(post).pipe(
      Effect.mapError(
        () =>
          new NotFoundError({
            message: 'Editorial post not found',
            resource: 'post',
            id: slug,
          }),
      ),
    )
  }).pipe(
    Effect.withSpan('post.getEditorialBySlug', {
      attributes: { 'post.slug': slug },
    }),
  )

const getMicroPostReferenceBySlugEffect = (slug: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: postsTable.id, slug: postsTable.slug })
          .from(postsTable)
          .where(
            and(
              eq(postsTable.slug, slug),
              eq(postsTable.type, 'micro'),
              eq(postsTable.draft, false),
            ),
          )
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch micro post reference: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const post = rows[0]

    if (!post) {
      return yield* new NotFoundError({
        message: 'Micro post not found',
        resource: 'post',
        id: slug,
      })
    }

    return post
  }).pipe(Effect.withSpan('post.getMicroPostReferenceBySlug', { attributes: { slug } }))

const getMicroPostBySlugEffect = (slug: string, mdx: MdxService) =>
  Effect.gen(function* () {
    const db = yield* Database

    const postIds = db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(
        and(eq(postsTable.slug, slug), eq(postsTable.type, 'micro'), eq(postsTable.draft, false)),
      )
      .limit(1)

    const [postRecords, blueskySources, creators, labels, replyCounts] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select()
            .from(postsTable)
            .where(
              and(
                eq(postsTable.slug, slug),
                eq(postsTable.type, 'micro'),
                eq(postsTable.draft, false),
              ),
            )
            .limit(1),
          db
            .select({
              authorDid: blueskyPostSources.authorDid,
              authorHandle: blueskyPostSources.authorHandle,
              publicUrl: blueskyPostSources.publicUrl,
              sourceCreatedAt: blueskyPostSources.sourceCreatedAt,
              sourceStatus: blueskyPostSources.sourceStatus,
              locallyEdited: blueskyPostSources.locallyEdited,
              lastError: blueskyPostSources.lastError,
            })
            .from(blueskyPostSources)
            .where(inArray(blueskyPostSources.postId, postIds))
            .limit(1),
          db
            .select({
              id: usersTable.id,
              name: usersTable.name,
              username: usersTable.username,
              image: usersTable.image,
            })
            .from(postCreators)
            .innerJoin(usersTable, eq(postCreators.creatorId, usersTable.id))
            .where(inArray(postCreators.postId, postIds)),
          db
            .select({ kind: labelsTable.kind, name: labelsTable.name })
            .from(entityLabelsTable)
            .innerJoin(labelsTable, eq(entityLabelsTable.labelId, labelsTable.id))
            .where(
              and(
                eq(entityLabelsTable.entityType, 'post'),
                inArray(entityLabelsTable.entityId, postIds),
              ),
            )
            .orderBy(asc(labelsTable.kind), asc(entityLabelsTable.position)),
          db
            .select({ total: count() })
            .from(postsTable)
            .where(inArray(postsTable.parentPostId, postIds)),
        ]),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch micro post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    }).pipe(Effect.withSpan('post.getMicroPostBySlug.batch'))

    const post = postRecords[0]

    if (!post) {
      return yield* new NotFoundError({
        message: 'Micro post not found',
        resource: 'post',
        id: slug,
      })
    }

    const tags = labels.flatMap((label) => (label.kind === 'tag' ? [label.name] : []))
    const genres = labels.flatMap((label) => (label.kind === 'genre' ? [label.name] : []))

    const projectedPost = {
      ...post,
      tags: tags.length > 0 ? tags : null,
      genres: genres.length > 0 ? genres : null,
    }

    const compiled = {
      ...(yield* compilePost(projectedPost, creators, mdx)),
      replyCount: replyCounts[0]?.total ?? 0,
    }

    const blueskySource = blueskySources[0]
    const enriched = blueskySource ? { ...compiled, blueskySource } : compiled

    return yield* toMicroPost(enriched).pipe(
      Effect.mapError(
        () =>
          new NotFoundError({
            message: 'Micro post not found',
            resource: 'post',
            id: slug,
          }),
      ),
    )
  }).pipe(
    Effect.withSpan('post.getMicroPostBySlug', {
      attributes: { 'post.slug': slug },
    }),
  )

const getTweetCardEntity = (type: string | null, id: string | null) =>
  Effect.gen(function* () {
    if (!id) return null
    const db = yield* Database

    if (type === 'album') {
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              title: musicAlbumsTable.title,
              artists: musicAlbumsTable.artistNames,
              coverImageUrl: musicAlbumsTable.coverImageUrl,
            })
            .from(musicAlbumsTable)
            .where(eq(musicAlbumsTable.id, id))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch tweet album: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'music_albums',
          }),
      })

      const entity = rows[0]

      return entity ? ({ type, ...entity } satisfies TweetCardEntityInput) : null
    }

    if (type === 'track') {
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              title: musicTracksTable.title,
              artists: musicTracksTable.artistNames,
              coverImageUrl: musicTracksTable.coverImageUrl,
            })
            .from(musicTracksTable)
            .where(eq(musicTracksTable.id, id))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch tweet track: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'music_tracks',
          }),
      })

      const entity = rows[0]

      return entity ? ({ type, ...entity } satisfies TweetCardEntityInput) : null
    }

    if (type === 'playlist') {
      const now = new Date(yield* Clock.currentTimeMillis)

      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              title: musicPlaylistsTable.title,
              coverImageUrl: musicPlaylistsTable.coverImageUrl,
            })
            .from(musicPlaylistsTable)
            .where(and(eq(musicPlaylistsTable.id, id), publicPlaylistPredicate(now)))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch tweet playlist: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'music_playlists',
          }),
      })

      const entity = rows[0]

      return entity ? ({ type, ...entity, artists: null } satisfies TweetCardEntityInput) : null
    }

    return null
  })

type TweetCardPost = Pick<
  SelectMdxCompiledPost,
  'slug' | 'title' | 'createdAt' | 'creators' | 'musicEntityType' | 'musicEntityId'
>

const getTweetCardInputEffect = (post: TweetCardPost) =>
  Effect.gen(function* () {
    const creator = post.creators?.[0]
    const db = yield* Database

    const [entity, avatarRows] = yield* Effect.all(
      [
        getTweetCardEntity(post.musicEntityType, post.musicEntityId),
        creator
          ? Effect.tryPromise({
              try: () =>
                db
                  .select({ image: usersTable.image })
                  .from(usersTable)
                  .where(eq(usersTable.id, creator.id))
                  .limit(1),
              catch: (error) =>
                new DatabaseError({
                  message: `Failed to fetch tweet creator avatar: ${getErrorMessage(error)}`,
                  operation: 'select',
                  table: 'user',
                }),
            })
          : Effect.succeed([]),
      ],
      { concurrency: 'unbounded' },
    )

    return {
      slug: post.slug,
      commentary: post.title ?? '',
      createdAt: post.createdAt.toISOString(),
      creator: creator
        ? {
            name: creator.name,
            username: creator.username,
            avatarUrl: avatarRows[0]?.image ?? null,
          }
        : null,
      entity,
    }
  }).pipe(Effect.withSpan('post.getTweetCardInput', { attributes: { slug: post.slug } }))

const getMicroPostScreenMusicEffect = (posts: ReadonlyArray<SelectMdxCompiledMicroPost>) =>
  Effect.gen(function* () {
    const references = posts.flatMap((post) => {
      const { musicEntityId: id, musicEntityType: type } = post

      return id && (type === 'album' || type === 'track' || type === 'playlist')
        ? [{ postId: post.id, id, type } as const]
        : []
    })

    if (references.length === 0) return new Map<string, MicroPostScreenMusic>()

    const db = yield* Database
    const albumIds = references.flatMap(({ id, type }) => (type === 'album' ? [id] : []))
    const trackIds = references.flatMap(({ id, type }) => (type === 'track' ? [id] : []))
    const playlistIds = references.flatMap(({ id, type }) => (type === 'playlist' ? [id] : []))
    const entityIds = references.map(({ id }) => id)
    const now = new Date(yield* Clock.currentTimeMillis)

    const [albums, tracks, playlists, links] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select({
              id: musicAlbumsTable.id,
              title: musicAlbumsTable.title,
              artistNames: musicAlbumsTable.artistNames,
              coverImageUrl: musicAlbumsTable.coverImageUrl,
            })
            .from(musicAlbumsTable)
            .where(inArray(musicAlbumsTable.id, albumIds.length > 0 ? albumIds : [''])),
          db
            .select({
              id: musicTracksTable.id,
              title: musicTracksTable.title,
              artistNames: musicTracksTable.artistNames,
              coverImageUrl: musicTracksTable.coverImageUrl,
            })
            .from(musicTracksTable)
            .where(inArray(musicTracksTable.id, trackIds.length > 0 ? trackIds : [''])),
          db
            .select({
              id: musicPlaylistsTable.id,
              title: musicPlaylistsTable.title,
              coverImageUrl: musicPlaylistsTable.coverImageUrl,
            })
            .from(musicPlaylistsTable)
            .where(
              and(
                inArray(musicPlaylistsTable.id, playlistIds.length > 0 ? playlistIds : ['']),
                publicPlaylistPredicate(now),
              ),
            ),
          db
            .select({
              entityType: musicEntityLinksTable.entityType,
              entityId: musicEntityLinksTable.entityId,
              platform: musicEntityLinksTable.platform,
              url: musicEntityLinksTable.url,
            })
            .from(musicEntityLinksTable)
            .where(
              and(
                inArray(musicEntityLinksTable.entityId, entityIds),
                inArray(musicEntityLinksTable.entityType, ['album', 'track', 'playlist']),
                eq(musicEntityLinksTable.status, LINK_STATUS.VERIFIED),
              ),
            )
            .orderBy(musicEntityLinksTable.platform),
        ]),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to hydrate tweet screen music: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_entities',
        }),
    }).pipe(Effect.withSpan('post.getMicroPostScreenMusic.batch'))

    const entities = new Map<string, MicroPostScreenMusic['entity']>()

    for (const entity of albums) entities.set(`album:${entity.id}`, { type: 'album', ...entity })

    for (const entity of tracks) entities.set(`track:${entity.id}`, { type: 'track', ...entity })

    for (const entity of playlists) {
      entities.set(`playlist:${entity.id}`, { type: 'playlist', artistNames: null, ...entity })
    }

    const linksByEntity = new Map<string, Array<{ platform: string; url: string }>>()

    for (const { entityType, entityId, platform, url } of links) {
      const key = `${entityType}:${entityId}`
      const entityLinks = linksByEntity.get(key) ?? []
      entityLinks.push({ platform, url })
      linksByEntity.set(key, entityLinks)
    }

    const musicByPostId = new Map<string, MicroPostScreenMusic>()

    for (const { postId, type, id } of references) {
      const key = `${type}:${id}`
      const entity = entities.get(key)

      if (entity) musicByPostId.set(postId, { entity, links: linksByEntity.get(key) ?? [] })
    }

    return musicByPostId
  }).pipe(
    Effect.withSpan('post.getMicroPostScreenMusic', { attributes: { postCount: posts.length } }),
  )

const getMicroPostByIdEffect = (id: string, mdx: MdxService) =>
  Effect.gen(function* () {
    const db = yield* Database

    const postRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(postsTable)
          .where(and(eq(postsTable.id, id), eq(postsTable.draft, false)))
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const post = postRecords[0]

    if (!post) {
      return yield* new NotFoundError({
        message: 'Post not found',
        resource: 'post',
        id,
      })
    }

    const compiled = yield* buildPostWithCreators(post, mdx)

    return yield* toMicroPost(compiled).pipe(
      Effect.mapError(
        () =>
          new NotFoundError({
            message: 'Micro post not found',
            resource: 'post',
            id,
          }),
      ),
    )
  }).pipe(Effect.withSpan('post.getMicroPostById', { attributes: { 'post.id': id } }))

// Shared by createEffect and createMicroPostReplyEffect: quoting requires
// the referenced post to exist by id (NotFoundError otherwise) and be a
// micro post specifically (QuotedPostNotEmbeddableError otherwise) -- the
// exact same NotFoundError/type-mismatch split used for reply parents via
// ParentPostNotReplyableError, just keyed by id instead of slug.
const validateQuotedPost = (quotedPostId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const quotedRecords = yield* Effect.tryPromise({
      try: () => db.select().from(postsTable).where(eq(postsTable.id, quotedPostId)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch quoted post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const quoted = quotedRecords[0]

    if (!quoted) {
      return yield* new NotFoundError({
        message: 'Quoted post not found',
        resource: 'post',
        id: quotedPostId,
      })
    }

    if (quoted.type !== 'micro') {
      return yield* new QuotedPostNotEmbeddableError({
        message: 'Only tweets can be quoted',
        quotedPostId,
        quotedPostType: quoted.type ?? 'unknown',
      })
    }

    return undefined
  })

export const generatePostSlug = (title?: string | null, content?: string | null) => {
  const source = isNonBlankString(title) ? title : isNonBlankString(content) ? content : null

  return source ? toSlug(source) : toSlug('post')
}

const createEffect = (
  data: Partial<InsertPost>,
  creatorIds: Array<string>,
  media: MediaPublication,
  actor?: MediaActor,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* authorizeKeyPostWrite(actor, 'posts:create', { ...data, creatorIds })
    const normalizedData = normalizePostData(data, data.type)
    yield* validatePostData(normalizedData)
    yield* validateCanonicalContent(normalizedData.content)

    if (normalizedData.quotedPostId) {
      yield* validateQuotedPost(normalizedData.quotedPostId)
    }

    const publication = yield* media(normalizedData, actor)
    const { tags, ...postData } = publication.data

    const dataWithSlug: InsertPost = {
      ...postData,
      slug: isNonBlankString(normalizedData.slug)
        ? normalizedData.slug
        : generatePostSlug(normalizedData.title, normalizedData.content),
    }

    const id = crypto.randomUUID()

    const result = yield* Effect.tryPromise({
      try: async () => {
        await db.batch([
          actor?.credential?._tag === 'PersonalAccessKey'
            ? db.insert(postsTable).select(
                db
                  .select({
                    id: sql<string>`${id}`.as('id'),
                    description: sql<string | null>`${dataWithSlug.description ?? null}`.as(
                      'description',
                    ),
                    thumbnailUrl: sql<string | null>`${dataWithSlug.thumbnailUrl ?? null}`.as(
                      'thumbnailUrl',
                    ),
                    bannerImageUrl: sql<string | null>`${dataWithSlug.bannerImageUrl ?? null}`.as(
                      'bannerImageUrl',
                    ),
                    slug: sql<string>`${dataWithSlug.slug}`.as('slug'),
                    createdAt: sql<Date>`${Date.now()}`.as('createdAt'),
                    updatedAt: sql<Date>`${Date.now()}`.as('updatedAt'),
                    draft: sql<boolean>`${dataWithSlug.draft ? 1 : 0}`.as('draft'),
                    title: sql<string | null>`${dataWithSlug.title ?? null}`.as('title'),
                    content: sql<string | null>`${dataWithSlug.content ?? null}`.as('content'),
                    type: sql<PostType | null>`${dataWithSlug.type ?? null}`.as('type'),
                    musicEntityType: sql<string | null>`${dataWithSlug.musicEntityType ?? null}`.as(
                      'musicEntityType',
                    ),
                    musicEntityId: sql<string | null>`${dataWithSlug.musicEntityId ?? null}`.as(
                      'musicEntityId',
                    ),
                    lastOperationId: sql`NULL`.as('lastOperationId'),
                    musicReferencesManaged: sql`0`.as('musicReferencesManaged'),
                    parentPostId: sql<string | null>`${dataWithSlug.parentPostId ?? null}`.as(
                      'parentPostId',
                    ),
                    rootPostId: sql<string | null>`${dataWithSlug.rootPostId ?? null}`.as(
                      'rootPostId',
                    ),
                    depth: sql<number>`${dataWithSlug.depth ?? 0}`.as('depth'),
                    quotedPostId: sql<string | null>`${dataWithSlug.quotedPostId ?? null}`.as(
                      'quotedPostId',
                    ),
                  })
                  .from(sql`(SELECT 1)`)
                  .where(sql`NOT EXISTS (SELECT 1 FROM posts WHERE slug = ${dataWithSlug.slug})`),
              )
            : db.insert(postsTable).values({ ...dataWithSlug, id }),
          ...(creatorIds.length > 0
            ? [
                actor?.credential?._tag === 'PersonalAccessKey'
                  ? db.insert(postCreators).select(
                      db
                        .select({
                          postId: postsTable.id,
                          creatorId: sql<string>`${actor.userId}`.as('creator_id'),
                        })
                        .from(postsTable)
                        .where(eq(postsTable.id, id)),
                    )
                  : db
                      .insert(postCreators)
                      .values(creatorIds.map((creatorId) => ({ postId: id, creatorId }))),
              ]
            : []),
        ])
        const rows = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1)
        const post = rows[0]

        if (!post) return null

        if (tags !== undefined) await replaceEntityLabels(db, 'post', post.id, { tags })

        return post
      },
      catch: (error) => {
        const errorMessage = getErrorMessage(error).toLowerCase()

        if (errorMessage.includes('unique constraint')) {
          return new ConflictError({
            message: 'Post with this slug already exists',
            resource: 'post',
          })
        }

        if (errorMessage.includes('foreign key constraint')) {
          return new ConflictError({
            message: 'You may have entered a non-existent creator id',
            resource: 'post',
          })
        }

        return new DatabaseError({
          message: `Failed to create post: ${errorMessage}`,
          operation: 'transaction',
          table: 'posts',
        })
      },
    })

    if (!result)
      return yield* new ConflictError({
        message: 'Post with this slug already exists',
        resource: 'post',
      })

    yield* Effect.annotateCurrentSpan('postId', result.id)
    yield* Effect.annotateCurrentSpan('postType', result.type)
    yield* Effect.annotateCurrentSpan('creatorCount', creatorIds.length)
    yield* Effect.annotateCurrentSpan('tagCount', tags?.length || 0)

    yield* Effect.logInfo('[Content] Post created', {
      postId: result.id,
      title: result.title,
      slug: result.slug,
      type: result.type,
      creatorCount: creatorIds.length,
      tags,
    })

    yield* markAttachedAssets('posts', result.id, [result.thumbnailUrl, result.bannerImageUrl])

    yield* publication.publish

    return yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'post', result),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })
  })

export const deriveReplyThreadFields = (parent: {
  id: string
  rootPostId: string | null
  depth: number
}) => ({
  parentPostId: parent.id,
  rootPostId: parent.rootPostId ?? parent.id,
  depth: parent.depth + 1,
})

const generateReplySlug = () =>
  `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const createMicroPostReplyEffect = (
  options: {
    parentSlug: string
    actorUserId: string
    title?: string | null
    content?: string | null
    musicEntityType?: string | null
    musicEntityId?: string | null
    quotedPostId?: string | null
  },
  mdx: MdxService,
  media: MediaPublication,
) =>
  Effect.gen(function* () {
    const db = yield* Database

    const {
      parentSlug,
      actorUserId,
      title,
      content,
      musicEntityType,
      musicEntityId,
      quotedPostId,
    } = options

    if (quotedPostId) {
      yield* validateQuotedPost(quotedPostId)
    }

    const parentRecords = yield* Effect.tryPromise({
      try: () => db.select().from(postsTable).where(eq(postsTable.slug, parentSlug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch parent post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const parent = parentRecords[0]

    if (!parent) {
      return yield* new NotFoundError({
        message: 'Parent post not found',
        resource: 'post',
        id: parentSlug,
      })
    }

    // Matches getBySlugEffect's public-read visibility policy: a draft is
    // invisible to non-creators, so replying to one fails the same way an
    // ordinary read would (NotFoundError), rather than leaking its existence.
    if (parent.draft) {
      const isCreator = yield* checkCreatorAuthorship('post', parent.id, actorUserId)

      if (!isCreator) {
        return yield* new NotFoundError({
          message: 'Parent post not found',
          resource: 'post',
          id: parentSlug,
        })
      }
    }

    if (parent.type !== 'micro') {
      return yield* new ParentPostNotReplyableError({
        message: 'Replies can only be created on tweets',
        parentSlug,
        parentType: parent.type ?? 'unknown',
      })
    }

    const threadFields = deriveReplyThreadFields(parent)

    const normalizedData = normalizePostData(
      { title, content, type: 'micro' as const },
      'micro' as const,
    )

    yield* validatePostData(normalizedData)
    yield* validateCanonicalContent(normalizedData.content)

    const publication = yield* media(normalizedData, {
      userId: actorUserId,
      userRole: 'user',
      credential: undefined,
    })

    const replyData: InsertPost = {
      ...publication.data,
      type: 'micro',
      slug: generateReplySlug(),
      musicEntityType,
      musicEntityId,
      quotedPostId,
      ...threadFields,
    }

    const id = crypto.randomUUID()

    const result = yield* Effect.tryPromise({
      try: async () => {
        await db.batch([
          db.insert(postsTable).values({ ...replyData, id }),
          db.insert(postCreators).values({ postId: id, creatorId: actorUserId }),
        ])
        const rows = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1)
        const post = rows[0]

        if (!post) throw new Error('Failed to create reply')

        return post
      },
      catch: (error) => {
        const errorMessage = getErrorMessage(error)

        if (errorMessage.includes('unique constraint')) {
          return new ConflictError({
            message: 'Reply with this slug already exists',
            resource: 'post',
          })
        }

        if (errorMessage.includes('foreign key constraint')) {
          return new ConflictError({
            message: 'You may have entered a non-existent creator id',
            resource: 'post',
          })
        }

        return new DatabaseError({
          message: `Failed to create reply: ${errorMessage}`,
          operation: 'transaction',
          table: 'posts',
        })
      },
    })

    yield* Effect.annotateCurrentSpan('postId', result.id)
    yield* publication.publish
    yield* Effect.annotateCurrentSpan('parentPostId', threadFields.parentPostId)
    yield* Effect.annotateCurrentSpan('rootPostId', threadFields.rootPostId)
    yield* Effect.annotateCurrentSpan('depth', threadFields.depth)

    yield* Effect.logInfo('[Content] Reply created', {
      postId: result.id,
      slug: result.slug,
      parentPostId: threadFields.parentPostId,
      rootPostId: threadFields.rootPostId,
      depth: threadFields.depth,
    })

    const compiled = yield* buildPostWithCreators(result, mdx)

    return yield* toMicroPost(compiled).pipe(
      Effect.mapError(
        (error) =>
          new DatabaseError({
            message: `Reply was not created as a micro post: ${error.message}`,
            operation: 'post_type_refinement',
            table: 'posts',
          }),
      ),
    )
  }).pipe(
    Effect.withSpan('post.createMicroPostReply', {
      attributes: { parentSlug: options.parentSlug },
    }),
  )

const getMicroPostRepliesEffect = (
  parentSlug: string,
  options: { limit: number; offset: number },
  mdx: MdxService,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset } = options

    const parentId = db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(eq(postsTable.slug, parentSlug))
      .limit(1)

    const [parentRecords, countResult, data] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          parentId,
          db
            .select({ total: count() })
            .from(postsTable)
            .where(inArray(postsTable.parentPostId, parentId)),
          db
            .select()
            .from(postsTable)
            .where(inArray(postsTable.parentPostId, parentId))
            .orderBy(asc(postsTable.createdAt))
            .limit(limit)
            .offset(offset),
        ]),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch replies: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    }).pipe(Effect.withSpan('post.getMicroPostReplies.batch'))

    if (!parentRecords[0]) {
      return yield* new NotFoundError({
        message: 'Parent post not found',
        resource: 'post',
        id: parentSlug,
      })
    }

    const total = countResult[0]?.total ?? 0

    const postIds = data.map((p) => p.id)
    const { rows: projectedData, creatorsByPostId } = yield* loadPostRelations(data)

    const replyCountsByParentId = yield* fetchReplyCountsByParentId(postIds)

    const compiledData = yield* Effect.forEach(
      projectedData,
      (post) => compilePost(post, creatorsByPostId.get(post.id) ?? [], mdx),
      { concurrency: 5 },
    )

    const sentry = yield* SentryService

    const rawData = yield* Effect.forEach(
      compiledData,
      (post) =>
        toMicroPost(post).pipe(
          Effect.catchTag('DatabaseError', (e) =>
            Effect.andThen(
              sentry.captureException(e, {
                slug: post.slug,
                type: post.type,
                operation: 'toMicroPost',
              }),
              Effect.succeed<SelectMdxCompiledMicroPost | null>(null),
            ),
          ),
        ),
      { concurrency: 5 },
    )

    const filteredData = rawData
      .filter((p): p is SelectMdxCompiledMicroPost => p !== null)
      .map((post) => ({ ...post, replyCount: replyCountsByParentId[post.id] ?? 0 }))

    return {
      data: filteredData,
      pagination: createPaginationMetadata(total, limit, offset),
    }
  }).pipe(Effect.withSpan('post.getMicroPostReplies', { attributes: { parentSlug } }))

const getMicroPostThreadEffect = (
  slug: string,
  options: { limit: number; offset: number },
  mdx: MdxService,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset } = options

    const focusRecords = yield* Effect.tryPromise({
      try: () => db.select().from(postsTable).where(eq(postsTable.slug, slug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch post: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const focusRow = focusRecords[0]

    if (!focusRow) {
      return yield* new NotFoundError({
        message: 'Post not found',
        resource: 'post',
        id: slug,
      })
    }

    const rootId = focusRow.rootPostId ?? focusRow.id

    const rootRow = yield* rootId === focusRow.id
      ? Effect.succeed(focusRow)
      : Effect.gen(function* () {
          const rootRecords = yield* Effect.tryPromise({
            try: () => db.select().from(postsTable).where(eq(postsTable.id, rootId)).limit(1),
            catch: (error) =>
              new DatabaseError({
                message: `Failed to fetch root post: ${getErrorMessage(error)}`,
                operation: 'select',
                table: 'posts',
              }),
          })

          const row = rootRecords[0]

          if (!row) {
            return yield* new NotFoundError({
              message: 'Root post not found',
              resource: 'post',
              id: rootId,
            })
          }

          return row
        })

    const whereCondition = eq(postsTable.rootPostId, rootId)

    const countResult = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () => db.select({ total: count() }).from(postsTable).where(whereCondition),
          'get-micro-post-thread-count',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to count thread posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const total = countResult[0]?.total ?? 0

    const descendantRows = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () =>
            db
              .select()
              .from(postsTable)
              .where(whereCondition)
              .orderBy(asc(postsTable.createdAt))
              .limit(limit)
              .offset(offset),
          'get-micro-post-thread-data',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch thread posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    // Root/focus may also occur in the page. Project each identity once, including
    // across label-query chunks, without changing the returned page order.
    const rowsToCompile = [
      ...new Map([rootRow, focusRow, ...descendantRows].map((post) => [post.id, post])).values(),
    ]

    const { rows: projectedRows, creatorsByPostId } = yield* loadPostRelations(rowsToCompile)

    const sentry = yield* SentryService

    const compileRow = (post: SelectPost) =>
      compilePost(post, creatorsByPostId.get(post.id) ?? [], mdx).pipe(
        Effect.flatMap((compiled) =>
          toMicroPost(compiled).pipe(
            Effect.catchTag('DatabaseError', (e) =>
              Effect.andThen(
                sentry.captureException(e, {
                  slug: compiled.slug,
                  type: compiled.type,
                  operation: 'toMicroPost',
                }),
                Effect.succeed<SelectMdxCompiledMicroPost | null>(null),
              ),
            ),
          ),
        ),
      )

    const compiledRows = yield* Effect.forEach(projectedRows, compileRow, { concurrency: 5 })

    const compiledById = new Map(
      compiledRows.flatMap((post) => (post ? [[post.id, post] as const] : [])),
    )

    const root = compiledById.get(rootRow.id)

    if (!root) {
      return yield* new DatabaseError({
        message: `Root post was not a micro post: ${rootRow.slug}`,
        operation: 'post_type_refinement',
        table: 'posts',
      })
    }

    const focus = compiledById.get(focusRow.id)

    if (!focus) {
      return yield* new DatabaseError({
        message: `Focus post was not a micro post: ${focusRow.slug}`,
        operation: 'post_type_refinement',
        table: 'posts',
      })
    }

    const posts = descendantRows.flatMap((row) => {
      const post = compiledById.get(row.id)

      return post ? [post] : []
    })

    return {
      root,
      focus,
      posts,
      pagination: createPaginationMetadata(total, limit, offset),
    }
  }).pipe(Effect.withSpan('post.getMicroPostThread', { attributes: { slug } }))

const updateEffect = (
  slug: string,
  userId: string,
  userRole: string,
  rawData: Partial<InsertPost> & { creatorIds?: Array<string>; expectedUpdatedAt?: Date },
  mdx: MdxService,
  media: MediaPublication,
  credential?: Actor['credential'],
) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(postsTable).where(eq(postsTable.slug, slug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check post existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const existingPost = existingRecords[0]

    if (!existingPost) {
      return yield* new NotFoundError({
        message: 'Post not found',
        resource: 'post',
        id: slug,
      })
    }

    const actor = { userId, userRole, credential }

    if (credential?._tag === 'PersonalAccessKey') {
      if (!(yield* checkCreatorAuthorship('post', existingPost.id, userId)))
        return yield* new NotFoundError({ message: 'Post not found', resource: 'post', id: slug })
      yield* authorizeKeyPostWrite(actor, 'posts:update', rawData, existingPost.draft)

      if (rawData.type !== undefined && rawData.type !== existingPost.type)
        return yield* new KeyAccessDenied()
    } else {
      yield* requireCreatorOrAdmin('post', existingPost.id, userId, userRole)
    }

    if (
      rawData.expectedUpdatedAt &&
      rawData.expectedUpdatedAt.getTime() !== existingPost.updatedAt.getTime()
    )
      return yield* new ConflictError({
        message: 'Post changed since it was loaded',
        resource: 'post',
      })

    yield* validateCanonicalContent(rawData.content)

    // A legacy primary edit may not bypass the deliberate collection's published freeze.
    if (
      existingPost.musicReferencesManaged &&
      !existingPost.draft &&
      (rawData.musicEntityId !== undefined || rawData.musicEntityType !== undefined)
    )
      return yield* new ValidationError({
        message: 'Managed published music associations are frozen',
      })

    if ((rawData.musicEntityId === undefined) !== (rawData.musicEntityType === undefined))
      return yield* new ValidationError({
        message: 'Music primary must be supplied as a complete pair',
      })

    // Thread structure (parentPostId/rootPostId/depth) must never be
    // mutable via update, even though InsertPost's type allows it -- the
    // HTTP schema (UpdatePostInput) already omits these fields, but this
    // strip is defense-in-depth against a future caller that bypasses it.
    const {
      parentPostId: _parentPostId,
      rootPostId: _rootPostId,
      depth: _depth,
      expectedUpdatedAt,
      ...data
    } = rawData

    const nextPostData = { ...existingPost, ...data }
    const normalizedNextPostData = normalizePostData(nextPostData, nextPostData.type)
    yield* validatePostData(normalizedNextPostData)

    const { creatorIds, tags, ...updateData } = data

    const publication = yield* media(
      normalizePostData(updateData, nextPostData.type),
      actor,
      existingPost,
    )

    const normalizedUpdateData = publication.data
    let updatedPost = existingPost
    const config = yield* ConfigService

    const nextMedia = { ...existingPost, ...normalizedUpdateData }

    const assetKeys = attachedMediaUrls(nextMedia).flatMap((url) => {
      const key = url ? keyFromAssetUrl(url, config.urls.bucketRouter) : null

      return key === null
        ? []
        : [key.startsWith('public/') ? `private/${key.slice('public/'.length)}` : key]
    })

    if (
      Object.keys(normalizedUpdateData).length > 0 ||
      tags !== undefined ||
      (creatorIds !== undefined && creatorIds.length > 0) ||
      credential?._tag === 'PersonalAccessKey' ||
      expectedUpdatedAt !== undefined
    ) {
      const updatedRecords = yield* Effect.tryPromise({
        try: () =>
          guardedPostUpdate(db, existingPost, userId, normalizedUpdateData, tags, assetKeys, {
            allowAdmin: credential?._tag !== 'PersonalAccessKey' && userRole === 'admin',
            creatorIds,
          }),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to update post: ${getErrorMessage(error)}`,
            operation: 'update',
            table: 'posts',
          }),
      })

      if (!updatedRecords[0]) {
        return yield* new ConflictError({
          message: 'Post changed during update',
          resource: 'post',
        })
      }

      updatedPost = updatedRecords[0]
    }

    yield* publication.publish

    return yield* buildPostWithCreators(updatedPost, mdx)
  })

export const PostServiceLayer = Layer.effect(
  PostService,
  Effect.gen(function* () {
    const db = yield* Database
    const mdx = yield* MdxService
    const config = yield* ConfigService
    const uploadAssetService = yield* UploadAssetService
    const store = yield* ObjectStoreClient
    const media = makeMediaPublication(config, store)
    const provideDb = Effect.provideService(Database, db)

    return {
      getSourcesForEdit: (opts, reader) => provideDb(getSourcesForEditEffect(opts, reader)),
      getSourceById: (postId, access) => provideDb(getSourceByIdEffect(postId, access)),
      getAll: (opts) => provideDb(getAllEffect(opts, mdx)),
      getAllForEdit: (opts, userId, userRole, access) =>
        provideDb(getAllEffect(opts, mdx, { userId, userRole, access })),
      getBySlug: (slug) => provideDb(getBySlugEffect(slug, mdx)),
      getBySlugForEdit: (slug, userId, userRole, access) =>
        provideDb(
          Effect.gen(function* () {
            if (access === 'owned') {
              const rows = yield* Effect.tryPromise({
                try: () =>
                  db
                    .select({ id: postsTable.id })
                    .from(postsTable)
                    .where(and(eq(postsTable.slug, slug), postIdsForCreator(db, userId)))
                    .limit(1),
                catch: () =>
                  new DatabaseError({
                    message: 'Could not read owned post',
                    operation: 'select',
                    table: 'posts',
                  }),
              })

              if (!rows.length)
                return yield* new NotFoundError({
                  message: 'Post not found',
                  resource: 'post',
                  id: slug,
                })
            }

            const post = yield* getBySlugEffect(slug, mdx, true)

            if (access === 'owned' && !(yield* checkCreatorAuthorship('post', post.id, userId))) {
              return yield* new NotFoundError({
                message: 'Post not found',
                resource: 'post',
                id: slug,
              })
            }

            yield* requireCreatorOrAdmin('post', post.id, userId, userRole)

            return post
          }),
        ),
      getEditorials: (opts) => provideDb(getEditorialsEffect(opts, mdx)),
      getEditorialSummaries: (opts) => provideDb(getEditorialSummariesEffect(opts)),
      getEditorialBySlug: (slug, readerId) =>
        provideDb(getEditorialBySlugEffect(slug, mdx, readerId)),
      getMicroPosts: (opts) => provideDb(getMicroPostsEffect(opts, mdx)),
      getLatestMicroPost: provideDb(getLatestMicroPostEffect),
      getMicroPostBySlug: (slug) => provideDb(getMicroPostBySlugEffect(slug, mdx)),
      getTweetCardInput: (post) => provideDb(getTweetCardInputEffect(post)),
      getMicroPostReferenceBySlug: (slug) => provideDb(getMicroPostReferenceBySlugEffect(slug)),
      getMicroPostById: (id) => provideDb(getMicroPostByIdEffect(id, mdx)),
      getMicroPostScreenMusic: (posts) => provideDb(getMicroPostScreenMusicEffect(posts)),
      getPostTags: () => provideDb(getPostTagsEffect()),
      getEditorialTags: () => provideDb(getEditorialTagsEffect()),
      getMicroTags: () => provideDb(getMicroTagsEffect()),
      getAdjacentMicroPosts: (slug) => provideDb(getAdjacentMicroPostsEffect(slug)),
      getRandomMicroPost: (excludeSlugs) => provideDb(getRandomMicroPostEffect(excludeSlugs)),
      searchMicroPosts: (opts) => provideDb(searchMicroPostsEffect(opts, mdx)),
      getByTag: (tag, opts) => provideDb(getByTagEffect(tag, opts)),
      create: (data, creatorIds, actor) =>
        provideDb(createEffect(data, creatorIds, media, actor)).pipe(
          Effect.provideService(ConfigService, config),
          Effect.provideService(UploadAssetService, uploadAssetService),
        ),
      createMicroPostReply: (opts) => provideDb(createMicroPostReplyEffect(opts, mdx, media)),
      getMicroPostReplies: (parentSlug, opts) =>
        provideDb(getMicroPostRepliesEffect(parentSlug, opts, mdx)),
      getMicroPostThread: (slug, opts) => provideDb(getMicroPostThreadEffect(slug, opts, mdx)),
      update: (slug, userId, userRole, data, credential) =>
        provideDb(updateEffect(slug, userId, userRole, data, mdx, media, credential)).pipe(
          Effect.provideService(ConfigService, config),
          Effect.provideService(UploadAssetService, uploadAssetService),
        ),
      renderPreview: (content) => mdx.render(content),
    }
  }),
)
