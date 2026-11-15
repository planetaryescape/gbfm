import type { D1Database } from '@cloudflare/workers-types'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicPlaylistsTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { postsTable } from '@/db/post.schema'
import { d1, db } from '@/test/database'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createTestWebHandler } from '@/test/http-handler'
import { observedD1 } from '@/test/observed-d1'

const bodyUrl = 'https://open.spotify.com/track/1234567890123456789012'

const decodeScreen = Schema.decodeUnknownSync(MicroPostScreenResponse)

const get = (handler: ReturnType<typeof createTestWebHandler>, slug: string, main = true) =>
  handler.handler(
    new Request(
      `https://api.example.com/api/content/posts/micro/${slug}/screen${main ? '?part=main' : ''}`,
    ),
  )

beforeAll(async () => {
  await db.batch([
    db
      .insert(musicEntityTypesTable)
      .values([
        { id: 'album', displayName: 'Album' },
        { id: 'track', displayName: 'Track' },
        { id: 'playlist', displayName: 'Playlist' },
      ])
      .onConflictDoNothing(),
    db
      .insert(musicPlatformsTable)
      .values({ id: 'spotify', displayName: 'Spotify' })
      .onConflictDoNothing(),
    db.insert(musicAlbumsTable).values({
      id: 'selected',
      slug: 'selected',
      title: 'Selected album',
      artistNames: null,
      coverImageUrl: '',
    }),
    db.insert(musicTracksTable).values({
      id: 'body-track',
      slug: 'body-track',
      title: 'Body track',
      artistNames: ['Body artist'],
    }),
    db.insert(musicPlaylistsTable).values([
      {
        id: 'public-playlist',
        slug: 'public-playlist',
        title: 'Public playlist',
        publishedAt: new Date('2020-01-01'),
      },
      { id: 'draft-playlist', slug: 'draft-playlist', title: 'Private playlist' },
      {
        id: 'future-playlist',
        slug: 'future-playlist',
        title: 'Future playlist',
        publishedAt: new Date('2100-01-01'),
      },
    ]),
    db.insert(musicEntityLinksTable).values([
      {
        entityType: 'album',
        entityId: 'selected',
        platform: 'spotify',
        url: 'https://open.spotify.com/album/selected',
        status: 'verified',
      },
      {
        entityType: 'playlist',
        entityId: 'draft-playlist',
        platform: 'spotify',
        url: 'https://open.spotify.com/playlist/private',
        status: 'verified',
      },
    ]),
    db.insert(musicSourceIdentitiesTable).values({
      sourceKey: 'spotify:track:1234567890123456789012',
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: '1234567890123456789012',
      canonicalUrl: bodyUrl,
      state: 'resolved',
      entityType: 'track',
      entityId: 'body-track',
      resolvedAt: new Date('2020-01-01'),
    }),
  ])
  const selected = { musicEntityType: 'album', musicEntityId: 'selected' }

  const posts = [
    { id: 'flat', content: bodyUrl, ...selected },
    { id: 'same', content: '::album{id="selected"}', ...selected },
    { id: 'plain', content: 'Prose with a selected record.', ...selected },
    { id: 'body-only', content: bodyUrl },
    { id: 'empty', content: '' },
    { id: 'missing-record', content: bodyUrl, musicEntityType: 'track', musicEntityId: 'missing' },
    {
      id: 'public',
      content: bodyUrl,
      musicEntityType: 'playlist',
      musicEntityId: 'public-playlist',
    },
    {
      id: 'private',
      content: bodyUrl,
      musicEntityType: 'playlist',
      musicEntityId: 'draft-playlist',
    },
    {
      id: 'future',
      content: bodyUrl,
      musicEntityType: 'playlist',
      musicEntityId: 'future-playlist',
    },
    { id: 'root', content: 'Thread root.', ...selected },
    {
      id: 'quote',
      content: 'Quoted post.',
      musicEntityType: 'playlist',
      musicEntityId: 'public-playlist',
    },
  ]

  for (const post of posts)
    await db.insert(postsTable).values({ ...post, slug: post.id, type: 'micro', draft: false })
  await db.insert(postsTable).values([
    {
      id: 'reply',
      slug: 'reply',
      type: 'micro',
      draft: false,
      content: bodyUrl,
      parentPostId: 'root',
      rootPostId: 'root',
      depth: 1,
      musicEntityType: 'track',
      musicEntityId: 'body-track',
    },
    {
      id: 'quoted',
      slug: 'quoted',
      type: 'micro',
      draft: false,
      content: bodyUrl,
      quotedPostId: 'quote',
      ...selected,
    },
    { id: 'draft', slug: 'draft', type: 'micro', draft: true, content: bodyUrl, ...selected },
    {
      id: 'editorial',
      slug: 'editorial',
      type: 'post',
      draft: false,
      title: 'Editorial',
      content: 'Not a tweet.',
    },
  ])
})

test.each([
  'flat',
  'same',
  'plain',
  'body-only',
  'empty',
  'missing-record',
  'public',
  'private',
  'future',
  'root',
  'reply',
  'quoted',
])('main screen preserves the existing full-screen projection for %s', async (slug) => {
  const handler = createTestWebHandler(d1)

  try {
    const control = await get(handler, slug, false)
    expect(control.status).toBe(200)
    const expected = decodeScreen(await control.json())
    const response = await get(handler, slug)
    expect(response.status).toBe(200)
    expect(decodeScreen(await response.json())).toEqual({ ...expected, replies: [] })
  } finally {
    await handler.dispose()
  }
})

test('selected music retains raw nullable fields instead of borrowing normalized body-card fields', async () => {
  const handler = createTestWebHandler(d1)

  try {
    const response = await get(handler, 'same')
    const screen = decodeScreen(await response.json())
    expect(screen.post.music).toMatchObject({ entity: { artistNames: null, coverImageUrl: '' } })
    expect(screen.post.richContent?.blocks[0]).toMatchObject({
      music: { artists: [], imageUrl: null },
    })

    for (const slug of ['private', 'future', 'missing-record', 'body-only', 'empty']) {
      const response = await get(handler, slug)
      const body = decodeScreen(await response.json())
      expect(body.post.music).toBeNull()
      expect(JSON.stringify(body)).not.toContain('Private playlist')
      expect(JSON.stringify(body)).not.toContain('playlist/private')
      expect(JSON.stringify(body)).not.toContain('Future playlist')
    }
  } finally {
    await handler.dispose()
  }
})

test.each(['draft', 'editorial', 'absent'])(
  'main screen retains 404 behavior for %s',
  async (slug) => {
    const handler = createTestWebHandler(d1)

    try {
      expect((await get(handler, slug)).status).toBe(404)
    } finally {
      await handler.dispose()
    }
  },
)

test('selected music finishes while body hydration is paused, without sending an early response', async () => {
  const body = gatedPostDatabase(d1, 'before', /from "music_source_aliases"/i)
  const music = gatedPostDatabase(body.database, 'after', /from "music_playlists"/i)
  const handler = createTestWebHandler(music.database)
  let responded = false

  const response = get(handler, 'flat').then((response) => {
    responded = true

    return response
  })

  const deadline = AbortSignal.timeout(2500)

  const timedOut = new Promise<never>((_, reject) => {
    deadline.addEventListener(
      'abort',
      () => reject(new Error('Screen music did not overlap paused body hydration')),
      { once: true },
    )
  })

  try {
    await Promise.race([Promise.all([body.reached, music.reached]), timedOut])
    expect(responded).toBe(false)
  } finally {
    music.release()
    body.release()
    const result = await response
    expect(result.status).toBe(200)
    expect(decodeScreen(await result.json()).post.music?.entity.title).toBe('Selected album')
    await handler.dispose()
  }
})

test('generic post and main-screen reads keep their existing batch budgets', async () => {
  const observed = observedD1(d1)

  for (const { path, batches } of [
    { path: '/api/content/posts/micro/flat', batches: 3 },
    { path: '/api/content/posts/micro/flat/screen?part=main', batches: 4 },
    { path: '/api/content/posts/micro/flat/screen', batches: 5 },
    { path: '/api/content/posts/micro/plain', batches: 1 },
    { path: '/api/content/posts/micro/plain/screen?part=main', batches: 2 },
    { path: '/api/content/posts/micro/body-only/screen?part=main', batches: 3 },
  ]) {
    const handler = createTestWebHandler(observed.database)

    try {
      observed.reset()
      const response = await handler.handler(new Request(`https://api.example.com${path}`))
      expect(response.status).toBe(200)
      expect(observed.queries).toEqual(Array(batches).fill('batch'))
    } finally {
      await handler.dispose()
    }
  }
})

test('a selected-music database failure remains an HTTP failure rather than an unavailable body card', async () => {
  const database: D1Database = {
    prepare: (query) => {
      if (/from "music_playlists"/i.test(query))
        throw new Error('Injected screen projection read failure')

      return d1.prepare(query)
    },
    batch: (statements) => d1.batch(statements),
    exec: (query) => d1.exec(query),
    withSession: (constraint) => d1.withSession(constraint),
    dump: () => d1.dump(),
  }

  const handler = createTestWebHandler(database)

  try {
    expect((await get(handler, 'flat')).status).toBe(500)
    expect((await get(handler, 'flat', false)).status).toBe(500)
  } finally {
    await handler.dispose()
  }
})
