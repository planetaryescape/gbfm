/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Test expectations and authored rich-content references use their existing wire contracts. */
import { Effect, Layer } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  musicAlbumsTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import {
  RichContentMusicResolver,
  RichContentMusicResolverLayer,
} from '@/services/rich-content-music.service'
import { db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import {
  getPublicPlaylistEffect,
  getPublicPlaylistSnapshotEffect,
  getReadablePlaylistsEffect,
  publicPlaylistPredicate,
} from './playlist.service'

const database = Layer.succeed(Database, db)

const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(withTestLayer(effect, database))

beforeAll(async () => {
  await db.insert(user).values([
    { id: 'pl-owner', name: 'Owner', email: 'pl-owner@example.test', role: 'user' },
    { id: 'pl-other', name: 'Other', email: 'pl-other@example.test', role: 'user' },
    { id: 'pl-admin', name: 'Admin', email: 'pl-admin@example.test', role: 'admin' },
    {
      id: 'pl-banned',
      name: 'Banned',
      email: 'pl-banned@example.test',
      role: 'admin',
      banned: true,
    },
  ])
  await db.insert(musicPlaylistsTable).values([
    {
      id: 'pl-public',
      slug: 'pl-public',
      title: 'Public',
      publishedAt: new Date(1),
      createdById: 'pl-owner',
    },
    { id: 'pl-private', slug: 'pl-private', title: 'Private', createdById: 'pl-owner' },
    {
      id: 'pl-future',
      slug: 'pl-future',
      title: 'Future',
      publishedAt: new Date('2099-01-01'),
      createdById: 'pl-other',
    },
  ])
})

test('public playlist boundary and explicit projection; owned/admin curation never grants anonymous access', async () => {
  expect((await run(getReadablePlaylistsEffect())).map((row) => row.id)).toEqual(['pl-public'])
  expect(
    (await run(getReadablePlaylistsEffect({ id: 'pl-owner', role: 'admin' })))
      .map((row) => row.id)
      .sort(),
  ).toEqual(['pl-private', 'pl-public'])
  expect((await run(getReadablePlaylistsEffect({ id: 'pl-admin', role: 'user' }))).length).toBe(3)
  expect(
    (await run(getReadablePlaylistsEffect({ id: 'pl-banned', role: 'admin' }))).map(
      (row) => row.id,
    ),
  ).toEqual(['pl-public'])
  expect(await run(getPublicPlaylistEffect('pl-public'))).not.toHaveProperty('createdById')
  expect(await run(getPublicPlaylistEffect('pl-public'))).not.toHaveProperty('curatorId')

  for (const id of ['pl-private', 'pl-future', 'absent']) {
    const result = await run(Effect.result(getPublicPlaylistEffect(id)))
    expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'NotFoundError' } })
  }
})

test('real rich-content resolver refuses unpublished/future playlist snapshots', async () => {
  const resolve = (id: string) =>
    withTestLayer(
      Effect.gen(function* () {
        const resolver = yield* RichContentMusicResolver

        return yield* resolver.resolve({
          _tag: 'MusicCatalog',
          entityType: 'playlist',
          entityId: id,
          showTracks: true,
        })
      }),
      RichContentMusicResolverLayer.pipe(Layer.provide(database)),
    )

  expect(await Effect.runPromise(resolve('pl-private'))).toBeNull()
  expect(await Effect.runPromise(resolve('pl-future'))).toBeNull()
  expect(await Effect.runPromise(resolve('pl-public'))).toMatchObject({
    entityId: 'pl-public',
    title: 'Public',
  })
})

test('migrated SQL includes the exact publication instant, not the next millisecond', async () => {
  await db.insert(musicPlaylistsTable).values([
    {
      id: 'boundary-before',
      slug: 'boundary-before',
      title: 'Before',
      publishedAt: new Date(4999),
    },
    { id: 'boundary-at', slug: 'boundary-at', title: 'At', publishedAt: new Date(5000) },
    { id: 'boundary-after', slug: 'boundary-after', title: 'After', publishedAt: new Date(5001) },
  ])

  const rows = await db
    .select({ id: musicPlaylistsTable.id })
    .from(musicPlaylistsTable)
    .where(publicPlaylistPredicate(new Date(5000)))

  expect(rows.map((row) => row.id).sort()).toEqual(['boundary-at', 'boundary-before', 'pl-public'])
})

test('complete evidence uses one bounded batch, captured now and caller revision without filtering catalogue timestamps', async () => {
  await db.insert(musicAlbumsTable).values({
    id: 'snapshot-album',
    slug: 'snapshot-album',
    title: 'Album',
    publishedAt: new Date(5001),
  })
  await db.insert(musicPlaylistsTable).values({
    id: 'snapshot',
    slug: 'snapshot',
    title: 'Snapshot',
    publishedAt: new Date(5000),
    revision: 7,
  })

  for (let offset = 0; offset < 100; offset += 10) {
    const tracks = Array.from({ length: 10 }, (_, index) => ({
      id: `snapshot-${offset + index}`,
      slug: `snapshot-${offset + index}`,
      title: 'Track',
      albumId: 'snapshot-album',
      publishedAt: index === 0 ? null : new Date(5000),
    }))

    await db.insert(musicTracksTable).values(tracks)
    await db.insert(musicPlaylistTracksTable).values(
      tracks.map((track, index) => ({
        playlistId: 'snapshot',
        trackId: track.id,
        position: (offset + index) * 2,
      })),
    )
  }

  const result = await run(
    getPublicPlaylistSnapshotEffect({
      playlistId: 'snapshot',
      now: new Date(5000),
      expectedRevision: 7,
    }),
  )

  expect(result.members).toHaveLength(100)
  expect(result.members.map((member) => member.position)).toEqual(
    Array.from({ length: 100 }, (_, index) => index * 2),
  )
  expect(result.members[0]?.track?.publishedAt).toBeNull()
  expect(result.members[1]?.track?.publishedAt).toEqual(new Date(5000))
  expect(result.members[0]?.album?.publishedAt).toEqual(new Date(5001))
  expect(result.playlist).not.toHaveProperty('createdById')
  expect(
    await run(
      Effect.result(
        getPublicPlaylistSnapshotEffect({ playlistId: 'snapshot', now: new Date(4999) }),
      ),
    ),
  ).toMatchObject({ _tag: 'Failure', failure: { _tag: 'NotFoundError' } })
  expect(
    await run(
      Effect.result(
        getPublicPlaylistSnapshotEffect({
          playlistId: 'snapshot',
          now: new Date(5000),
          expectedRevision: 6,
        }),
      ),
    ),
  ).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ConflictError' } })
  await db
    .insert(musicTracksTable)
    .values({ id: 'snapshot-overflow', slug: 'snapshot-overflow', title: 'Overflow' })
  await db
    .insert(musicPlaylistTracksTable)
    .values({ playlistId: 'snapshot', trackId: 'snapshot-overflow', position: 201 })
  expect(
    await run(
      Effect.result(
        getPublicPlaylistSnapshotEffect({ playlistId: 'snapshot', now: new Date(5000) }),
      ),
    ),
  ).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ValidationError' } })
})
