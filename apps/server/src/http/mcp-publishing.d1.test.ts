import { eq } from 'drizzle-orm'
import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { mcpOperations } from '@/db/mcp-operation.schema'
import { musicAlbumsTable, musicTracksTable } from '@/db/music-entity.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { createMcpOperationStore } from '@/mcp/operations/store'
import { publishingFixture } from '@/test/mcp-publishing'

const listing = Schema.decodeUnknownSync(
  Schema.Struct({
    result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  }),
)

const error = (code: string) => ({
  result: { isError: true, content: [{ text: expect.stringContaining(code) }] },
})

test('production registry exposes only consented publishing tools, not candidate deletion or metadata writes', async () => {
  await using h = await publishingFixture()

  const publishedScopes = listing(await (await h.rpc('tools/list', {})).json()).result.tools.map(
    (tool) => tool.name,
  )

  expect(publishedScopes).toEqual(
    expect.arrayContaining(['create_micro_post', 'reply_to_micro_post', 'publish_editorial']),
  )

  for (const name of ['delete_content', 'unpublish_content', 'update_creator_metadata'])
    expect(publishedScopes).not.toContain(name)

  const oldScopes = listing(
    await (await h.rpc('tools/list', {}, h.reader.access_token)).json(),
  ).result.tools.map((tool) => tool.name)

  expect(oldScopes).not.toContain('create_micro_post')
  expect(oldScopes).not.toContain('publish_editorial')
  expect(
    (
      await h.call(
        'create_micro_post',
        { requestId: crypto.randomUUID(), content: 'Denied' },
        h.reader.access_token,
      )
    ).body,
  ).toMatchObject(error('access_denied'))
  expect(await h.db.select().from(postsTable)).toEqual([])
}, 30_000)

test('lost micro acknowledgements, concurrent retries and a new handler return one persisted post and receipt', async () => {
  await using h = await publishingFixture()
  const input = { requestId: crypto.randomUUID(), content: 'Clicks n cuts. A disposable note.' }
  const first = h.result((await h.call('create_micro_post', input)).body)

  await h.restart()

  const retries = await Promise.all(
    [2, 3, 4].map(async (id) =>
      h.result((await h.call('create_micro_post', input, h.publisher.access_token, id)).body),
    ),
  )

  for (const retry of retries) expect(retry).toMatchObject({ replayed: true, target: first.target })
  const rows = await h.db.select().from(postsTable)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: first.target.targetId, content: input.content, draft: false })
  expect(await h.db.select().from(mcpOperations)).toHaveLength(1)
  expect(
    (await h.call('create_micro_post', { ...input, content: 'Different input' })).body,
  ).toMatchObject(error('conflict'))

  const read = await h.publicRead(`/api/content/posts/micro/by-id/${first.target.targetId}`)
  expect(read.status).toBe(200)
  expect(JSON.stringify(await read.json())).toContain(input.content)

  await createMcpOperationStore(h.database).pruneExpired(Date.now() + 86_400_001)
  expect((await h.call('create_micro_post', input)).body).toMatchObject(error('expired'))
  expect(await h.db.select().from(postsTable)).toHaveLength(1)
}, 30_000)

test('a published micro preserves native track and album cards for anonymous readers', async () => {
  await using h = await publishingFixture()
  const albumId = crypto.randomUUID()
  const trackId = crypto.randomUUID()
  await h.db.insert(musicAlbumsTable).values({
    id: albumId,
    slug: albumId,
    title: 'Disposable album',
    artistNames: ['Fixture artist'],
  })
  await h.db.insert(musicTracksTable).values({
    id: trackId,
    slug: trackId,
    title: 'Disposable track',
    artistNames: ['Fixture artist'],
    albumId,
  })
  const content = `Found this again.\n\n::track{id="${trackId}"}\n\nI ought to check out the album.\n\n::album{id="${albumId}" tracks="false"}`

  const published = h.result(
    (
      await h.call('create_micro_post', {
        requestId: crypto.randomUUID(),
        content,
      })
    ).body,
  )

  const read = await h.publicRead(`/api/content/posts/micro/by-id/${published.target.targetId}`)
  expect(read.status).toBe(200)
  const body = JSON.stringify(await read.json())
  expect(body).toContain('Disposable track')
  expect(body).toContain('Disposable album')
  expect(body).not.toContain('unavailable')
}, 30_000)

test('reply retries retain one derived thread position and reject a newly private parent', async () => {
  await using h = await publishingFixture()

  const root = h.result(
    (
      await h.call('create_micro_post', {
        requestId: crypto.randomUUID(),
        content: 'Thread root',
      })
    ).body,
  )

  const input = {
    requestId: crypto.randomUUID(),
    parentPostId: root.target.targetId,
    content: 'One reply',
  }

  const replies = await Promise.all(
    [1, 2].map(async (id) =>
      h.result((await h.call('reply_to_micro_post', input, h.publisher.access_token, id)).body),
    ),
  )

  expect(replies[0]?.target).toEqual(replies[1]?.target)
  const rows = await h.db.select().from(postsTable)
  expect(rows).toHaveLength(2)
  expect(rows.find((row) => row.id === replies[0]?.target.targetId)).toMatchObject({
    parentPostId: root.target.targetId,
    rootPostId: root.target.targetId,
    depth: 1,
  })

  await h.db.update(postsTable).set({ draft: true }).where(eq(postsTable.id, root.target.targetId))
  expect(
    (await h.call('reply_to_micro_post', { ...input, requestId: crypto.randomUUID() })).body,
  ).toMatchObject(error('not_found'))
  expect(await h.db.select().from(postsTable)).toHaveLength(2)
}, 30_000)

const seedEditorial = async (h: Awaited<ReturnType<typeof publishingFixture>>, owner = 'owner') => {
  const id = crypto.randomUUID()
  const cover = 'private/owner/image/cover/cover.png'
  const banner = 'private/owner/image/banner/banner.png'
  h.objects.set(cover, 'cover bytes')
  h.objects.set(banner, 'banner bytes')
  await h.db.insert(postsTable).values({
    id,
    slug: id,
    type: 'post',
    title: 'A disposable editorial',
    content: `![Banner](${h.assetUrl(banner)})\n\nKeep this prose.`,
    thumbnailUrl: h.assetUrl(cover),
    draft: true,
  })
  await h.db.insert(postCreators).values({ postId: id, creatorId: owner })

  return {
    id,
    cover,
    banner,
    input: {
      requestId: crypto.randomUUID(),
      postId: id,
      expectedVersion: (await h.version(id)).version,
    },
  }
}

test('publication commits rewritten media and original receipt, then resumes partial copies after a handler restart', async () => {
  await using h = await publishingFixture()
  const { id, cover, banner, input } = await seedEditorial(h)
  h.hooks.beforeCopy = async (key) => {
    if (key === banner.replace('private/', 'public/')) throw new Error('Storage interrupted')
  }

  expect((await h.call('publish_editorial', input)).body).toMatchObject(error('unavailable'))

  const [committed] = await h.db.select().from(postsTable).where(eq(postsTable.id, id))
  expect(committed).toMatchObject({
    draft: false,
    thumbnailUrl: h.assetUrl(cover.replace('private/', 'public/')),
    content: expect.stringContaining(h.assetUrl(banner.replace('private/', 'public/'))),
  })
  expect(await h.db.select().from(mcpOperations)).toHaveLength(1)
  const committedVersion = (await h.version(id)).version
  delete h.hooks.beforeCopy
  await h.restart()

  const replay = h.result((await h.call('publish_editorial', input)).body)
  expect(replay).toMatchObject({
    replayed: true,
    target: { targetId: id, state: 'published', version: committedVersion },
  })
  expect(h.objects.get(cover.replace('private/', 'public/'))).toBe('cover bytes')
  expect(h.objects.get(banner.replace('private/', 'public/'))).toBe('banner bytes')
  expect(h.copies).toHaveLength(2)
  expect((await h.version(id)).version).toBe(committedVersion)
  expect(h.result((await h.call('publish_editorial', input)).body).target).toEqual(replay.target)
  expect(h.copies).toHaveLength(2)

  const publicRead = await h.publicRead(`/api/content/posts/editorials/${id}`)
  expect(publicRead.status).toBe(200)
  const rendered = JSON.stringify(await publicRead.json())
  expect(rendered).toContain('Keep this prose.')
  expect(rendered).not.toContain('/user-content/private/')
}, 30_000)

test('storage success followed by a lost copy response is reconciled by HEAD without copying again', async () => {
  await using h = await publishingFixture()
  const { input } = await seedEditorial(h)
  h.hooks.afterCopy = async () => {
    throw new Error('Response lost after provider success')
  }

  expect((await h.call('publish_editorial', input)).body).toMatchObject(error('unavailable'))
  delete h.hooks.afterCopy
  await h.restart()
  expect(h.result((await h.call('publish_editorial', input)).body).replayed).toBe(true)
  expect(h.copies).toHaveLength(2)
  expect(await h.db.select().from(postsTable)).toHaveLength(1)
}, 30_000)

test('stale versions, foreign ownership and a changed snapshot during media preflight never copy or publish', async () => {
  await using h = await publishingFixture()
  const foreign = await seedEditorial(h, 'other')
  expect((await h.call('publish_editorial', foreign.input)).body).toMatchObject(error('not_found'))

  const { id, cover, input } = await seedEditorial(h)
  await h.db
    .update(postsTable)
    .set({ content: 'Changed before publishing' })
    .where(eq(postsTable.id, id))
  expect((await h.call('publish_editorial', input)).body).toMatchObject(error('conflict'))

  const next = {
    ...input,
    requestId: crypto.randomUUID(),
    expectedVersion: (await h.version(id)).version,
  }

  h.hooks.beforeHead = async (key) => {
    if (key !== cover) return
    delete h.hooks.beforeHead
    await h.db.update(postsTable).set({ content: 'Concurrent edit' }).where(eq(postsTable.id, id))
  }

  expect((await h.call('publish_editorial', next)).body).toMatchObject(error('conflict'))
  expect(h.copies).toEqual([])
  expect(await h.db.select().from(mcpOperations)).toEqual([])
  expect((await h.db.select().from(postsTable)).every((post) => post.draft)).toBe(true)
}, 30_000)

test('revoked authorship or publishing consent prevents recovery from exposing private bytes', async () => {
  await using h = await publishingFixture()
  const { id, input } = await seedEditorial(h)
  h.hooks.beforeCopy = async () => {
    throw new Error('Storage unavailable')
  }

  expect((await h.call('publish_editorial', input)).body).toMatchObject(error('unavailable'))
  delete h.hooks.beforeCopy
  await h.db.delete(postCreators).where(eq(postCreators.postId, id))
  expect((await h.call('publish_editorial', input)).body).toMatchObject(error('access_denied'))
  expect(h.copies).toEqual([])

  await h.db.insert(postCreators).values({ postId: id, creatorId: 'owner' })
  await h.db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
  const denied = await h.call('publish_editorial', input)
  expect(denied.status === 401 || JSON.stringify(denied.body).includes('access_denied')).toBe(true)
  expect(h.copies).toEqual([])
}, 30_000)
