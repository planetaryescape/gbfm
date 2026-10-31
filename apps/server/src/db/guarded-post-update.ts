import { and, eq, exists, inArray, sql } from 'drizzle-orm'

import { postIdsForCreator } from './creator-membership'
import type { DatabaseClient } from './layer'
import { postsTable, type InsertPost } from './post.schema'
import { entityLabelsTable, labelsTable } from './tags.schema'
import { uploadAssetsTable } from './upload-asset.schema'

export const guardedPostUpdate = async (
  db: DatabaseClient,
  existing: typeof postsTable.$inferSelect,
  userId: string,
  data: Partial<InsertPost>,
  tags: ReadonlyArray<string> | undefined,
  assetKeys: ReadonlyArray<string>,
) => {
  const predicate = and(
    eq(postsTable.id, existing.id),
    eq(postsTable.updatedAt, existing.updatedAt),
    eq(postsTable.draft, existing.draft),
    postIdsForCreator(db, userId),
  )

  const authorized = exists(db.select({ id: postsTable.id }).from(postsTable).where(predicate))
  const names = [...new Set(tags)]

  const labelWrites =
    tags === undefined
      ? []
      : [
          db
            .delete(entityLabelsTable)
            .where(
              and(
                eq(entityLabelsTable.entityType, 'post'),
                eq(entityLabelsTable.entityId, existing.id),
                authorized,
              ),
            ),
          ...names.flatMap((name, position) => [
            db
              .insert(labelsTable)
              .select(
                db
                  .select({
                    id: sql<string>`${crypto.randomUUID()}`.as('id'),
                    kind: sql<'tag'>`'tag'`.as('kind'),
                    name: sql<string>`${name}`.as('name'),
                  })
                  .from(sql`(SELECT 1)`)
                  .where(authorized),
              )
              .onConflictDoNothing(),
            db.insert(entityLabelsTable).select(
              db
                .select({
                  entityType: sql<'post'>`'post'`.as('entity_type'),
                  entityId: sql<string>`${existing.id}`.as('entity_id'),
                  position: sql<number>`${position}`.as('position'),
                  labelId: labelsTable.id,
                })
                .from(labelsTable)
                .where(and(eq(labelsTable.kind, 'tag'), eq(labelsTable.name, name), authorized)),
            ),
          ]),
        ]

  // Keep the post update last: every dependent write checks the original state in this transaction.
  const results = await db.batch([
    db
      .update(uploadAssetsTable)
      .set({ status: 'attached', attachedToTable: 'posts', attachedToId: existing.id })
      .where(
        and(
          inArray(uploadAssetsTable.key, [...assetKeys]),
          eq(uploadAssetsTable.status, 'uploaded'),
          authorized,
        ),
      ),
    ...labelWrites,
    db
      .update(postsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(predicate)
      .returning(),
  ])

  const updated = results.at(-1)

  return Array.isArray(updated) ? updated : []
}
