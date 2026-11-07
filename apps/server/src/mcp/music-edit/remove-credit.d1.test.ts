import { asc } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import {
  musicAlbumArtistsTable,
  musicAlbumsTable,
  musicArtistsTable,
} from '@/db/music-entity.schema'
import { d1, db } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'

test('removing an album credit preserves the same artist on another album and other artists on the target', async () => {
  await db.insert(musicArtistsTable).values([
    { id: 'credit-x', name: 'X', slug: 'credit-x' },
    { id: 'credit-y', name: 'Y', slug: 'credit-y' },
  ])
  await db.insert(musicAlbumsTable).values([
    { id: 'credit-a1', title: 'A1', slug: 'credit-a1', artistNames: ['X', 'Y'] },
    { id: 'credit-a2', title: 'A2', slug: 'credit-a2', artistNames: ['X'] },
  ])
  await db.insert(musicAlbumArtistsTable).values([
    { albumId: 'credit-a1', artistId: 'credit-x' },
    { albumId: 'credit-a1', artistId: 'credit-y' },
    { albumId: 'credit-a2', artistId: 'credit-x' },
  ])

  await db
    .insert(user)
    .values({ id: 'admin', name: 'Admin', email: 'credit@test.example', role: 'admin' })
  await db.insert(session).values({
    id: 'session',
    userId: 'admin',
    token: 'session-token',
    expiresAt: new Date(Date.now() + 60_000),
  })
  const web = createTestWebHandler(d1)

  try {
    const response = await web.handler(
      new Request('http://localhost/api/music/albums/credit-a1/artists/credit-x', {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer session-token',
          'x-gbfm-music-revision': '0',
          'x-gbfm-music-artist-revision': '0',
          'x-gbfm-request-id': crypto.randomUUID(),
        },
      }),
    )

    expect(response.status).toBe(204)
  } finally {
    await web.dispose()
  }

  expect(
    await db
      .select({
        albumId: musicAlbumArtistsTable.albumId,
        artistId: musicAlbumArtistsTable.artistId,
      })
      .from(musicAlbumArtistsTable)
      .orderBy(asc(musicAlbumArtistsTable.albumId), asc(musicAlbumArtistsTable.artistId)),
  ).toEqual([
    { albumId: 'credit-a1', artistId: 'credit-y' },
    { albumId: 'credit-a2', artistId: 'credit-x' },
  ])
})
