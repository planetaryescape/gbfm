import { SiteMetadata } from '@gbfm/site-metadata'
import { TweetCardPresentation } from '@gbfm/social-card'
import { eq } from 'drizzle-orm'
import { Layer, Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { musicTracksTable } from '@/db/music-entity.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import { d1, db } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'
import { observedD1 } from '@/test/observed-d1'

const content = 'https://fixture.bandcamp.com/album/tweet-metadata'

const createdAt = new Date('2026-01-01T00:00:00Z')

const updatedAt = new Date('2026-01-02T00:00:00Z')

const decodeMetadata = Schema.decodeUnknownSync(SiteMetadata)

const decodeCard = Schema.decodeUnknownSync(TweetCardPresentation)

beforeAll(async () => {
  await db.batch([
    db.insert(user).values([
      {
        id: 'author',
        name: 'Author',
        username: 'metadata-author',
        email: 'metadata-author@example.com',
        image: 'https://example.com/avatar.png',
      },
      { id: 'collaborator', name: 'Collaborator', email: 'collaborator@example.com' },
    ]),
    db.insert(musicTracksTable).values({
      id: 'track',
      slug: 'metadata-track',
      title: 'Selected track',
      artistNames: ['Artist'],
      coverImageUrl: 'https://example.com/cover.png',
    }),
    db.insert(postsTable).values([
      {
        id: 'published',
        slug: 'published',
        title: 'Listening notes',
        description: 'A description',
        content,
        type: 'micro',
        draft: false,
        musicEntityType: 'track',
        musicEntityId: 'track',
        createdAt,
        updatedAt,
      },
      { id: 'draft', slug: 'draft', title: 'Private', content, type: 'micro', draft: true },
      {
        id: 'editorial',
        slug: 'editorial',
        title: 'Editorial',
        content,
        type: 'post',
        draft: false,
      },
      {
        id: 'unattributed',
        slug: 'unattributed',
        content: 'Body only',
        type: 'micro',
        draft: false,
      },
    ]),
    db.insert(postCreators).values([
      { postId: 'published', creatorId: 'author' },
      { postId: 'published', creatorId: 'collaborator' },
    ]),
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

test('tweet metadata and social cards preserve full-post projections without rendering embeds', async () => {
  const handler = makeHandler()

  try {
    const response = await handler.get('/api/site-metadata/tweet/published')
    expect(response.status).toBe(200)
    const metadata = decodeMetadata(await response.json())
    expect(metadata).toMatchObject({
      description: 'A description',
      publishedAt: createdAt.toISOString(),
      modifiedAt: updatedAt.toISOString(),
    })
    expect(JSON.stringify(metadata)).toContain('Author')
    expect(JSON.stringify(metadata)).toContain('Collaborator')
    expect(handler.observed.queries).toHaveLength(2)
    expect(handler.providerRequests).toEqual([])

    handler.observed.reset()
    const cardResponse = await handler.get('/api/social-cards/tweet/published')
    expect(cardResponse.status).toBe(200)
    const card = decodeCard(await cardResponse.json())
    expect(card.model).toMatchObject({
      commentary: 'Listening notes',
      authorName: 'Author',
      username: 'metadata-author',
      avatarUrl: 'https://example.com/avatar.png',
      entityTitle: 'Selected track',
      entityArtists: 'Artist',
      coverImageUrl: 'https://example.com/cover.png',
    })
    expect(metadata.image.url).toBe(card.images.openGraph)
    expect(handler.observed.queries).toHaveLength(2)
    expect(handler.providerRequests).toEqual([])

    const legacyMetadata = await handler.get('/api/site-metadata/post/published')
    expect(legacyMetadata.status).toBe(200)
    expect(decodeMetadata(await legacyMetadata.json())).toEqual(metadata)
    expect(handler.providerRequests).toEqual([content])
  } finally {
    await handler.dispose()
  }
})

test('tweet presentation excludes drafts, other post types and missing posts', async () => {
  const handler = makeHandler()

  try {
    for (const kind of ['site-metadata', 'social-cards']) {
      for (const slug of ['draft', 'editorial', 'missing']) {
        handler.observed.reset()
        expect((await handler.get(`/api/${kind}/tweet/${slug}`)).status).toBe(404)
        expect(handler.observed.queries).toEqual(['batch'])
      }
    }

    expect(handler.providerRequests).toEqual([])
  } finally {
    await handler.dispose()
  }
})

test('body-only tweets without creators or primary music retain their presentation', async () => {
  const handler = makeHandler()

  try {
    const response = await handler.get('/api/site-metadata/tweet/unattributed')
    expect(response.status).toBe(200)
    const metadata = decodeMetadata(await response.json())
    expect(handler.observed.queries).toEqual(['batch'])
    const legacy = await handler.get('/api/site-metadata/post/unattributed')
    expect(decodeMetadata(await legacy.json())).toEqual(metadata)
    const card = await handler.get('/api/social-cards/tweet/unattributed')
    expect(decodeCard(await card.json()).model).toMatchObject({
      commentary: '',
      authorName: null,
      avatarUrl: null,
      entityTitle: null,
    })
    expect(handler.providerRequests).toEqual([])
  } finally {
    await handler.dispose()
  }
})

test('fresh tweet presentations reflect creator avatar and artwork updates', async () => {
  const handler = makeHandler()

  try {
    await db
      .update(user)
      .set({ image: 'https://example.com/new-avatar.png' })
      .where(eq(user.id, 'author'))
    await db
      .update(postsTable)
      .set({ thumbnailUrl: 'https://example.com/mosaic.png' })
      .where(eq(postsTable.id, 'published'))
    const response = await handler.get('/api/social-cards/tweet/published')
    expect(response.status).toBe(200)
    expect(decodeCard(await response.json()).model).toMatchObject({
      avatarUrl: 'https://example.com/new-avatar.png',
      coverImageUrl: 'https://example.com/mosaic.png',
    })
    expect(handler.observed.queries).toHaveLength(2)
    expect(handler.providerRequests).toEqual([])
  } finally {
    await handler.dispose()
    await db
      .update(user)
      .set({ image: 'https://example.com/avatar.png' })
      .where(eq(user.id, 'author'))
    await db.update(postsTable).set({ thumbnailUrl: null }).where(eq(postsTable.id, 'published'))
  }
})
