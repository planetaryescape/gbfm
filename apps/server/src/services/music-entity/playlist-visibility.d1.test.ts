/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Test expectations and authored rich-content references use their existing wire contracts. */
import { Effect, Layer } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { musicPlaylistsTable } from '@/db/music-entity.schema'
import {
  RichContentMusicResolver,
  RichContentMusicResolverLayer,
} from '@/services/rich-content-music.service'
import { db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { getPublicPlaylistEffect, getReadablePlaylistsEffect } from './playlist.service'

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
