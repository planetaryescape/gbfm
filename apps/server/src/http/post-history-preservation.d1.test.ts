import { CompiledMicroPostResponse, GetPostsResponse } from '@gbfm/api/post'
import { eq } from 'drizzle-orm'
import { Schema } from 'effect'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { blueskyPostSources } from '@/db/external-account.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { d1, db } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'
import { observedD1 } from '@/test/observed-d1'

const ownerId = 'history-owner'

const otherId = 'history-other'

const importedSlug = 'historical-published'

const draftSlug = 'historical-draft'

const otherDraftSlug = 'other-private-draft'

const observed = observedD1(d1)

const handler = createTestWebHandler(observed.database)

const decodeList = Schema.decodeUnknownSync(GetPostsResponse)

const decodeMicro = Schema.decodeUnknownSync(CompiledMicroPostResponse)

const request = (path: string, token?: string) =>
  handler.handler(
    new Request(`https://api.example.com${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

beforeAll(async () => {
  await db.batch([
    db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        role: 'creator',
      })),
    ),
    db.insert(session).values({
      id: 'history-session',
      token: 'history-session-token',
      userId: ownerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
    db.insert(postsTable).values(
      [importedSlug, 'native-published', draftSlug, otherDraftSlug].map((slug, index) => ({
        id: slug,
        slug,
        title: `Preserved ${slug}`,
        content: `Body for ${slug}`,
        type: 'micro' as const,
        draft: index >= 2,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      })),
    ),
    db.insert(postCreators).values(
      [importedSlug, 'native-published', draftSlug, otherDraftSlug].map((postId) => ({
        postId,
        creatorId: postId === otherDraftSlug ? otherId : ownerId,
      })),
    ),
    db.insert(blueskyPostSources).values(
      [importedSlug, draftSlug].map((postId) => ({
        id: `history-${postId}`,
        postId,
        authorDid: 'did:plc:retired-import',
        publicUrl: `https://bsky.app/profile/retired.example/post/${postId}`,
        atUri: `at://did:plc:retired-import/app.bsky.feed.post/${postId}`,
        sourceCreatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    ),
  ])
})

afterAll(() => handler.dispose())

test('published imported tweets remain readable without loading historical provenance', async () => {
  observed.reset()
  const listResponse = await request('/api/content/posts?type=micro')
  expect(listResponse.status).toBe(200)
  const list = decodeList(await listResponse.json())
  expect(list.data.map((post) => post.slug)).toEqual(['native-published', importedSlug])
  expect(list.pagination.total).toBe(2)
  expect(list.data.every((post) => !('blueskySource' in post))).toBe(true)

  for (const path of [
    `/api/content/posts/${importedSlug}`,
    `/api/content/posts/micro/${importedSlug}`,
  ]) {
    const response = await request(path)
    expect(response.status).toBe(200)
    const post = decodeMicro(await response.json())
    expect(post).toMatchObject({
      slug: importedSlug,
      content: `Body for ${importedSlug}`,
      draft: false,
      creators: [{ id: ownerId, name: ownerId }],
    })
    expect(post).not.toHaveProperty('blueskySource')
  }

  expect(observed.statements.some((query) => query.includes('bluesky_post_sources'))).toBe(false)
  expect(await db.select().from(blueskyPostSources)).toHaveLength(2)
})

test('imported drafts remain in the owner library without exposing another creator draft', async () => {
  observed.reset()

  const response = await request(
    '/api/content/posts/manage?type=micro&status=draft',
    'history-session-token',
  )

  expect(response.status).toBe(200)
  const library = decodeList(await response.json())
  expect(library.data.map((post) => post.slug)).toEqual([draftSlug])
  expect(library.pagination.total).toBe(1)
  expect(library.data[0]?.content).toBe(`Body for ${draftSlug}`)
  expect(JSON.stringify(library)).not.toContain(otherDraftSlug)
  expect(observed.statements.some((query) => query.includes('bluesky_post_sources'))).toBe(false)
  expect(
    await db.select().from(blueskyPostSources).where(eq(blueskyPostSources.postId, draftSlug)),
  ).toMatchObject([{ id: `history-${draftSlug}`, postId: draftSlug }])

  expect((await request(`/api/content/posts/${draftSlug}`)).status).toBe(404)
  expect((await request(`/api/content/posts/micro/${draftSlug}`)).status).toBe(404)
  expect((await request('/api/content/posts/manage?status=draft')).status).toBe(401)
})
