/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Expectations describe recursive rich-content wire values. */
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { DatabaseLayer } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { MdxService, MdxServiceCatalogLayer, MdxServiceLayer } from '@/lib/mdx'
import { db, d1, DatabaseTestLayer } from '@/test/database'
import { withTestLayer } from '@/test/effect'
import { observedD1 } from '@/test/observed-d1'

import {
  RichContentMicroResolver,
  RichContentMicroResolverLayer,
} from './rich-content-micro.service'
import { RichContentMusicResolverLayer } from './rich-content-music.service'

const owner = randomUUID()

const bannedOwner = randomUUID()

const publicId = randomUUID()

const privateId = randomUUID()

const bannedId = randomUUID()

const hiddenReplyId = randomUUID()

const editorialId = randomUUID()

const recursiveId = randomUUID()

const oversizedId = randomUUID()

beforeAll(async () => {
  await db.insert(user).values([
    { id: owner, name: 'Public author', email: `${owner}@example.test`, username: 'author' },
    { id: bannedOwner, name: 'Hidden author', email: `${bannedOwner}@example.test`, banned: true },
  ])
  await db.insert(postsTable).values([
    {
      id: publicId,
      slug: 'public-canon',
      type: 'micro',
      draft: false,
      content: 'canon means **records that stay**.',
    },
    { id: privateId, slug: 'private-canon', type: 'micro', draft: true, content: 'PRIVATE SOURCE' },
    { id: bannedId, slug: 'banned-canon', type: 'micro', draft: false, content: 'BANNED SOURCE' },
    {
      id: editorialId,
      slug: 'not-a-micro',
      type: 'post',
      draft: false,
      content: 'EDITORIAL SOURCE',
    },
    {
      id: recursiveId,
      slug: 'recursive-canon',
      type: 'micro',
      draft: false,
      content: `safe prose\n\n::micro{id="${recursiveId}"}\n\n::micro{id="${privateId}"}\n\n<script>bad()</script>`,
    },
    {
      id: oversizedId,
      slug: 'oversized-canon',
      type: 'micro',
      draft: false,
      content: 'x'.repeat(16_385),
    },
  ])
  await db.insert(postsTable).values({
    id: hiddenReplyId,
    slug: 'hidden-reply',
    type: 'micro',
    draft: false,
    parentPostId: privateId,
    rootPostId: privateId,
    content: 'HIDDEN REPLY SOURCE',
  })
  await db.insert(postCreators).values([
    { postId: publicId, creatorId: owner },
    { postId: bannedId, creatorId: bannedOwner },
  ])
})

const makeMdx = (database = DatabaseTestLayer) =>
  Effect.runPromise(
    withTestLayer(
      MdxService,
      MdxServiceCatalogLayer.pipe(
        Layer.provide(RichContentMicroResolverLayer),
        Layer.provide(RichContentMusicResolverLayer),
        Layer.provide(database),
      ),
    ),
  )

test('micro resolution exposes only public micro bodies and their public author metadata', async () => {
  const resolver = await Effect.runPromise(
    withTestLayer(
      RichContentMicroResolver,
      RichContentMicroResolverLayer.pipe(Layer.provide(DatabaseTestLayer)),
    ),
  )

  const values = await Effect.runPromise(
    resolver.resolveMany([
      publicId,
      publicId,
      privateId,
      bannedId,
      hiddenReplyId,
      editorialId,
      oversizedId,
      randomUUID(),
    ]),
  )

  expect([...values.keys()]).toEqual([publicId])
  expect(values.get(publicId)).toMatchObject({
    _tag: 'Quote',
    micro: { slug: 'public-canon', authors: [{ name: 'Public author', username: 'author' }] },
  })
  expect(JSON.stringify([...values.values()])).not.toMatch(
    /PRIVATE SOURCE|BANNED SOURCE|HIDDEN REPLY|EDITORIAL SOURCE/,
  )
})

test('one batch resolves repeated and nested directives; micro bodies never expand recursive references or raw HTML', async () => {
  const observed = observedD1(d1)
  const mdx = await makeMdx(DatabaseLayer(observed.database))

  const doc = await Effect.runPromise(
    mdx.render(
      `::micro{id="${publicId}"}\n\n> ::micro{id="${publicId}"}\n\n::micro{id="${recursiveId}"}`,
    ),
  )

  expect(observed.queries).toHaveLength(1)
  expect(doc.blocks).toHaveLength(3)
  expect(JSON.stringify(doc)).toContain('safe prose')
  expect(JSON.stringify(doc)).not.toMatch(/bad\(\)|PRIVATE SOURCE|<script>|EmbedReference/)
  expect(doc.blocks[2]).toMatchObject({
    _tag: 'Quote',
    micro: { postId: recursiveId },
    children: expect.arrayContaining([expect.objectContaining({ _tag: 'UnavailableEmbed' })]),
  })
})

test('the same renderer observes edits, unpublication and bans without retaining stale micro snapshots', async () => {
  const mdx = await makeMdx()
  const source = `::micro{id="${publicId}"}`
  expect(JSON.stringify(await Effect.runPromise(mdx.render(source)))).toContain('records that stay')
  await db
    .update(postsTable)
    .set({ content: 'updated public prose' })
    .where(eq(postsTable.id, publicId))
  expect(JSON.stringify(await Effect.runPromise(mdx.render(source)))).toContain(
    'updated public prose',
  )
  await db.update(postsTable).set({ draft: true }).where(eq(postsTable.id, publicId))
  expect((await Effect.runPromise(mdx.render(source))).blocks[0]).toEqual({
    _tag: 'UnavailableEmbed',
    kind: 'cards',
    label: 'This note is unavailable.',
    href: null,
  })
  await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, publicId))
  await db.update(user).set({ banned: true }).where(eq(user.id, owner))
  expect(JSON.stringify(await Effect.runPromise(mdx.render(source)))).not.toContain(
    'updated public prose',
  )
  await db.update(user).set({ banned: false }).where(eq(user.id, owner))
})

test('missing micro resolvers fail closed while old quotes remain readable', async () => {
  const mdx = await Effect.runPromise(withTestLayer(MdxService, MdxServiceLayer))

  const doc = await Effect.runPromise(
    mdx.render(`::micro{id="${randomUUID()}"}\n\n> ordinary quote`),
  )

  expect(doc.blocks[0]).toMatchObject({ _tag: 'UnavailableEmbed', href: null })
  expect(doc.blocks[1]).toMatchObject({ _tag: 'Quote' })
})

test('deleting an embedded note removes its body and attribution on the next render', async () => {
  const id = randomUUID()
  await db.insert(postsTable).values({
    id,
    slug: `removed-${id}`,
    type: 'micro',
    draft: false,
    content: 'remove this body',
  })
  const mdx = await makeMdx()
  const source = `::micro{id="${id}"}`
  expect(JSON.stringify(await Effect.runPromise(mdx.render(source)))).toContain('remove this body')
  await db.delete(postsTable).where(eq(postsTable.id, id))
  const rendered = await Effect.runPromise(mdx.render(source))
  expect(rendered.blocks[0]).toMatchObject({ _tag: 'UnavailableEmbed', href: null })
  expect(JSON.stringify(rendered)).not.toContain('remove this body')
  expect(JSON.stringify(rendered)).not.toContain(`removed-${id}`)
})

test('micro batch lookup uses indexed identities and bounds empty and oversized requests', async () => {
  const observed = observedD1(d1)

  const resolver = await Effect.runPromise(
    withTestLayer(
      RichContentMicroResolver,
      RichContentMicroResolverLayer.pipe(Layer.provide(DatabaseLayer(observed.database))),
    ),
  )

  expect((await Effect.runPromise(resolver.resolveMany([]))).size).toBe(0)
  expect(
    (await Effect.runPromise(resolver.resolveMany(Array.from({ length: 17 }, () => randomUUID()))))
      .size,
  ).toBe(0)
  expect(observed.queries).toHaveLength(0)
  expect((await Effect.runPromise(resolver.resolveMany([publicId]))).size).toBe(1)
  expect(observed.queries).toHaveLength(1)
  const query = observed.queries[0]

  if (!query) throw new Error('Expected micro lookup query')

  const plan = await d1.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(publicId, 16_384, 257).all()

  expect(JSON.stringify(plan.results)).toContain('SEARCH posts USING INDEX')
  expect(JSON.stringify(plan.results)).toContain('SEARCH post_creators USING COVERING INDEX')
})
