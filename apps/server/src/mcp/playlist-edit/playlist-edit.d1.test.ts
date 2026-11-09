import { AuthSession } from '@gbfm/api/middleware/auth'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { ConfigService } from '@/services/config.service'
import { applyPlaylistCommandEffect } from '@/services/music-entity/playlist.service'
import { createEditorialOAuthFixture } from '@/test/editorial-oauth'

import { CommandAuthority, makeSessionCommandAuthority } from '../command-authority'
import { createMcpOperationStore, McpOperationStore } from '../operations/store'
import type { LocalPlaylistCommand } from './contracts'

test('persisted session commands share receipt/CAS fencing, original replay and live admin authority', async () => {
  await using fixture = await createEditorialOAuthFixture()
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))

  const authority = await Effect.runPromise(
    makeSessionCommandAuthority.pipe(
      Effect.provideService(AuthSession, {
        user: { id: 'owner', email: 'owner@example.com', name: 'Owner' },
        session: { id: 'owner-session', createdAt: new Date() },
      }),
      Effect.provideService(Database, fixture.db),
      Effect.provideService(ConfigService, fixture.config),
    ),
  )

  const store = createMcpOperationStore(fixture.db.$client)

  const run = (command: LocalPlaylistCommand) =>
    Effect.runPromise(
      applyPlaylistCommandEffect(command).pipe(
        Effect.provideService(Database, fixture.db),
        Effect.provideService(CommandAuthority, authority),
        Effect.provideService(McpOperationStore, store),
      ),
    )

  const command = {
    operation: 'create_playlist',
    requestId: crypto.randomUUID(),
    metadata: { title: 'Guarded', slug: 'guarded', description: null, coverImageUrl: null },
  } as const

  const created = await run(command)
  expect(created).toMatchObject({ revision: 0, changed: true, replayed: false, membershipCount: 0 })
  expect(await run(command)).toEqual({ ...created, replayed: true })
  expect(await fixture.db.select().from(musicPlaylistsTable)).toHaveLength(1)
  const target = { playlistId: created.playlistId, expectedRevision: 0 }
  await fixture.db.insert(musicTracksTable).values([
    { id: 'track-z', title: 'Z', slug: 'z' },
    { id: 'track-a', title: 'A', slug: 'a' },
    { id: 'track-next', title: 'Next', slug: 'next' },
  ])

  const add = {
    operation: 'add_playlist_tracks',
    ...target,
    requestId: crypto.randomUUID(),
    trackIds: ['track-z', 'track-a'],
  } as const

  const added = await run(add)
  expect(added).toMatchObject({ revision: 1, membershipCount: 2 })

  const contenders = await Promise.all([
    run({
      operation: 'reorder_playlist_tracks',
      ...target,
      expectedRevision: 1,
      requestId: crypto.randomUUID(),
      trackIds: ['track-a', 'track-z'],
    }).then(
      (value) => value.revision,
      (error: Error) => error,
    ),
    run({
      operation: 'add_playlist_tracks',
      ...target,
      expectedRevision: 1,
      requestId: crypto.randomUUID(),
      trackIds: ['track-next'],
    }).then(
      (value) => value.revision,
      (error: Error) => error,
    ),
  ])

  expect(contenders.filter((value) => value === 2)).toHaveLength(1)
  expect(contenders.find((value) => value !== 2)).toHaveProperty('code', 'conflict')

  const memberships = await fixture.db
    .select()
    .from(musicPlaylistTracksTable)
    .where(eq(musicPlaylistTracksTable.playlistId, created.playlistId))
    .orderBy(musicPlaylistTracksTable.position)

  expect(memberships.map((member) => member.trackId)).toEqual(
    memberships.length === 2 ? ['track-a', 'track-z'] : ['track-z', 'track-a', 'track-next'],
  )
  expect(await run(add)).toEqual({ ...added, replayed: true })
  await expect(run({ ...add, trackIds: ['track-next'] })).rejects.toHaveProperty('code', 'conflict')

  const publish = {
    operation: 'publish_playlist',
    ...target,
    expectedRevision: 2,
    requestId: crypto.randomUUID(),
  } as const

  const published = await run(publish)
  expect(published.revision).toBe(3)

  const [row] = await fixture.db
    .select()
    .from(musicPlaylistsTable)
    .where(eq(musicPlaylistsTable.id, created.playlistId))

  expect(row?.publishedAt).toBeInstanceOf(Date)
  const noOp = await run({ ...publish, expectedRevision: 3, requestId: crypto.randomUUID() })
  expect(noOp).toMatchObject({ changed: false, revision: 3 })
  expect(await run(publish)).toEqual({ ...published, replayed: true })
  await fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
  await expect(run(publish)).rejects.toHaveProperty('code', 'access_denied')
  expect((await fixture.db.select().from(musicPlaylistsTable))[0]?.revision).toBe(3)
}, 15_000)
