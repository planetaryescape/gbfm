import { and, eq, inArray, notExists, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'

import { canonicalContentTags, contentTagGroups } from '@/lib/content-tags'
import { microPostTags } from '@/lib/micro-tags'

import { audioTable } from './audio.schema'
import { guardedPostUpdate } from './guarded-post-update'
import { readEntityLabels } from './labels'
import type { DatabaseClient } from './layer'
import { postsTable } from './post.schema'
import { showsTable } from './show.schema'
import { entityLabelsTable, labelsTable } from './tags.schema'

const contentTypes: Array<'post' | 'audio' | 'show'> = ['post', 'audio', 'show']

export const snapshotContentTagBindings = (db: DatabaseClient) =>
  db
    .select({
      labelId: labelsTable.id,
      tag: labelsTable.name,
      entityType: entityLabelsTable.entityType,
      entityId: entityLabelsTable.entityId,
      position: entityLabelsTable.position,
    })
    .from(labelsTable)
    .innerJoin(entityLabelsTable, eq(entityLabelsTable.labelId, labelsTable.id))
    .where(
      and(
        eq(labelsTable.kind, 'tag'),
        inArray(
          labelsTable.name,
          contentTagGroups.flatMap((group) => group.aliases),
        ),
        inArray(entityLabelsTable.entityType, contentTypes),
      ),
    )
    .limit(10_001)

export const inspectContentTagMerges = (db: DatabaseClient) =>
  db
    .select({
      tag: labelsTable.name,
      entityType: entityLabelsTable.entityType,
      count: sql<number>`count(*)`,
    })
    .from(labelsTable)
    .innerJoin(entityLabelsTable, eq(entityLabelsTable.labelId, labelsTable.id))
    .where(
      and(
        eq(labelsTable.kind, 'tag'),
        inArray(
          labelsTable.name,
          contentTagGroups.flatMap((group) => group.aliases),
        ),
        inArray(entityLabelsTable.entityType, contentTypes),
      ),
    )
    .groupBy(labelsTable.name, entityLabelsTable.entityType)

export const mergeContentTags = async (db: DatabaseClient, now: Date) => {
  const statements: Array<BatchItem<'sqlite'>> = []

  for (const group of contentTagGroups) {
    const aliases = group.aliases.filter((name) => name !== group.name)

    const sourceIds = db
      .select({ id: labelsTable.id })
      .from(labelsTable)
      .where(and(eq(labelsTable.kind, 'tag'), inArray(labelsTable.name, aliases)))

    const affected = (type: 'post' | 'audio' | 'show') =>
      db
        .select({ id: entityLabelsTable.entityId })
        .from(entityLabelsTable)
        .where(
          and(
            eq(entityLabelsTable.entityType, type),
            inArray(entityLabelsTable.labelId, sourceIds),
          ),
        )

    statements.push(
      db
        .update(postsTable)
        .set({
          updatedAt: sql`max(${postsTable.updatedAt} + 1, ${now.getTime()})`,
          lastOperationId: null,
        })
        .where(inArray(postsTable.id, affected('post'))),
      db
        .update(audioTable)
        .set({
          updatedAt: sql`max(${audioTable.updatedAt} + 1, ${now.getTime()})`,
          revision: sql`${audioTable.revision} + 1`,
          lastOperationId: null,
        })
        .where(inArray(audioTable.id, affected('audio'))),
      db
        .update(showsTable)
        .set({
          updatedAt: sql`max(${showsTable.updatedAt} + 1, ${now.getTime()})`,
          revision: sql`${showsTable.revision} + 1`,
          lastOperationId: null,
        })
        .where(inArray(showsTable.id, affected('show'))),
      db.insert(labelsTable).values({ kind: 'tag', name: group.name }).onConflictDoNothing(),
      db
        .insert(entityLabelsTable)
        .select(
          db
            .select({
              entityType: entityLabelsTable.entityType,
              entityId: entityLabelsTable.entityId,
              position: sql<number>`min(${entityLabelsTable.position})`.as('position'),
              labelId:
                sql<string>`(SELECT id FROM labels WHERE kind='tag' AND name=${group.name})`.as(
                  'label_id',
                ),
            })
            .from(entityLabelsTable)
            .where(
              and(
                inArray(entityLabelsTable.labelId, sourceIds),
                inArray(entityLabelsTable.entityType, contentTypes),
              ),
            )
            .groupBy(entityLabelsTable.entityType, entityLabelsTable.entityId),
        )
        .onConflictDoUpdate({
          target: [
            entityLabelsTable.entityType,
            entityLabelsTable.entityId,
            entityLabelsTable.labelId,
          ],
          set: { position: sql`min(${entityLabelsTable.position}, excluded.position)` },
        }),
      db
        .delete(entityLabelsTable)
        .where(
          and(
            inArray(entityLabelsTable.labelId, sourceIds),
            inArray(entityLabelsTable.entityType, contentTypes),
          ),
        ),
      db
        .delete(labelsTable)
        .where(
          and(
            eq(labelsTable.kind, 'tag'),
            inArray(labelsTable.name, aliases),
            notExists(
              db
                .select({ id: entityLabelsTable.entityId })
                .from(entityLabelsTable)
                .where(eq(entityLabelsTable.labelId, labelsTable.id)),
            ),
          ),
        ),
    )
  }

  const [first, ...rest] = statements

  if (first) await db.batch([first, ...rest])
}

export const repairMicroTags = async (
  db: DatabaseClient,
  input: {
    readonly postId: string
    readonly actorId: string
    readonly expectedUpdatedAt: Date
    readonly now: Date
  },
) => {
  const [post] = await db
    .select()
    .from(postsTable)
    .where(and(eq(postsTable.id, input.postId), eq(postsTable.type, 'micro')))
    .limit(1)

  if (!post || post.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    return { status: 'conflict' }
  const existing = await readEntityLabels(db, 'post', post.id)
  const tags = microPostTags(post.content ?? '', existing.tags ?? [])

  if (JSON.stringify(tags) === JSON.stringify(canonicalContentTags(existing.tags ?? [])))
    return { status: 'unchanged', tags }

  const updated = await guardedPostUpdate(db, post, input.actorId, {}, tags, [], {
    now: input.now,
  })

  return { status: updated.length === 1 ? 'applied' : 'conflict', tags }
}
