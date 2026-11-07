import type { PostId } from '@gbfm/core/editorial-mcp'
import type { UserId } from '@gbfm/core/identity'
import { DraftMusicReferences, draftMusicTargetKey } from '@gbfm/core/post-music-references'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { decodePostMusicReferenceState } from '@/db/guarded-post-update'
import type { DatabaseClient } from '@/db/layer'
import { postMusicReferencesTable } from '@/db/post-music-reference.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'

import { PersistedPost, notFound, unavailable } from '../model'

/** Coherent private source, including unscoped version inputs and the physical CAS winner. */
export const EditorialSnapshot = Schema.Struct({
  ...PersistedPost.fields,
  musicReferencesManaged: Schema.Boolean,
  musicReferences: DraftMusicReferences,
  storedMusicReferences: DraftMusicReferences,
  lastOperationId: Schema.NullOr(Schema.String),
})

export type EditorialSnapshot = typeof EditorialSnapshot.Type

/** Read the post and every version-bearing relation in one D1 batch snapshot. No rendering or providers. */
export const loadEditorialSnapshot = (db: DatabaseClient, postId: PostId) =>
  Effect.gen(function* () {
    const [posts, creators, tags, rows] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db.select().from(postsTable).where(eq(postsTable.id, postId)).limit(1),
          db
            .select({ id: postCreators.creatorId })
            .from(postCreators)
            .where(eq(postCreators.postId, postId)),
          db
            .select({ name: labelsTable.name })
            .from(entityLabelsTable)
            .innerJoin(labelsTable, eq(labelsTable.id, entityLabelsTable.labelId))
            .where(
              and(
                eq(entityLabelsTable.entityType, 'post'),
                eq(entityLabelsTable.entityId, postId),
                eq(labelsTable.kind, 'tag'),
              ),
            ),
          db
            .select()
            .from(postMusicReferencesTable)
            .where(eq(postMusicReferencesTable.postId, postId))
            .orderBy(asc(postMusicReferencesTable.position)),
        ]),
      catch: unavailable,
    })

    const post = posts[0]

    if (!post) return yield* notFound()

    const { storedMusicReferences, musicReferences } = yield* decodePostMusicReferenceState(
      post,
      rows,
    ).pipe(Effect.mapError(unavailable))

    return yield* Schema.decodeUnknownEffect(EditorialSnapshot)({
      ...post,
      creators,
      tags: tags.map((tag) => tag.name),
      musicReferences,
      storedMusicReferences,
    }).pipe(Effect.mapError(unavailable))
  })

/** Coherent authored-or-public editorial source, not a public-safe projection of catalogue display. */
export const loadReadableEditorialSnapshot = (
  db: DatabaseClient,
  postId: PostId,
  actorId: UserId,
) =>
  loadEditorialSnapshot(db, postId).pipe(
    Effect.flatMap((post) =>
      post.type !== 'micro' &&
      (!post.draft || post.creators?.some((creator) => creator.id === actorId))
        ? Effect.succeed(post)
        : Effect.fail(notFound()),
    ),
  )

/** Full source CAS, independent of scope/display. The predicate is evaluated only before mutation. */
export const editorialSnapshotGuard = (previous: EditorialSnapshot) => {
  const creators = (previous.creators ?? []).map((creator) => creator.id).toSorted()
  const tags = (previous.tags ?? []).toSorted()

  const references = previous.storedMusicReferences.references.map((target, position) => ({
    ...target,
    primary:
      previous.storedMusicReferences.primary !== null &&
      draftMusicTargetKey(target) === draftMusicTargetKey(previous.storedMusicReferences.primary),
    position,
  }))

  const stored = sql`coalesce((SELECT json_group_array(json_object(
    'entityType', CASE WHEN album_id IS NOT NULL THEN 'album' WHEN track_id IS NOT NULL THEN 'track' ELSE 'playlist' END,
    'entityId', coalesce(album_id, track_id, playlist_id), 'primary', json(CASE WHEN is_primary = 1 THEN 'true' ELSE 'false' END), 'position', position))
    FROM (SELECT * FROM post_music_references WHERE post_id = ${previous.id} ORDER BY position)), '[]')`

  return and(
    eq(postsTable.draft, previous.draft),
    sql`${postsTable.type} IS ${previous.type}`,
    eq(postsTable.slug, previous.slug),
    sql`${postsTable.title} IS ${previous.title}`,
    sql`${postsTable.content} IS ${previous.content}`,
    sql`${postsTable.description} IS ${previous.description}`,
    eq(postsTable.createdAt, previous.createdAt),
    eq(postsTable.updatedAt, previous.updatedAt),
    sql`${postsTable.thumbnailUrl} IS ${previous.thumbnailUrl}`,
    sql`${postsTable.bannerImageUrl} IS ${previous.bannerImageUrl}`,
    sql`${postsTable.musicEntityType} IS ${previous.musicEntityType}`,
    sql`${postsTable.musicEntityId} IS ${previous.musicEntityId}`,
    sql`${postsTable.parentPostId} IS ${previous.parentPostId}`,
    sql`${postsTable.rootPostId} IS ${previous.rootPostId}`,
    sql`${postsTable.quotedPostId} IS ${previous.quotedPostId}`,
    eq(postsTable.depth, previous.depth),
    eq(postsTable.musicReferencesManaged, previous.musicReferencesManaged),
    sql`${postsTable.lastOperationId} IS ${previous.lastOperationId}`,
    sql`(SELECT json_group_array(creatorId) FROM (SELECT creatorId FROM post_creators WHERE postId = ${previous.id} ORDER BY creatorId)) = ${JSON.stringify(creators)}`,
    sql`(SELECT json_group_array(name) FROM (SELECT ${labelsTable.name} AS name FROM ${entityLabelsTable}
      INNER JOIN ${labelsTable} ON ${labelsTable.id} = ${entityLabelsTable.labelId}
      WHERE ${entityLabelsTable.entityType} = 'post' AND ${entityLabelsTable.entityId} = ${previous.id}
      AND ${labelsTable.kind} = 'tag' ORDER BY ${labelsTable.name})) = ${JSON.stringify(tags)}`,
    sql`${stored} = ${JSON.stringify(references)}`,
  )
}
