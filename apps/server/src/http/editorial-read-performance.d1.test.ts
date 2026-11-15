import { CompiledEditorialPostResponse } from '@gbfm/api/post'
import { SiteMetadata } from '@gbfm/site-metadata'
import { Layer, Predicate, Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { blueskyPostSources } from '@/db/external-account.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { d1, db } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'
import { observedD1 } from '@/test/observed-d1'

const publishedAt = new Date('2026-01-01T00:00:00Z')

const modifiedAt = new Date('2026-01-02T00:00:00Z')

const content = 'https://fixture.bandcamp.com/album/editorial-performance'

const decodeMetadata = Schema.decodeUnknownSync(SiteMetadata)

const decodePost = Schema.decodeUnknownSync(CompiledEditorialPostResponse)

beforeAll(async () => {
  await db.batch([
    db.insert(user).values([
      { id: 'editorial-owner', name: 'Owner', email: 'owner@example.com' },
      { id: 'editorial-collaborator', name: 'Collaborator', email: 'collaborator@example.com' },
    ]),
    db.insert(postsTable).values([
      {
        id: 'published',
        slug: 'published-editorial',
        title: 'Published editorial',
        content,
        description: 'Editorial description',
        thumbnailUrl: 'https://example.com/editorial.png',
        type: 'post',
        draft: false,
        createdAt: publishedAt,
        updatedAt: modifiedAt,
      },
      { id: 'draft', slug: 'draft-editorial', title: 'Draft', content, type: 'post', draft: true },
      { id: 'micro', slug: 'micro', title: 'Tweet', content, type: 'micro', draft: false },
      { id: 'empty', slug: 'empty', title: 'Empty', content: '', type: 'post', draft: false },
      {
        id: 'whitespace',
        slug: 'whitespace',
        title: 'Whitespace',
        content: '\n\t\u00a0\ufeff',
        type: 'post',
        draft: false,
      },
      { id: 'untitled', slug: 'untitled', title: ' \t', content, type: 'post', draft: false },
      {
        id: 'unattributed',
        slug: 'unattributed',
        title: 'Unattributed editorial',
        content: 'Plain prose',
        type: 'post',
        draft: false,
      },
    ]),
    db.insert(postCreators).values([
      { postId: 'published', creatorId: 'editorial-owner' },
      { postId: 'published', creatorId: 'editorial-collaborator' },
      { postId: 'draft', creatorId: 'editorial-owner' },
    ]),
    db.insert(labelsTable).values({ id: 'editorial-tag', kind: 'tag', name: 'Listening' }),
    db
      .insert(entityLabelsTable)
      .values({ entityType: 'post', entityId: 'published', labelId: 'editorial-tag', position: 0 }),
    db.insert(blueskyPostSources).values({
      postId: 'published',
      authorDid: 'did:plc:historical-editorial',
      atUri: 'at://did:plc:historical-editorial/app.bsky.feed.post/editorial',
      publicUrl: 'https://bsky.app/profile/historical.example/post/editorial',
      sourceCreatedAt: publishedAt,
    }),
  ])
})

const makeHandler = () => {
  const observed = observedD1(d1)
  const providerRequests: Array<string> = []

  const fetcher = Layer.succeed(ExternalMediaFetcher, async (url) => {
    providerRequests.push(url)

    return new Response(
      '<html><head><meta name="bc-page-properties" content="{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:123}"></head></html>',
      { headers: { 'content-type': 'text/html' } },
    )
  })

  const handler = createTestWebHandler(
    observed.database,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fetcher,
  )

  return {
    ...handler,
    observed,
    providerRequests,
    get: (path: string) => handler.handler(new Request(`https://api.example.com${path}`)),
  }
}

test('editorial metadata preserves its projection with one query and no embed resolution', async () => {
  const handler = makeHandler()

  try {
    const response = await handler.get('/api/site-metadata/editorial/published-editorial')
    expect(response.status).toBe(200)
    const metadata = decodeMetadata(await response.json())
    expect(metadata).toMatchObject({
      title: 'Published editorial',
      description: 'Editorial description',
      publishedAt: publishedAt.toISOString(),
      modifiedAt: modifiedAt.toISOString(),
    })
    expect(new URL(metadata.canonicalUrl).pathname).toBe('/editorial/published-editorial')
    expect(JSON.stringify(metadata)).toContain('Owner')
    expect(JSON.stringify(metadata)).toContain('Collaborator')
    expect(handler.observed.queries).toHaveLength(1)
    expect(handler.providerRequests).toEqual([])
    const query = handler.observed.queries[0]
    expect(query).toBeDefined()

    if (query === undefined) throw new Error('Expected metadata query')

    const plan = await d1
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .bind(' ', 'published-editorial', 0, 1)
      .all<{ detail: string }>()

    expect(plan.results.some(({ detail }) => detail.includes('posts_slug_idx'))).toBe(true)

    handler.observed.reset()
    const card = await handler.get('/api/social-cards/editorial/published-editorial')
    expect(card.status).toBe(200)
    expect(JSON.stringify(await card.json())).toContain('Published editorial')
    expect(handler.observed.queries).toHaveLength(1)
    expect(handler.providerRequests).toEqual([])

    const legacy = await handler.get('/api/site-metadata/post/published-editorial')
    expect(legacy.status).toBe(200)
    expect(decodeMetadata(await legacy.json())).toEqual(metadata)
    expect(handler.providerRequests).toEqual([content])
  } finally {
    await handler.dispose()
  }
})

test('editorial metadata retains public visibility and valid-editorial restrictions', async () => {
  const handler = makeHandler()

  try {
    for (const slug of ['missing', 'draft-editorial', 'micro', 'empty', 'whitespace', 'untitled']) {
      handler.observed.reset()
      expect((await handler.get(`/api/site-metadata/editorial/${slug}`)).status).toBe(404)
      expect(handler.observed.queries).toHaveLength(1)
    }

    handler.observed.reset()
    const response = await handler.get('/api/site-metadata/editorial/unattributed')
    expect(response.status).toBe(200)
    expect(decodeMetadata(await response.json()).title).toBe('Unattributed editorial')
    expect(handler.observed.queries).toHaveLength(1)
    expect(handler.providerRequests).toEqual([])
  } finally {
    await handler.dispose()
  }
})

test('editorial content overlaps relation reads while retaining creators, labels and embeds', async () => {
  const handler = makeHandler()

  try {
    const response = await handler.get('/api/content/posts/editorials/published-editorial')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const post = decodePost(await response.json())
    expect(post.content).toBe(content)
    expect(post.tags).toEqual(['Listening'])
    expect(post.creators?.map((creator) => creator.name).sort()).toEqual(['Collaborator', 'Owner'])
    expect(post.richContent?.blocks.some(Predicate.isTagged('ExternalMediaEmbed'))).toBe(true)
    expect(handler.providerRequests).toEqual([content])
    expect(post).not.toHaveProperty('blueskySource')
    expect(handler.observed.queries).toHaveLength(3)
    expect(handler.observed.queries.some((query) => query.includes('bluesky_post_sources'))).toBe(
      false,
    )
    expect(handler.observed.maxActive).toBe(2)

    handler.observed.reset()
    const generic = await handler.get('/api/content/posts/published-editorial')
    expect(generic.status).toBe(200)
    expect(await generic.json()).toMatchObject({
      blueskySource: {
        authorDid: 'did:plc:historical-editorial',
        publicUrl: 'https://bsky.app/profile/historical.example/post/editorial',
      },
    })
    expect(handler.observed.queries).toHaveLength(4)
  } finally {
    await handler.dispose()
  }
})
