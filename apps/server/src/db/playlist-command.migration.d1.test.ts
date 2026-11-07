import { drizzle } from 'drizzle-orm/d1'
import { expect, test } from 'vitest'

import { applyD1Migrations, createMigratedD1Database, d1MigrationFiles } from '@/test/migrate-d1'

import { musicPlaylistsTable } from './music-entity.schema'

test('playlist migration preserves populated revision and enforces range without marker updates', async () => {
  await using resource = await createMigratedD1Database(
    d1MigrationFiles.filter((name) => name < '0020'),
  )

  const d1 = resource.database
  await d1
    .prepare(
      "INSERT INTO music_playlists(id,title,slug,createdAt,updatedAt,revision) VALUES('p','Playlist','p',0,0,7)",
    )
    .run()
  await applyD1Migrations(d1, ['0020_playlist_command_revisions.sql'])
  const db = drizzle(d1)
  expect(await db.select().from(musicPlaylistsTable)).toMatchObject([
    { revision: 7, lastOperationId: null },
  ])

  for (const revision of [-1, 1.5, 9007199254740992]) {
    await expect(
      d1.prepare('UPDATE music_playlists SET revision=?').bind(revision).run(),
    ).rejects.toThrow()
  }

  await d1.prepare('UPDATE music_playlists SET revision=9007199254740991').run()
  await expect(d1.prepare('UPDATE music_playlists SET revision=revision+1').run()).rejects.toThrow()
  await expect(
    d1.prepare("UPDATE music_playlists SET last_operation_id='bad'").run(),
  ).rejects.toThrow()
  await d1.prepare("UPDATE music_playlists SET title='Unchanged marker'").run()
  expect(await db.select().from(musicPlaylistsTable)).toMatchObject([
    { title: 'Unchanged marker', revision: 9007199254740991, lastOperationId: null },
  ])
  await d1
    .prepare('UPDATE music_playlists SET revision=0, last_operation_id=?')
    .bind('12345678-1234-4234-8234-123456789012')
    .run()
  expect(await db.select().from(musicPlaylistsTable)).toMatchObject([
    { revision: 0, lastOperationId: '12345678-1234-4234-8234-123456789012' },
  ])
  await d1
    .prepare(
      "INSERT INTO music_playlists(id,title,slug,createdAt,updatedAt) VALUES('fresh','Fresh','fresh',0,0)",
    )
    .run()
  expect(await db.select().from(musicPlaylistsTable)).toMatchObject([
    { revision: 0 },
    { revision: 0, lastOperationId: null },
  ])
})

test('playlist migration refuses invalid legacy revision rather than grandfathering it', async () => {
  await using resource = await createMigratedD1Database(
    d1MigrationFiles.filter((name) => name < '0020'),
  )

  const d1 = resource.database
  await d1
    .prepare(
      "INSERT INTO music_playlists(id,title,slug,createdAt,updatedAt,revision) VALUES('p','Playlist','p',0,0,-1)",
    )
    .run()
  await expect(applyD1Migrations(d1, ['0020_playlist_command_revisions.sql'])).rejects.toThrow()
  expect(
    (await d1.prepare('PRAGMA table_info(music_playlists)').all<{ name: string }>()).results.map(
      (r) => r.name,
    ),
  ).not.toContain('last_operation_id')
})
