import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { DatabaseError, getErrorMessage, NotFoundError } from '@/errors'

export interface EditorialMetadata {
  readonly type: 'post'
  readonly slug: string
  readonly title: string
  readonly description: string | null
  readonly thumbnailUrl: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly creators: Array<{ readonly name: string }>
}

const whitespace =
  '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'

export const getEditorialMetadataBySlug = (
  slug: string,
): Effect.Effect<EditorialMetadata, DatabaseError | NotFoundError, Database> =>
  Effect.gen(function* () {
    const db = yield* Database

    const editorial = db
      .select({
        id: postsTable.id,
        type: postsTable.type,
        slug: postsTable.slug,
        title: postsTable.title,
        description: postsTable.description,
        thumbnailUrl: postsTable.thumbnailUrl,
        createdAt: postsTable.createdAt,
        updatedAt: postsTable.updatedAt,
        contentLength: sql<number>`length(trim(${postsTable.content}, ${whitespace}))`.as(
          'content_length',
        ),
      })
      .from(postsTable)
      .where(and(eq(postsTable.slug, slug), eq(postsTable.draft, false)))
      .limit(1)
      .as('editorial')

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            type: editorial.type,
            slug: editorial.slug,
            title: editorial.title,
            description: editorial.description,
            thumbnailUrl: editorial.thumbnailUrl,
            createdAt: editorial.createdAt,
            updatedAt: editorial.updatedAt,
            contentLength: editorial.contentLength,
            creatorName: user.name,
          })
          .from(editorial)
          .leftJoin(postCreators, eq(postCreators.postId, editorial.id))
          .leftJoin(user, eq(postCreators.creatorId, user.id)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch editorial metadata: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const post = rows[0]

    if (!post || post.type !== 'post' || !post.title?.trim() || !(post.contentLength > 0)) {
      return yield* new NotFoundError({
        message: 'Editorial post not found',
        resource: 'post',
        id: slug,
      })
    }

    return {
      type: 'post',
      slug: post.slug,
      title: post.title,
      description: post.description,
      thumbnailUrl: post.thumbnailUrl,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      creators: rows.flatMap(({ creatorName }) =>
        creatorName === null ? [] : [{ name: creatorName }],
      ),
    } satisfies EditorialMetadata
  }).pipe(Effect.withSpan('post.getEditorialMetadataBySlug'))
