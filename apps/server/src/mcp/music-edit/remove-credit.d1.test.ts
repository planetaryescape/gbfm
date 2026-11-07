import { asc } from 'drizzle-orm'
import { Effect } from 'effect'
import { expect, test } from 'vitest'

import {
  musicAlbumArtistsTable,
  musicAlbumsTable,
  musicArtistsTable,
} from '@/db/music-entity.schema'
import { removeArtistFromAlbumEffect } from '@/services/music-entity/album.service'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

test('removing an album credit preserves the same artist on another album and other artists on the target', async () => {
  await db.insert(musicArtistsTable).values([
    { id: 'credit-x', name: 'X', slug: 'credit-x' },
    { id: 'credit-y', name: 'Y', slug: 'credit-y' },
  ])
  await db.insert(musicAlbumsTable).values([
    { id: 'credit-a1', title: 'A1', slug: 'credit-a1' },
    { id: 'credit-a2', title: 'A2', slug: 'credit-a2' },
  ])
  await db.insert(musicAlbumArtistsTable).values([
    { albumId: 'credit-a1', artistId: 'credit-x' },
    { albumId: 'credit-a1', artistId: 'credit-y' },
    { albumId: 'credit-a2', artistId: 'credit-x' },
  ])

  await Effect.runPromise(
    withTestLayer(removeArtistFromAlbumEffect('credit-a1', 'credit-x'), DatabaseTestLayer),
  )

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
