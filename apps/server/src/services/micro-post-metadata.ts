import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { postCreators, postsTable, type SelectMdxCompiledMicroPost } from '@/db/post.schema'
import { DatabaseError, getErrorMessage, NotFoundError } from '@/errors'

export type MicroPostMetadata = Pick<
  SelectMdxCompiledMicroPost,
  | 'type'
  | 'slug'
  | 'title'
  | 'description'
  | 'thumbnailUrl'
  | 'createdAt'
  | 'updatedAt'
  | 'musicEntityType'
  | 'musicEntityId'
  | 'creators'
>

export const getMicroPostMetadataBySlug = (
  slug: string,
): Effect.Effect<MicroPostMetadata, DatabaseError | NotFoundError, Database> =>
  Effect.gen(function* () {
    const db = yield* Database

    const publishedPost = and(
      eq(postsTable.slug, slug),
      eq(postsTable.type, 'micro'),
      eq(postsTable.draft, false),
    )

    const postIds = db.select({ id: postsTable.id }).from(postsTable).where(publishedPost).limit(1)

    const [posts, creators] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select({
              slug: postsTable.slug,
              title: postsTable.title,
              description: postsTable.description,
              thumbnailUrl: postsTable.thumbnailUrl,
              createdAt: postsTable.createdAt,
              updatedAt: postsTable.updatedAt,
              musicEntityType: postsTable.musicEntityType,
              musicEntityId: postsTable.musicEntityId,
            })
            .from(postsTable)
            .where(publishedPost)
            .limit(1),
          db
            .select({ id: user.id, name: user.name, username: user.username, image: user.image })
            .from(postCreators)
            .innerJoin(user, eq(postCreators.creatorId, user.id))
            .where(inArray(postCreators.postId, postIds)),
        ]),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch micro post metadata: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    const post = posts[0]

    if (!post) {
      return yield* new NotFoundError({
        message: 'Micro post not found',
        resource: 'post',
        id: slug,
      })
    }

    const metadata: MicroPostMetadata = { ...post, type: 'micro', creators }

    return metadata
  }).pipe(Effect.withSpan('post.getMicroPostMetadataBySlug'))
