import { eq, sql } from 'drizzle-orm'
import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import {
  publicMicroAncestorPredicate,
  publicMicroAncestorQuery,
} from '@/services/public-micro-ancestry'
import { db } from '@/test/database'

const Projection = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    parentPostId: Schema.NullOr(Schema.String),
    rootPostId: Schema.NullOr(Schema.String),
    depth: Schema.Number,
  }),
)

const read = async (postId: string) =>
  Schema.decodeUnknownSync(Projection)(await db.all(publicMicroAncestorQuery(postId)))

const seedPath = async (prefix: string, depth: number) => {
  const ids = Array.from({ length: depth + 1 }, (_, index) => `${prefix}-${index}`)
  const rootId = `${prefix}-0`

  for (const [index, id] of ids.entries())
    await db.insert(postsTable).values({
      id,
      slug: id,
      type: 'micro',
      parentPostId: index === 0 ? null : ids[index - 1],
      rootPostId: index === 0 ? null : rootId,
      // Deliberately wrong denormalized depth: admission must use actual ancestry.
      depth: 77,
      content: 'Authored prose',
    })

  return { ids, rootId, leafId: `${prefix}-${depth}` }
}

const insertReply = async (
  id: string,
  expected: { postId: string; rootId: string; depth: number },
) =>
  db.run(sql`
  INSERT INTO posts (id, slug, type, draft, content, "createdAt", "updatedAt", parent_post_id, root_post_id, depth)
  SELECT ${id}, ${id}, 'micro', 0, 'Reply', 10000, 10000,
    parent.id, coalesce(parent.rootPostId, parent.id), parent.depth + 1
  FROM (${publicMicroAncestorQuery(expected.postId)}) parent
  WHERE ${publicMicroAncestorPredicate(expected)}
`)

const stored = async (id: string) =>
  db
    .select({
      id: postsTable.id,
      parentPostId: postsTable.parentPostId,
      rootPostId: postsTable.rootPostId,
      depth: postsTable.depth,
    })
    .from(postsTable)
    .where(eq(postsTable.id, id))

test('query projects computed public ancestry, supports SQL lookup expressions and binds hostile IDs', async () => {
  const { rootId, leafId } = await seedPath('projection', 2)
  expect(await read(rootId)).toEqual([
    { id: rootId, parentPostId: null, rootPostId: null, depth: 0 },
  ])
  expect(await read(leafId)).toEqual([
    { id: leafId, parentPostId: 'projection-1', rootPostId: rootId, depth: 2 },
  ])
  expect(
    await db.all(publicMicroAncestorQuery(sql`(SELECT id FROM posts WHERE slug = ${leafId})`)),
  ).toEqual(await read(leafId))
  expect(await read("' OR 1=1 --")).toEqual([])
  expect(await read('missing')).toEqual([])
})

test('every focus/intermediate/root must be a published unbanned micro; every root pointer must agree', async () => {
  const { ids, rootId, leafId } = await seedPath('visibility', 2)
  const { rootId: otherRoot } = await seedPath('other-root', 0)

  for (const id of ids) {
    const authorId = `${id}-author`
    await db
      .insert(user)
      .values({ id: authorId, name: 'Author', email: `${authorId}@example.test` })
    await db.insert(postCreators).values({ postId: id, creatorId: authorId })
    await db.update(postsTable).set({ draft: true }).where(eq(postsTable.id, id))
    expect(await read(leafId)).toEqual([])
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, id))
    await db.update(user).set({ banned: true }).where(eq(user.id, authorId))
    expect(await read(leafId)).toEqual([])
    await db.update(user).set({ banned: false }).where(eq(user.id, authorId))
    await db.update(postsTable).set({ type: 'post' }).where(eq(postsTable.id, id))
    expect(await read(leafId)).toEqual([])
    await db.update(postsTable).set({ type: 'micro' }).where(eq(postsTable.id, id))
  }

  for (const id of ['visibility-1', leafId]) {
    for (const badRoot of [otherRoot, null]) {
      await db.update(postsTable).set({ rootPostId: badRoot }).where(eq(postsTable.id, id))
      // Checking only focus.rootPostId and a public root would miss the middle case.
      expect(await read(leafId)).toEqual([])
    }

    await db.update(postsTable).set({ rootPostId: rootId }).where(eq(postsTable.id, id))
  }

  await db.update(postsTable).set({ rootPostId: rootId }).where(eq(postsTable.id, rootId))
  expect(await read(leafId)).toEqual([])
  await db.update(postsTable).set({ rootPostId: null }).where(eq(postsTable.id, rootId))
  expect((await read(leafId))[0]?.depth).toBe(2)
  await db.update(postsTable).set({ parentPostId: leafId }).where(eq(postsTable.id, rootId))
  expect(await read(leafId)).toEqual([])
})

test('depth8 may be read but cannot parent depth9; guarded INSERT fences expected root/depth', async () => {
  const { rootId, leafId } = await seedPath('boundary', 9)
  expect(await read(leafId)).toEqual([])
  expect((await read('boundary-8'))[0]?.depth).toBe(8)
  await insertReply('depth9-denied', { postId: 'boundary-8', rootId, depth: 8 })
  expect(await stored('depth9-denied')).toEqual([])
  await insertReply('depth8-accepted', { postId: 'boundary-7', rootId, depth: 7 })
  expect(await stored('depth8-accepted')).toEqual([
    { id: 'depth8-accepted', parentPostId: 'boundary-7', rootPostId: rootId, depth: 8 },
  ])

  for (const [index, expected] of [
    { postId: 'boundary-7', rootId: 'not-the-root', depth: 7 },
    { postId: 'boundary-7', rootId, depth: 6 },
    { postId: 'boundary-7', rootId, depth: -1 },
    { postId: 'boundary-7', rootId, depth: 7.5 },
    { postId: 'missing', rootId, depth: 0 },
  ].entries()) {
    const id = `expected-denied-${index}`
    await insertReply(id, expected)
    expect(await stored(id)).toEqual([])
  }

  const { rootId: emptyRoot } = await seedPath('root-parent', 0)
  await insertReply('root-reply', { postId: emptyRoot, rootId: emptyRoot, depth: 0 })
  expect(await stored('root-reply')).toEqual([
    { id: 'root-reply', parentPostId: emptyRoot, rootPostId: emptyRoot, depth: 1 },
  ])
})

test('same-statement INSERT rechecks off-page ancestor publication/ban/root changes after preflight', async () => {
  for (const mode of ['draft', 'ban', 'root']) {
    const prefix = `write-race-${mode}`
    const { rootId, leafId } = await seedPath(prefix, 2)
    const middleId = `${prefix}-1`
    const authorId = `${prefix}-author`
    await db
      .insert(user)
      .values({ id: authorId, name: 'Author', email: `${authorId}@example.test` })
    await db.insert(postCreators).values({ postId: middleId, creatorId: authorId })
    const expected = { postId: leafId, rootId, depth: 2 }
    expect((await read(leafId))[0]?.depth).toBe(2)

    if (mode === 'draft')
      await db.update(postsTable).set({ draft: true }).where(eq(postsTable.id, middleId))
    else if (mode === 'ban')
      await db.update(user).set({ banned: true }).where(eq(user.id, authorId))
    else await db.update(postsTable).set({ rootPostId: null }).where(eq(postsTable.id, middleId))
    await insertReply(`${prefix}-denied`, expected)
    expect(await stored(`${prefix}-denied`)).toEqual([])
  }

  const { rootId, leafId } = await seedPath('harmless-edit', 1)
  await db.update(postsTable).set({ title: 'New public title' }).where(eq(postsTable.id, rootId))
  await insertReply('harmless-edit-accepted', { postId: leafId, rootId, depth: 1 })
  expect((await stored('harmless-edit-accepted'))[0]?.depth).toBe(2)
})
