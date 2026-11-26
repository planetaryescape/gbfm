import { and, eq } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { db, d1 } from '@/test/d1'

import {
  inspectContentTagMerges,
  mergeContentTags,
  repairMicroTags,
} from './content-tag-maintenance'
import { hasEntityLabel, readEntityLabels, replaceEntityLabels } from './labels'
import { postCreators, postsTable } from './post.schema'
import { entityLabelsTable, labelsTable } from './tags.schema'

test('merges tag bindings without touching genres, prose, publication or unrelated labels', async () => {
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(postsTable).values({
    id,
    slug: id,
    title: 'Preserved',
    content: 'Exact source',
    draft: true,
    type: 'post',
    updatedAt: now,
  })

  const labels: Array<typeof labelsTable.$inferInsert> = [
    { id: crypto.randomUUID(), kind: 'tag', name: 'hip-hop' },
    { id: crypto.randomUUID(), kind: 'tag', name: 'hip_hop' },
    { id: crypto.randomUUID(), kind: 'tag', name: 'hip hop' },
    { id: crypto.randomUUID(), kind: 'genre', name: 'hip-hop' },
    { id: crypto.randomUUID(), kind: 'tag', name: 'curated' },
    { id: crypto.randomUUID(), kind: 'tag', name: 'curation' },
    { id: crypto.randomUUID(), kind: 'tag', name: 'dub_techno' },
    { id: crypto.randomUUID(), kind: 'tag', name: 'minima' },
  ]

  for (const [position, label] of labels.entries()) {
    await db.insert(labelsTable).values(label).onConflictDoNothing()

    const [saved] = await db
      .select()
      .from(labelsTable)
      .where(and(eq(labelsTable.kind, label.kind), eq(labelsTable.name, label.name)))

    if (!saved) throw new Error('Missing fixture label')
    await db.insert(entityLabelsTable).values({
      entityType: 'post',
      entityId: id,
      labelId: saved.id,
      position,
    })
  }

  expect(await inspectContentTagMerges(db)).toContainEqual({
    tag: 'hip-hop',
    entityType: 'post',
    count: 1,
  })
  await d1
    .prepare(
      `CREATE TRIGGER fail_tag_merge BEFORE INSERT ON entity_labels
       WHEN NEW.entity_id='${id}' AND NEW.label_id=(SELECT id FROM labels WHERE kind='tag' AND name='dub techno')
       BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
    )
    .run()
  await expect(mergeContentTags(db, now)).rejects.toThrow()
  expect((await readEntityLabels(db, 'post', id)).tags).toContain('hip-hop')
  expect(await db.select().from(postsTable).where(eq(postsTable.id, id))).toMatchObject([
    { updatedAt: now },
  ])
  await d1.prepare('DROP TRIGGER fail_tag_merge').run()
  await mergeContentTags(db, now)
  expect(await readEntityLabels(db, 'post', id)).toEqual({
    tags: ['hip hop', 'curated', 'curation', 'dub techno', 'minimal'],
    genres: ['hip-hop'],
  })
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id))
  expect(post).toMatchObject({ content: 'Exact source', draft: true })
  expect(post?.updatedAt.getTime()).toBeGreaterThan(now.getTime())
  await mergeContentTags(db, new Date(now.getTime() + 1000))
  expect(await db.select().from(postsTable).where(eq(postsTable.id, id))).toEqual([post])
  expect(
    await db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(and(eq(postsTable.id, id), hasEntityLabel('post', postsTable.id, 'hip_hop'))),
  ).toEqual([{ id }])
  await replaceEntityLabels(db, 'post', id, { tags: ['hip-hop', 'hip_hop', 'dub-techno'] })
  expect((await readEntityLabels(db, 'post', id)).tags).toEqual(['hip hop', 'dub techno'])
}, 30_000)

test('repairs a published micro in place with owner and timestamp guards and no duplicate tags', async () => {
  const id = crypto.randomUUID()
  const owner = crypto.randomUUID()
  const now = new Date()
  await db.insert(user).values({ id: owner, name: 'Fixture', email: `${owner}@example.test` })
  await db.insert(postsTable).values({
    id,
    slug: id,
    content: 'Exact wording\n\n#hip hop',
    draft: false,
    type: 'micro',
    updatedAt: now,
  })
  await db.insert(postCreators).values({ postId: id, creatorId: owner })
  expect(
    await repairMicroTags(db, {
      postId: id,
      actorId: 'not-the-owner',
      expectedUpdatedAt: now,
      now,
    }),
  ).toMatchObject({ status: 'conflict' })
  expect((await readEntityLabels(db, 'post', id)).tags).toBeNull()
  expect(
    await repairMicroTags(db, { postId: id, actorId: owner, expectedUpdatedAt: now, now }),
  ).toEqual({ status: 'applied', tags: ['hip hop'] })
  expect(
    await repairMicroTags(db, { postId: id, actorId: owner, expectedUpdatedAt: now, now }),
  ).toEqual({ status: 'conflict' })
  expect(await db.select().from(postsTable).where(eq(postsTable.id, id))).toMatchObject([
    { id, content: 'Exact wording\n\n#hip hop', draft: false },
  ])
}, 30_000)
