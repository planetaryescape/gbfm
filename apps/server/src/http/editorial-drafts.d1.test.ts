import { CompiledEditorialPostResponse, GetEditorialSummariesResponse } from '@gbfm/api/post'
import { eq } from 'drizzle-orm'
import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { db, d1 } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'

const ownerId = 'editorial-drafts-owner'

const otherId = 'editorial-drafts-other'

const adminId = 'editorial-drafts-admin'

const publishedSlug = 'editorial-drafts-published'

const draftSlug = 'editorial-drafts-private'

const otherDraftSlug = 'editorial-drafts-other-private'

let handler: ReturnType<typeof createTestWebHandler>

const request = (path: string, token?: string) =>
  handler.handler(
    new Request(`http://localhost${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

beforeAll(async () => {
  handler = createTestWebHandler(d1)
  await db.insert(user).values(
    [ownerId, otherId, adminId].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      role: id === adminId ? 'admin' : 'creator',
    })),
  )
  await db.insert(session).values(
    [ownerId, otherId, adminId].map((id) => ({
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date(Date.now() + 86_400_000),
    })),
  )
  await db.insert(postsTable).values(
    [publishedSlug, draftSlug, otherDraftSlug].map((slug, index) => ({
      id: slug,
      slug,
      title: slug,
      content: `## Listening notes\n\n${slug} body.`,
      type: 'post' as const,
      draft: slug !== publishedSlug,
      createdAt: new Date(Date.UTC(2026, 9, 30, index)),
    })),
  )
  await db.insert(postCreators).values([
    { postId: publishedSlug, creatorId: otherId },
    { postId: draftSlug, creatorId: ownerId },
    { postId: otherDraftSlug, creatorId: otherId },
    { postId: draftSlug, creatorId: adminId },
  ])
})

afterAll(async () => handler.dispose())

describe('editorial draft reading', () => {
  test('the author sees published stories and only their own drafts in the reading list', async () => {
    const response = await request('/api/content/editorial-summaries', `token-${ownerId}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
    expect(response.headers.get('vary')).toContain('Authorization')
    const body = Schema.decodeUnknownSync(GetEditorialSummariesResponse)(await response.json())
    expect(body.data.map((post) => post.slug)).toEqual([draftSlug, publishedSlug])
    expect(body.data.find((post) => post.slug === draftSlug)?.draft).toBe(true)
    expect(body.pagination.total).toBe(2)
    expect(JSON.stringify(body)).not.toContain(otherDraftSlug)
  })

  test('pagination uses the same visibility policy as the returned rows', async () => {
    const response = await request(
      '/api/content/editorial-summaries?limit=1&offset=1',
      `token-${ownerId}`,
    )

    const body = Schema.decodeUnknownSync(GetEditorialSummariesResponse)(await response.json())
    expect(body.data.map((post) => post.slug)).toEqual([publishedSlug])
    expect(body.pagination).toMatchObject({ total: 2, limit: 1, offset: 1, hasMore: false })
  })

  test('a draft renders through the normal editorial detail endpoint for its author', async () => {
    const response = await request(`/api/content/posts/editorials/${draftSlug}`, `token-${ownerId}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const post = Schema.decodeUnknownSync(CompiledEditorialPostResponse)(await response.json())
    expect(post.draft).toBe(true)
    expect(post.richContent?.blocks.length).toBeGreaterThan(0)
    expect(post.creators?.some((creator) => creator.id === ownerId)).toBe(true)
  })

  test('anonymous, unrelated, invalid and expired sessions cannot read a draft', async () => {
    await db.insert(session).values({
      id: 'editorial-drafts-expired',
      token: 'editorial-drafts-expired',
      userId: ownerId,
      expiresAt: new Date(Date.now() - 86_400_000),
    })

    for (const token of [
      undefined,
      `token-${otherId}`,
      'invalid-session',
      'editorial-drafts-expired',
    ]) {
      const response = await request(`/api/content/posts/editorials/${draftSlug}`, token)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain(`${draftSlug} body`)
    }
  })

  test('anonymous listing stays published-only after an author requests the same URL', async () => {
    await request('/api/content/editorial-summaries', `token-${ownerId}`)
    const response = await request('/api/content/editorial-summaries')
    const body = Schema.decodeUnknownSync(GetEditorialSummariesResponse)(await response.json())
    expect(body.data.map((post) => post.slug)).toEqual([publishedSlug])
    expect(body.pagination.total).toBe(1)
    expect(JSON.stringify(body)).not.toContain(draftSlug)
    expect(JSON.stringify(body)).not.toContain(otherDraftSlug)
  })

  test('admin readers see only drafts they authored, rather than every managed draft', async () => {
    const response = await request('/api/content/editorial-summaries', `token-${adminId}`)
    const body = Schema.decodeUnknownSync(GetEditorialSummariesResponse)(await response.json())
    expect(body.data.map((post) => post.slug)).toEqual([draftSlug, publishedSlug])
    expect(
      (await request(`/api/content/posts/editorials/${otherDraftSlug}`, `token-${adminId}`)).status,
    ).toBe(404)
  })

  test('forged identity headers do not grant draft access', async () => {
    const response = await handler.handler(
      new Request(`http://localhost/api/content/posts/editorials/${draftSlug}`, {
        headers: { 'x-user-id': ownerId, 'x-user-role': 'admin' },
      }),
    )

    expect(response.status).toBe(404)
  })

  test('revoking authorship removes reading access on the next request', async () => {
    await db.delete(postCreators).where(eq(postCreators.creatorId, adminId))
    expect(
      (await request(`/api/content/posts/editorials/${draftSlug}`, `token-${adminId}`)).status,
    ).toBe(404)
  })
})
