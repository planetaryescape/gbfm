import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { createMigratedD1Database } from '@/test/migrate-d1'

import { user } from './auth.schema'
import { guardedPostUpdate } from './guarded-post-update'
import { makeDatabaseClient } from './layer'
import { postCreators, postsTable } from './post.schema'
import { entityLabelsTable, labelsTable } from './tags.schema'
import { uploadAssetsTable } from './upload-asset.schema'

const harness = async () => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values([
    { id: 'owner', name: 'Owner', email: 'owner@example.test' },
    { id: 'other', name: 'Other', email: 'other@example.test' },
  ])

  const [post] = await db
    .insert(postsTable)
    .values({
      id: 'post',
      title: 'Original',
      slug: 'original',
      type: 'micro',
      content: 'Original',
      draft: true,
    })
    .returning()

  if (!post) throw new Error('Missing post fixture')
  await db.insert(postCreators).values({ postId: post.id, creatorId: 'owner' })
  await db.insert(labelsTable).values({ id: 'old-label', name: 'old', kind: 'tag' })
  await db
    .insert(entityLabelsTable)
    .values({ entityType: 'post', entityId: post.id, labelId: 'old-label', position: 0 })
  await db.insert(uploadAssetsTable).values([
    {
      userId: 'owner',
      key: 'owned',
      bucket: 'test',
      assetType: 'image',
      status: 'uploaded',
      expiresAt: new Date(),
    },
    {
      userId: 'other',
      key: 'foreign',
      bucket: 'test',
      assetType: 'image',
      status: 'uploaded',
      expiresAt: new Date(),
    },
    {
      userId: 'owner',
      key: 'pending',
      bucket: 'test',
      assetType: 'image',
      status: 'pending',
      expiresAt: new Date(),
    },
  ])

  const snapshot = async () => ({
    posts: await db.select().from(postsTable),
    labels: await db.select().from(labelsTable),
    attachedLabels: await db.select().from(entityLabelsTable),
    assets: await db.select().from(uploadAssetsTable),
  })

  return { db, post, snapshot, [Symbol.asyncDispose]: () => resource.dispose() }
}

test.each(['edited', 'draft-changed', 'revoked', 'slug-collision'] as const)(
  'guarded post update rejects %s without changing tags or assets',
  async (mode) => {
    await using h = await harness()

    if (mode === 'edited')
      await h.db
        .update(postsTable)
        .set({ updatedAt: new Date(h.post.updatedAt.getTime() + 1) })
        .where(eq(postsTable.id, h.post.id))

    if (mode === 'draft-changed')
      await h.db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, h.post.id))

    if (mode === 'revoked')
      await h.db.delete(postCreators).where(eq(postCreators.postId, h.post.id))

    if (mode === 'slug-collision')
      await h.db
        .insert(postsTable)
        .values({ title: 'Collision', slug: 'occupied', type: 'micro', content: '' })

    const before = await h.snapshot()
    expect(
      await guardedPostUpdate(
        h.db,
        h.post,
        'owner',
        { title: 'New', slug: 'occupied' },
        ['new'],
        ['owned', 'foreign', 'pending'],
      ),
    ).toEqual([])
    expect(await h.snapshot()).toEqual(before)
  },
)

test('guarded updates attach only owned uploaded assets and preserve first attachment on repeat', async () => {
  await using h = await harness()
  const future = new Date(Date.now() + 60_000)
  await h.db.update(postsTable).set({ updatedAt: future }).where(eq(postsTable.id, h.post.id))
  const [existing] = await h.db.select().from(postsTable).where(eq(postsTable.id, h.post.id))

  if (!existing) throw new Error('Missing post fixture')

  const updated = await guardedPostUpdate(
    h.db,
    existing,
    'owner',
    { title: 'New' },
    ['new', 'new'],
    ['owned', 'foreign', 'pending'],
  )

  expect(updated).toHaveLength(1)
  const [saved] = await h.db.select().from(postsTable).where(eq(postsTable.id, h.post.id))
  expect(saved?.updatedAt.getTime()).toBe(future.getTime() + 1)
  expect(await h.db.select().from(entityLabelsTable)).toHaveLength(1)
  expect(
    await h.db.select().from(uploadAssetsTable).where(eq(uploadAssetsTable.key, 'owned')),
  ).toMatchObject([{ status: 'attached', attachedToTable: 'posts', attachedToId: h.post.id }])
  expect(
    await h.db.select().from(uploadAssetsTable).where(eq(uploadAssetsTable.key, 'foreign')),
  ).toMatchObject([{ status: 'uploaded', attachedToId: null }])
  expect(
    await h.db.select().from(uploadAssetsTable).where(eq(uploadAssetsTable.key, 'pending')),
  ).toMatchObject([{ status: 'pending', attachedToId: null }])

  const before = await h.snapshot()
  expect(
    await guardedPostUpdate(h.db, existing, 'owner', { title: 'Stale repeat' }, [], ['owned']),
  ).toEqual([])
  expect(await h.snapshot()).toEqual(before)
})

test('tracking write failure currently aborts the guarded post batch rather than remaining best-effort', async () => {
  await using h = await harness()
  await h.db.$client
    .prepare(`CREATE TRIGGER reject_tracking BEFORE UPDATE ON upload_assets
    BEGIN SELECT RAISE(ABORT, 'fixture tracking failure'); END`)
    .run()
  const before = await h.snapshot()
  await expect(
    guardedPostUpdate(h.db, h.post, 'owner', { title: 'New' }, ['new'], ['owned']),
  ).rejects.toThrow()
  expect(await h.snapshot()).toEqual(before)
})
