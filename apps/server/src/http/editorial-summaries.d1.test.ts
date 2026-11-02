import { randomUUID } from 'node:crypto'

import { GetEditorialPostsResponse, GetEditorialSummariesResponse } from '@gbfm/api/post'
import { inArray } from 'drizzle-orm'
import { Layer, Schema } from 'effect'
import { afterAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { d1, db } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'

const ids = Array.from({ length: 5 }, () => randomUUID())

const creatorId = randomUUID()

const labelId = randomUUID()

const tag = `summary-${labelId}`

afterAll(async () => {
  await db.delete(entityLabelsTable).where(inArray(entityLabelsTable.entityId, ids))
  await db.delete(postCreators).where(inArray(postCreators.postId, ids))
  await db.delete(postsTable).where(inArray(postsTable.id, ids))
  await db.delete(labelsTable).where(inArray(labelsTable.id, [labelId]))
  await db.delete(user).where(inArray(user.id, [creatorId]))
})

test('summary route returns the published editorial metadata without provider requests', async () => {
  await db.insert(user).values({
    id: creatorId,
    name: 'Summary Creator',
    email: `${creatorId}@example.com`,
    username: 'summary-creator',
    image: 'https://example.com/creator.png',
  })
  await db.insert(labelsTable).values({ id: labelId, kind: 'tag', name: tag })

  for (const [index, id] of ids.entries()) {
    await db.insert(postsTable).values({
      id,
      slug: `summary-${id}`,
      title: `Editorial ${index}`,
      description: `Description ${index}`,
      thumbnailUrl: `https://example.com/${index}.png`,
      type: 'post',
      draft: index === 4,
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
      content: index === 3 ? ' ' : `https://fixture.bandcamp.com/album/summary-${index}`,
    })
    await db.insert(postCreators).values({ postId: id, creatorId })

    if (index % 2 === 0) {
      await db
        .insert(entityLabelsTable)
        .values({ entityType: 'post', entityId: id, labelId, position: 0 })
    }
  }

  const requests: Array<string> = []

  const fetcher = Layer.succeed(ExternalMediaFetcher, async (url) => {
    requests.push(url)

    return new Response(
      '<html><head><meta name="bc-page-properties" content="{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:123}"></head></html>',
      { headers: { 'content-type': 'text/html' } },
    )
  })

  const handler = createTestWebHandler(
    d1,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fetcher,
  )

  const get = (path: string, headers?: HeadersInit) =>
    handler.handler(
      new Request(`https://api.example.com${path}`, { headers: new Headers(headers) }),
    )

  const decodeSummary = Schema.decodeUnknownSync(
    Schema.fromJsonString(GetEditorialSummariesResponse),
  )

  const decodeFull = Schema.decodeUnknownSync(Schema.fromJsonString(GetEditorialPostsResponse))

  try {
    for (const headers of [
      { cookie: 'session=private' },
      { authorization: 'Bearer private' },
      { 'cache-control': 'no-cache' },
      { 'cache-control': 'max-age=0' },
      { 'cache-control': 'no-store', pragma: 'no-cache' },
    ]) {
      const response = await get('/api/content/editorial-summaries?limit=2&offset=1', headers)

      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).not.toContain('richContent')
      expect(text).not.toContain('compiledContent')
      const body = decodeSummary(text)
      expect(body.data.map((post) => post.id)).toEqual([ids[2], ids[1]])
      expect(body.pagination).toEqual({ total: 4, limit: 2, offset: 1, hasMore: true })
      expect(requests).toEqual([])
    }

    const tagged = await get(`/api/content/editorial-summaries?tag=${tag}&limit=1&offset=1`, {
      cookie: 'session=private',
      'cache-control': 'no-cache',
    })

    expect(tagged.status).toBe(200)
    const taggedBody = decodeSummary(await tagged.text())
    expect(taggedBody.data.map((post) => post.id)).toEqual([ids[0]])
    expect(taggedBody.pagination).toEqual({ total: 2, limit: 1, offset: 1, hasMore: false })
    expect(requests).toEqual([])

    const summary = decodeSummary(
      await (await get('/api/content/editorial-summaries?limit=10')).text(),
    )

    expect(summary.data.map((post) => post.id)).toEqual([ids[2], ids[1], ids[0]])
    expect(summary.pagination.total).toBe(4)
    expect(requests).toEqual([])

    const full = decodeFull(
      await (
        await get('/api/content/posts/editorials?limit=10', { 'cache-control': 'no-cache' })
      ).text(),
    )

    expect(requests.length).toBeGreaterThan(0)
    expect(summary.pagination).toEqual(full.pagination)
    expect(summary.data).toEqual(
      full.data.map(
        ({
          id,
          slug,
          title,
          thumbnailUrl,
          description,
          createdAt,
          updatedAt,
          creators,
          tags,
          draft,
        }) => ({
          id,
          slug,
          title,
          thumbnailUrl,
          description,
          createdAt,
          updatedAt,
          creators,
          tags,
          draft,
        }),
      ),
    )
    expect(summary.data[0]?.creators).toEqual([
      {
        id: creatorId,
        name: 'Summary Creator',
        username: 'summary-creator',
        image: 'https://example.com/creator.png',
      },
    ])
    expect(summary.data[0]?.tags).toEqual([tag])
  } finally {
    await handler.dispose()
  }
})
