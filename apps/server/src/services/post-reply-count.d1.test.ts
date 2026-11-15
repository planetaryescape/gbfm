/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Structural expectations describe decoded rich-content response values at the service boundary. */
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { beforeAll, describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { blueskyPostSources } from '@/db/external-account.schema'
import { replaceEntityLabels } from '@/db/labels'
import { postCreators, postsTable } from '@/db/post.schema'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { SentryEnabled, type SentryService, SentryServiceLayer } from '@/services/sentry.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { PostService, PostServiceLayer } from './post.service'

const SEARCH_TERM = 'zephyrine'

const parentWithRepliesId = randomUUID()

const parentWithoutRepliesId = randomUUID()

const TestPostServiceLayer = PostServiceLayer.pipe(
  Layer.provide(MdxServiceLayer),
  Layer.provide(UnavailableObjectStoreClientLayer),
  Layer.provide(Layer.mergeAll(ConfigServiceLayer, UploadAssetServiceLayer)),
  Layer.provide(DatabaseTestLayer),
)

const TestSentryLayer = SentryServiceLayer.pipe(
  Layer.provide(Layer.succeed(SentryEnabled, { enabled: false })),
)

const runPostEffect = <A, E>(fn: (service: PostService) => Effect.Effect<A, E, SentryService>) =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const service = yield* PostService

        return yield* fn(service)
      }),
      Layer.mergeAll(TestPostServiceLayer, TestSentryLayer),
    ),
  )

beforeAll(async () => {
  await db.insert(postsTable).values([
    {
      id: parentWithRepliesId,
      title: `${SEARCH_TERM} parent with replies`,
      slug: `zephyrine-parent-replies-${parentWithRepliesId}`,
      content: 'parent body',
      type: 'micro',
      draft: false,
    },
    {
      id: parentWithoutRepliesId,
      title: `${SEARCH_TERM} parent without replies`,
      slug: `zephyrine-parent-lonely-${parentWithoutRepliesId}`,
      content: 'parent body',
      type: 'micro',
      draft: false,
    },
  ])

  await db.insert(postsTable).values(
    [1, 2].map((index) => {
      const id = randomUUID()

      return {
        id,
        title: `reply ${index}`,
        slug: `zephyrine-reply-${id}`,
        content: 'reply body',
        type: 'micro' as const,
        draft: false,
        parentPostId: parentWithRepliesId,
        rootPostId: parentWithRepliesId,
        depth: 1,
      }
    }),
  )
})

describe('searchMicroPosts reply counts', () => {
  test('canonical music filtering includes replies but excludes drafts, editorials and other identities', async () => {
    const entityId = randomUUID()
    const otherEntityId = randomUUID()
    const ownerId = randomUUID()
    const otherOwnerId = randomUUID()
    const referenceParentId = randomUUID()
    await db.insert(postsTable).values({
      id: referenceParentId,
      slug: referenceParentId,
      type: 'micro',
      title: 'Reference parent',
      draft: false,
    })
    await db.insert(user).values([
      { id: ownerId, email: `${ownerId}@example.test`, name: 'Aya' },
      { id: otherOwnerId, email: `${otherOwnerId}@example.test`, name: 'Ben' },
    ])

    const rows = (
      [
        {
          title: 'Published reference',
          type: 'micro',
          draft: false,
          musicEntityType: 'track',
          musicEntityId: entityId,
        },
        {
          title: 'Reply reference',
          type: 'micro',
          draft: false,
          musicEntityType: 'track',
          musicEntityId: entityId,
          parentPostId: referenceParentId,
        },
        {
          title: 'Own private draft',
          type: 'micro',
          draft: true,
          musicEntityType: 'track',
          musicEntityId: entityId,
        },
        {
          title: 'Other author private draft',
          type: 'micro',
          draft: true,
          musicEntityType: 'track',
          musicEntityId: entityId,
        },
        {
          title: 'Editorial reference',
          type: 'post',
          draft: false,
          musicEntityType: 'track',
          musicEntityId: entityId,
        },
        {
          title: 'Wrong entity type',
          type: 'micro',
          draft: false,
          musicEntityType: 'album',
          musicEntityId: entityId,
        },
        {
          title: 'Wrong entity ID',
          type: 'micro',
          draft: false,
          musicEntityType: 'track',
          musicEntityId: otherEntityId,
        },
      ] as const
    ).map((row) => ({ ...row, id: randomUUID(), slug: randomUUID(), content: 'Listening notes' }))

    await db.insert(postsTable).values(rows)
    await db.insert(postCreators).values(
      rows.map((row, index) => ({
        postId: row.id,
        creatorId: index === 3 ? otherOwnerId : ownerId,
      })),
    )

    const first = await runPostEffect((service) =>
      service.getMicroPosts({
        limit: 1,
        offset: 0,
        musicEntityType: 'track',
        musicEntityId: entityId,
      }),
    )

    const second = await runPostEffect((service) =>
      service.getMicroPosts({
        limit: 1,
        offset: 1,
        musicEntityType: 'track',
        musicEntityId: entityId,
      }),
    )

    expect(first.pagination).toMatchObject({ total: 2, hasMore: true })
    expect(second.pagination).toMatchObject({ total: 2, hasMore: false })
    expect(
      [...first.data, ...second.data]
        .map((post) => post.title)
        .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual(['Published reference', 'Reply reference'])
    expect(first.data[0]?.creators?.[0]?.name).toBe('Aya')
  })

  test('reports the direct reply count for a searched tweet that has replies', async () => {
    const result = await runPostEffect((service) =>
      service.searchMicroPosts({ q: SEARCH_TERM, limit: 20, offset: 0 }),
    )

    const match = result.data.find((post) => post.id === parentWithRepliesId)

    expect(match).toBeDefined()
    expect(match?.replyCount).toBe(2)
  })

  test('reports zero for a searched tweet with no replies', async () => {
    const result = await runPostEffect((service) =>
      service.searchMicroPosts({ q: SEARCH_TERM, limit: 20, offset: 0 }),
    )

    const match = result.data.find((post) => post.id === parentWithoutRepliesId)

    expect(match).toBeDefined()
    expect(match?.replyCount).toBe(0)
  })

  test('returns an empty page without failing when nothing matches', async () => {
    const result = await runPostEffect((service) =>
      service.searchMicroPosts({ q: 'qwyxlbtnvz', limit: 20, offset: 0 }),
    )

    expect(result.data).toEqual([])
    expect(result.pagination.total).toBe(0)
  })

  test('returns an empty page when the offset is past the end of the results', async () => {
    const result = await runPostEffect((service) =>
      service.searchMicroPosts({ q: SEARCH_TERM, limit: 20, offset: 500 }),
    )

    expect(result.data).toEqual([])
  })
})

describe('getMicroPosts reply counts', () => {
  test('populates reply counts on the tweet listing', async () => {
    const result = await runPostEffect((service) =>
      service.getMicroPosts({ limit: 100, offset: 0 }),
    )

    const withReplies = result.data.find((post) => post.id === parentWithRepliesId)
    const withoutReplies = result.data.find((post) => post.id === parentWithoutRepliesId)

    expect(withReplies?.replyCount).toBe(2)
    expect(withoutReplies?.replyCount).toBe(0)
  })
})

describe('getMicroPostBySlug reply counts', () => {
  test('reports direct replies so the tweet screen can size its replies area up front', async () => {
    const withReplies = await runPostEffect((service) =>
      service.getMicroPostBySlug(`zephyrine-parent-replies-${parentWithRepliesId}`),
    )

    const withoutReplies = await runPostEffect((service) =>
      service.getMicroPostBySlug(`zephyrine-parent-lonely-${parentWithoutRepliesId}`),
    )

    expect(withReplies.replyCount).toBe(2)
    expect(withoutReplies.replyCount).toBe(0)
  })
})

describe('post hydration through the service interface', () => {
  const rootId = randomUUID()
  const replyId = randomUUID()
  const emptyId = randomUUID()
  const invalidId = randomUUID()
  const creator = { id: randomUUID(), name: 'Hydration author', username: null, image: null }

  const coauthor = {
    id: randomUUID(),
    name: 'Coauthor',
    username: 'hydration-coauthor',
    image: null,
  }

  const rootSlug = `hydration-${rootId}`
  const replySlug = `hydration-${replyId}`

  const source = {
    authorDid: 'did:plc:hydration',
    authorHandle: 'hydration.example',
    publicUrl: 'https://bsky.app/profile/hydration.example/post/test',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceStatus: 'active' as const,
    locallyEdited: false,
    lastError: null,
  }

  beforeAll(async () => {
    await db
      .insert(user)
      .values(
        [creator, coauthor].map((author) => ({ ...author, email: `${author.id}@example.com` })),
      )
    await db.insert(postsTable).values([
      { id: rootId, slug: rootSlug, title: 'Hydration root', content: '**root**', type: 'micro' },
      ...[
        { id: replyId, content: '<Unclosed', type: 'micro' as const },
        { id: emptyId, content: null, type: 'micro' as const },
        { id: invalidId, content: 'editorial body', type: 'post' as const },
      ].map((row, index) => ({
        ...row,
        slug: `hydration-${row.id}`,
        title: `Hydration reply ${index}`,
        parentPostId: rootId,
        rootPostId: rootId,
        depth: 1,
        createdAt: new Date(Date.UTC(2026, 0, index + 2)),
      })),
    ])
    await db.insert(postCreators).values([
      { postId: rootId, creatorId: creator.id },
      { postId: replyId, creatorId: creator.id },
      { postId: replyId, creatorId: coauthor.id },
    ])
    await replaceEntityLabels(db, 'post', rootId, { tags: ['root-tag'] })
    await replaceEntityLabels(db, 'post', replyId, {
      tags: ['second', 'first'],
      genres: ['ambient'],
    })
    await db.insert(blueskyPostSources).values({
      ...source,
      postId: replyId,
      atUri: `at://did:plc:hydration/app.bsky.feed.post/${replyId}`,
    })
  })

  test('list and single reads retain imported content without source enrichment', async () => {
    const list = await runPostEffect((service) => service.getAll({ limit: 100, offset: 0 }))
    const single = await runPostEffect((service) => service.getBySlug(replySlug))
    const bySlug = await runPostEffect((service) => service.getMicroPostBySlug(replySlug))
    const byId = await runPostEffect((service) => service.getMicroPostById(replyId))
    const listed = list.data.find((post) => post.id === replyId)
    expect(listed).toEqual(single)
    expect(bySlug).toEqual({ ...single, replyCount: 0 })
    expect(byId).toEqual(single)
    expect(single).toMatchObject({
      tags: ['second', 'first'],
      genres: ['ambient'],
      compiledContent: '',
      richContent: {
        version: 1,
        blocks: [
          {
            _tag: 'Paragraph',
            children: [{ _tag: 'Text', value: '<Unclosed' }],
          },
        ],
      },
    })
    expect(single.creators).toHaveLength(2)
    expect(single).not.toHaveProperty('blueskySource')
    expect(
      await db.select().from(blueskyPostSources).where(eq(blueskyPostSources.postId, replyId)),
    ).toMatchObject([{ ...source, postId: replyId }])
    expect(single.creators).toEqual(expect.arrayContaining([creator, coauthor]))
    expect(list.data.find((post) => post.id === emptyId)).toMatchObject({
      tags: null,
      genres: null,
      creators: [],
      compiledContent: '',
      richContent: { version: 1, blocks: [] },
    })
    expect(list.data.find((post) => post.id === rootId)?.richContent).toEqual({
      version: 1,
      blocks: [
        {
          _tag: 'Paragraph',
          children: [{ _tag: 'Strong', children: [{ _tag: 'Text', value: 'root' }] }],
        },
      ],
    })
  })

  test('search, replies and thread share hydration without changing endpoint refinements', async () => {
    const search = await runPostEffect((service) =>
      service.searchMicroPosts({ q: 'Hydration', limit: 100, offset: 0 }),
    )

    const replies = await runPostEffect((service) =>
      service.getMicroPostReplies(rootSlug, { limit: 100, offset: 0 }),
    )

    const thread = await runPostEffect((service) =>
      service.getMicroPostThread(replySlug, { limit: 100, offset: 0 }),
    )

    const searched = search.data.find((post) => post.id === replyId)
    expect(replies.data[0]).toEqual(searched)
    expect(searched).toMatchObject({
      tags: ['second', 'first'],
      genres: ['ambient'],
      compiledContent: '',
      replyCount: 0,
    })
    expect(searched?.creators).toEqual(expect.arrayContaining([creator, coauthor]))
    expect(searched).not.toHaveProperty('blueskySource')
    expect(thread.focus).toEqual(thread.posts[0])
    expect(thread.focus).not.toHaveProperty('replyCount')
    expect({ ...thread.focus, replyCount: 0 }).toEqual(searched)
    expect(thread.root).toMatchObject({ id: rootId, tags: ['root-tag'], creators: [creator] })
    expect(thread.root.richContent.blocks[0]).toEqual({
      _tag: 'Paragraph',
      children: [{ _tag: 'Strong', children: [{ _tag: 'Text', value: 'root' }] }],
    })
    expect(replies.data.map((post) => post.id)).toEqual([replyId, emptyId])
    expect(thread.posts.map((post) => post.id)).toEqual([replyId, emptyId])
    expect(replies.pagination.total).toBe(3)
    expect(thread.pagination.total).toBe(3)
  })

  test('thread root/focus overlap and empty pages preserve context and pagination', async () => {
    const thread = await runPostEffect((service) =>
      service.getMicroPostThread(rootSlug, { limit: 20, offset: 100 }),
    )

    expect(thread.root).toEqual(thread.focus)
    expect(thread.root.tags).toEqual(['root-tag'])
    expect(thread.posts).toEqual([])
    expect(thread.pagination.total).toBe(3)

    const replies = await runPostEffect((service) =>
      service.getMicroPostReplies(rootSlug, { limit: 20, offset: 100 }),
    )

    expect(replies.data).toEqual([])
    expect(replies.pagination.total).toBe(3)
  })

  test('invalid thread focus remains a refinement error rather than being silently dropped', async () => {
    await expect(
      runPostEffect((service) =>
        service.getMicroPostThread(`hydration-${invalidId}`, { limit: 20, offset: 0 }),
      ),
    ).rejects.toMatchObject({
      operation: 'post_type_refinement',
      message: `Focus post was not a micro post: hydration-${invalidId}`,
    })
  })
})
