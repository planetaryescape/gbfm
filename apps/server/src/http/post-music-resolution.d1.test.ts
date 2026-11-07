import { ResolvePostMusicResponse } from '@gbfm/api/post'
import { decodeResponseBody } from '@gbfm/api/testing'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { makeDatabaseClient } from '@/db/layer'
import {
  musicEntityLinksTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { postMusicReferencesTable } from '@/db/post-music-reference.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

test('post-scoped resolution authorizes the owner or admin and writes only the canonical attachment', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await seedMusicLookups(db)

  for (const role of ['owner', 'unrelated', 'admin']) {
    await db.insert(user).values({
      id: role,
      name: role,
      email: `${role}@example.test`,
      role: role === 'admin' ? 'admin' : 'creator',
    })
    await db
      .insert(session)
      .values({ id: role, userId: role, token: role, expiresAt: new Date(Date.now() + 60_000) })
  }

  const entityId = crypto.randomUUID()
  const url = 'https://open.spotify.com/track/PostResolutionFixture'
  await db.insert(musicTracksTable).values({
    id: entityId,
    title: 'Saved frequency',
    slug: 'saved-frequency',
    artistNames: ['Fixture artist'],
  })
  await db
    .insert(musicEntityLinksTable)
    .values({ entityType: 'track', entityId, platform: 'spotify', url, status: 'verified' })
  await db.insert(musicSourceIdentitiesTable).values({
    sourceKey: 'spotify:track:PostResolutionFixture',
    platform: 'spotify',
    sourceEntityType: 'track',
    externalId: 'PostResolutionFixture',
    canonicalUrl: url,
    state: 'resolved',
    entityType: 'track',
    entityId,
    resolvedAt: new Date(),
  })

  const id = crypto.randomUUID()
  const content = `Read [the notes](https://example.test/notes), then listen: [track](${url}?si=tracking).`
  await db
    .insert(postsTable)
    .values({ id, title: 'Saved draft', slug: 'saved-draft', content, draft: true, type: 'micro' })
  await db.insert(postCreators).values({ postId: id, creatorId: 'owner' })

  const web = createTestWebHandler(resource.database)

  const resolve = (actor: string | null, postId = id, body: { readonly url?: string } = {}) =>
    web.handler(
      new Request(`http://localhost/api/content/posts/${postId}/resolve-music-entity`, {
        method: 'POST',
        headers: actor
          ? { authorization: `Bearer ${actor}`, 'content-type': 'application/json' }
          : { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

  try {
    expect((await resolve(null)).status).toBe(401)
    expect((await resolve('unrelated')).status).toBe(401)
    expect((await resolve('owner', crypto.randomUUID())).status).toBe(404)
    expect(
      (await db.select().from(postsTable).where(eq(postsTable.id, id)))[0]?.musicEntityId,
    ).toBeNull()

    const response = await resolve('owner')
    expect(response.status).toBe(200)
    expect(await decodeResponseBody(ResolvePostMusicResponse, response)).toMatchObject({
      postId: id,
      entityType: 'track',
      entityId,
      url,
      title: 'Saved frequency',
    })
    const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id))
    expect(post).toMatchObject({
      title: 'Saved draft',
      slug: 'saved-draft',
      content,
      draft: true,
      musicEntityId: entityId,
      musicEntityType: 'track',
    })
    expect(await db.select().from(postCreators).where(eq(postCreators.postId, id))).toEqual([
      { postId: id, creatorId: 'owner' },
    ])

    // With no authored URL left, re-resolution uses the attached entity's verified source.
    await db
      .update(postsTable)
      .set({ content: '', draft: false, type: 'post' })
      .where(eq(postsTable.id, id))
    expect((await resolve('admin')).status).toBe(200)
    expect((await resolve('owner', id, { url: 'https://127.0.0.1/private' })).status).toBe(400)
    expect((await db.select().from(postsTable).where(eq(postsTable.id, id)))[0]).toMatchObject({
      draft: false,
      type: 'post',
      musicEntityId: entityId,
    })

    // Clear the compatibility primary and its structured projection together, as real writers do.
    await db.batch([
      db
        .update(postsTable)
        .set({ musicEntityId: null, musicEntityType: null })
        .where(eq(postsTable.id, id)),
      db
        .update(postMusicReferencesTable)
        .set({ isPrimary: false })
        .where(eq(postMusicReferencesTable.postId, id)),
    ])
    const missing = await resolve('owner')
    expect(missing.status).toBe(422)
    expect(await missing.json()).toMatchObject({
      message: expect.stringContaining('No music link found'),
    })
    await db
      .update(postsTable)
      .set({ content: `${url}\nhttps://open.spotify.com/album/OtherFixture` })
      .where(eq(postsTable.id, id))
    const ambiguous = await resolve('owner')
    expect(ambiguous.status).toBe(422)
    expect(await ambiguous.json()).toMatchObject({
      message: expect.stringContaining('Several music links'),
    })
    expect((await resolve('owner', id, { url })).status).toBe(200)
  } finally {
    await web.dispose()
  }
}, 30_000)
