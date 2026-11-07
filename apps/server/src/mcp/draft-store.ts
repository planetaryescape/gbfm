import type { UserId } from '@gbfm/core/identity'
import { and, eq, exists, inArray, sql } from 'drizzle-orm'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import type { DatabaseClient } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'

import type { CreateDraftInput, UpdateDraftInput } from './contracts'
import type { PersistedPost } from './model'

type Receipt = typeof editorialOperations.$inferInsert & { readonly result: string }

const insertReceipt = (db: DatabaseClient, receipt: Receipt) =>
  db.insert(editorialOperations).select(
    db
      .select({
        id: sql<string>`${receipt.id}`.as('id'),
        actorId: sql<string>`${receipt.actorId}`.as('actor_id'),
        postId: sql<string>`${receipt.postId}`.as('post_id'),
        inputHash: sql<string>`${receipt.inputHash}`.as('input_hash'),
        result: sql<string>`${receipt.result}`.as('result'),
        createdAt: sql<Date>`${receipt.createdAt.getTime()}`.as('created_at'),
      })
      .from(postsTable)
      .where(and(eq(postsTable.id, receipt.postId), sql`changes() > 0`)),
  )

const unusedOperation = (id: string) => sql`NOT EXISTS (
  SELECT 1 FROM ${editorialOperations} WHERE ${editorialOperations.id} = ${id}
)`

export const readEditorialReceipt = (db: DatabaseClient, id: string, actorId: UserId) =>
  db
    .select()
    .from(editorialOperations)
    .where(and(eq(editorialOperations.id, id), eq(editorialOperations.actorId, actorId)))
    .limit(1)

const eligibleAccount = (db: DatabaseClient, userId: UserId) =>
  exists(
    db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.id, userId),
          inArray(user.role, ['creator', 'editor', 'admin']),
          sql`coalesce(${user.banned}, 0) = 0`,
        ),
      ),
  )

export const insertEditorialDraft = (
  db: DatabaseClient,
  userId: UserId,
  id: string,
  input: typeof CreateDraftInput.Type,
  now: Date,
  receipt: Receipt,
) =>
  db.batch([
    db
      .insert(postsTable)
      .select(
        db
          .select({
            id: sql<string>`${id}`.as('id'),
            description: sql<string | null>`${input.description ?? null}`.as('description'),
            thumbnailUrl: sql`NULL`.as('thumbnailUrl'),
            bannerImageUrl: sql`NULL`.as('bannerImageUrl'),
            slug: sql<string>`${id}`.as('slug'),
            createdAt: sql`${now.getTime()}`.as('createdAt'),
            updatedAt: sql`${now.getTime()}`.as('updatedAt'),
            draft: sql`1`.as('draft'),
            title: sql<string>`${input.title}`.as('title'),
            content: sql<string>`${input.content}`.as('content'),
            type: sql`'post'`.as('type'),
            musicEntityType: sql`NULL`.as('musicEntityType'),
            musicEntityId: sql`NULL`.as('musicEntityId'),
            lastOperationId: sql`NULL`.as('lastOperationId'),
            musicReferencesManaged: sql`0`.as('musicReferencesManaged'),
            parentPostId: sql`NULL`.as('parentPostId'),
            rootPostId: sql`NULL`.as('rootPostId'),
            depth: sql`0`.as('depth'),
            quotedPostId: sql`NULL`.as('quotedPostId'),
          })
          .from(user)
          .where(
            and(
              eq(user.id, userId),
              eligibleAccount(db, userId),
              unusedOperation(receipt.id),
              sql`NOT EXISTS (SELECT 1 FROM posts WHERE slug = ${id} AND id <> ${id})`,
            ),
          ),
      )
      .onConflictDoNothing(),
    db.insert(postCreators).select(
      db
        .select({
          postId: sql<string>`${id}`.as('postId'),
          creatorId: sql<string>`${userId}`.as('creatorId'),
        })
        .from(postsTable)
        .where(and(eq(postsTable.id, id), sql`changes() > 0`)),
    ),
    insertReceipt(db, receipt),
  ])

export const updateEditorialDraft = (
  db: DatabaseClient,
  userId: UserId,
  previous: typeof PersistedPost.Type,
  input: typeof UpdateDraftInput.Type,
  now: Date,
  receipt: Receipt,
) => {
  const creators = (previous.creators ?? []).map((creator) => creator.id)
  const tags = previous.tags ?? []

  const predicate = and(
    eq(postsTable.id, previous.id),
    eq(postsTable.draft, true),
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
    eligibleAccount(db, userId),
    unusedOperation(receipt.id),
    exists(
      db
        .select()
        .from(postCreators)
        .where(and(eq(postCreators.postId, previous.id), eq(postCreators.creatorId, userId))),
    ),
    sql`(SELECT count(*) FROM ${postCreators} WHERE ${postCreators.postId} = ${previous.id}) = ${creators.length}`,
    sql`NOT EXISTS (SELECT 1 FROM ${postCreators}
      WHERE ${postCreators.postId} = ${previous.id}
      AND ${postCreators.creatorId} NOT IN (SELECT value FROM json_each(${JSON.stringify(creators)})))`,
    sql`(SELECT count(*) FROM ${entityLabelsTable}
      INNER JOIN ${labelsTable} ON ${labelsTable.id} = ${entityLabelsTable.labelId}
      WHERE ${entityLabelsTable.entityType} = 'post' AND ${entityLabelsTable.entityId} = ${previous.id}
      AND ${labelsTable.kind} = 'tag') = ${tags.length}`,
    sql`NOT EXISTS (SELECT 1 FROM ${entityLabelsTable}
      INNER JOIN ${labelsTable} ON ${labelsTable.id} = ${entityLabelsTable.labelId}
      WHERE ${entityLabelsTable.entityType} = 'post' AND ${entityLabelsTable.entityId} = ${previous.id}
      AND ${labelsTable.kind} = 'tag'
      AND ${labelsTable.name} NOT IN (SELECT value FROM json_each(${JSON.stringify(tags)})))`,
  )

  const update = db
    .update(postsTable)
    .set({
      title: input.title,
      content: input.content,
      description: input.description,
      updatedAt: now,
    })
    .where(predicate)
    .returning({ id: postsTable.id })

  return db.batch([update, insertReceipt(db, receipt)])
}
