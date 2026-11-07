import type { UserId } from '@gbfm/core/identity'
import { and, eq, exists, inArray, sql, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import type { DatabaseClient } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'

import type { CreateDraftInput, UpdateDraftInput } from './contracts'
import { saveEditorialChange } from './editorial-music/save'
import type { EditorialSnapshot } from './editorial-music/snapshot'

type Receipt = typeof editorialOperations.$inferInsert & { readonly result: string }

const insertReceipt = (db: DatabaseClient, receipt: Receipt, winner: SQL) =>
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
      .where(and(eq(postsTable.id, receipt.postId), winner)),
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
) => {
  const attemptId = crypto.randomUUID()
  const winner = eq(postsTable.lastOperationId, attemptId)

  return db.batch([
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
            lastOperationId: sql<string>`${attemptId}`.as('lastOperationId'),
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
        .where(and(eq(postsTable.id, id), winner)),
    ),
    insertReceipt(db, receipt, winner),
    db
      .select({
        assertion: sql<number>`CASE WHEN NOT EXISTS (
      SELECT 1 FROM ${postsTable} WHERE ${postsTable.id} = ${id} AND ${winner}
    ) OR EXISTS (SELECT 1 FROM ${editorialOperations} WHERE ${editorialOperations.id} = ${receipt.id}
      AND ${editorialOperations.inputHash} = ${receipt.inputHash}) THEN 1 ELSE json('editorial create receipt assertion failed') END`,
      })
      .from(sql`(SELECT 1)`),
  ])
}

export const updateEditorialDraft = (
  db: DatabaseClient,
  userId: UserId,
  previous: EditorialSnapshot,
  input: typeof UpdateDraftInput.Type,
  now: Date,
  receipt: Receipt,
) =>
  Effect.runPromise(
    saveEditorialChange(
      db,
      userId,
      previous,
      {
        title: input.title,
        content: input.content,
        description: input.description,
      },
      { ...receipt, createdAt: now },
    ),
  )
