import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { expect, test } from 'vitest'

import { applyD1Migrations, createMigratedD1Database, d1MigrationFiles } from '@/test/migrate-d1'

import { user } from './auth.schema'
import {
  listenerMembershipRevisions,
  listeningCollectionsTable,
  savedMixesTable,
} from './listening.schema'
import { musicArtistAliasesTable, musicRecordingCreditsTable } from './music-credit.schema'
import { musicAlbumsTable, musicArtistsTable, musicTracksTable } from './music-entity.schema'
import { musicReminder } from './music-reminder.schema'
import { postMusicReferencesTable } from './post-music-reference.schema'
import { postsTable } from './post.schema'

const domainMigrations = [
  '0017_mcp_domain_revisions.sql',
  '0018_music_credits_aliases.sql',
  '0019_post_music_references.sql',
] as const

const beforeDomain = d1MigrationFiles.filter((filename) => filename < '0017')

const seed = async (d1: D1Database) => {
  const db = drizzle(d1)
  await db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.test' })
  await db.insert(musicArtistsTable).values([
    { id: 'artist-a', name: 'Echo', slug: 'echo-a' },
    { id: 'artist-b', name: 'Echo', slug: 'echo-b' },
  ])
  await db.insert(musicAlbumsTable).values({ id: 'album', title: 'Album', slug: 'album' })
  await db.insert(musicTracksTable).values({ id: 'track', title: 'Track', slug: 'track' })

  return db
}

test('fresh domain schema round-trips typed defaults, safe revisions and persistent empty-library guard', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seed(resource.database)
  await db.insert(savedMixesTable).values({
    id: 'mix',
    userId: 'owner',
    url: 'https://example.test/mix',
    platform: 'youtube',
    title: 'Mix',
  })
  await db
    .insert(listeningCollectionsTable)
    .values({ id: 'collection', userId: 'owner', title: 'Collection' })
  await db.insert(listenerMembershipRevisions).values({ userId: 'owner' })
  expect(await db.select().from(savedMixesTable)).toMatchObject([
    { revision: 1, lastOperationId: null, published: false },
  ])
  expect(await db.select().from(listeningCollectionsTable)).toMatchObject([
    { revision: 1, lastOperationId: null },
  ])
  const d1 = resource.database

  expect(await db.select().from(musicArtistsTable)).toMatchObject([
    { revision: 0, lastOperationId: null },
    { revision: 0, lastOperationId: null },
  ])
  await d1
    .prepare(
      "INSERT INTO music_labels(id,name,slug,created_at,updated_at) VALUES('label','Label','label',0,0)",
    )
    .run()

  for (const [table, minimum] of [
    ['music_artists', 0],
    ['music_albums', 0],
    ['music_tracks', 0],
    ['music_labels', 0],
    ['saved_mixes', 1],
    ['listening_collections', 1],
  ] as const) {
    for (const revision of [minimum - 1, 0.5, 9007199254740992]) {
      await expect(
        d1.prepare(`UPDATE ${table} SET revision = ?`).bind(revision).run(),
      ).rejects.toThrow()
    }

    await d1.prepare(`UPDATE ${table} SET revision = 9007199254740991`).run()
    await expect(d1.prepare(`UPDATE ${table} SET revision = revision + 1`).run()).rejects.toThrow()
    await expect(
      d1.prepare(`UPDATE ${table} SET last_operation_id = 'bad'`).run(),
    ).rejects.toThrow()
  }

  for (const revision of [-1, 0.5, 9007199254740992]) {
    await expect(
      d1
        .prepare('UPDATE listener_membership_revisions SET revision = ?, last_transition_id = ?')
        .bind(revision, '00000000-0000-4000-8000-000000000001')
        .run(),
    ).rejects.toThrow()
  }

  await expect(
    d1.prepare('UPDATE listener_membership_revisions SET revision = 1').run(),
  ).rejects.toThrow()
  await d1
    .prepare(
      'UPDATE listener_membership_revisions SET revision = 9007199254740991, last_transition_id = ?',
    )
    .bind('00000000-0000-4000-8000-000000000001')
    .run()
  await expect(
    d1.prepare('UPDATE listener_membership_revisions SET revision = revision + 1').run(),
  ).rejects.toThrow()
  await d1.prepare('DELETE FROM saved_mixes').run()
  expect(await db.select().from(listenerMembershipRevisions)).toMatchObject([
    { revision: 9007199254740991 },
  ])
  await d1.prepare("DELETE FROM user WHERE id = 'owner'").run()
  expect(await db.select().from(listenerMembershipRevisions)).toEqual([])
})

test('populated replay preserves legacy primary and notes; all coherent historical reminders are non-editable', async () => {
  await using resource = await createMigratedD1Database(beforeDomain)
  const d1 = resource.database
  await d1
    .prepare(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('owner','Owner','owner@example.test',0,0)",
    )
    .run()
  await d1
    .prepare(
      "INSERT INTO saved_mixes(id,user_id,url,platform,title,notes,created_at) VALUES('mix','owner','https://example.test/mix','youtube','Mix','private note',0)",
    )
    .run()
  await d1
    .prepare(
      "INSERT INTO posts(id,title,slug,createdAt,updatedAt,content,music_entity_type,music_entity_id) VALUES('post','Post','post',0,0,'body','track','legacy-missing')",
    )
    .run()

  for (const [id, status, sent] of [
    ['pending', 'pending', 0],
    ['processing', 'processing', 0],
    ['failed', 'failed', 0],
    ['sent', 'sent', 1],
  ] as const) {
    await d1
      .prepare(
        'INSERT INTO music_reminder(id,user_id,music_title,artist_name,music_url,reminder_date,status,is_sent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,0)',
      )
      .bind(id, 'owner', 'Track', 'Artist', 'https://example.test/track', 1, status, sent)
      .run()
  }

  await applyD1Migrations(d1, domainMigrations)
  expect(
    await d1.prepare('SELECT notes,revision,last_operation_id FROM saved_mixes').first(),
  ).toEqual({ notes: 'private note', revision: 1, last_operation_id: null })
  expect(
    await d1
      .prepare('SELECT music_entity_type,music_entity_id,music_references_managed FROM posts')
      .first(),
  ).toEqual({
    music_entity_type: 'track',
    music_entity_id: 'legacy-missing',
    music_references_managed: 0,
  })
  expect(
    (
      await d1
        .prepare('SELECT id,dispatch_state,command_revision FROM music_reminder ORDER BY id')
        .all()
    ).results,
  ).toEqual([
    { id: 'failed', dispatch_state: 'fenced', command_revision: 1 },
    { id: 'pending', dispatch_state: 'fenced', command_revision: 1 },
    { id: 'processing', dispatch_state: 'fenced', command_revision: 1 },
    { id: 'sent', dispatch_state: 'accepted', command_revision: 1 },
  ])
  expect((await d1.prepare('SELECT * FROM post_music_references').all()).results).toEqual([])
})

test('inconsistent historical reminder aborts migration and rolls back preceding columns', async () => {
  await using resource = await createMigratedD1Database(beforeDomain)
  const d1 = resource.database
  await d1
    .prepare(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('owner','Owner','owner@example.test',0,0)",
    )
    .run()
  await d1
    .prepare(
      "INSERT INTO music_reminder(id,user_id,music_title,artist_name,music_url,reminder_date,status,is_sent,created_at,updated_at) VALUES('bad','owner','Track','Artist','https://example.test',0,'sent',0,0,0)",
    )
    .run()
  await expect(applyD1Migrations(d1, domainMigrations)).rejects.toThrow()
  expect(
    (await d1.prepare('PRAGMA table_info(music_artists)').all<{ name: string }>()).results.map(
      (r) => r.name,
    ),
  ).not.toContain('revision')
  expect(await d1.prepare('SELECT status,is_sent FROM music_reminder').first()).toEqual({
    status: 'sent',
    is_sent: 0,
  })
})

test('credit constraints distinguish instruments, explicit identities, evidence and deletion policies', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seed(resource.database)

  const fact = {
    trackId: 'track',
    artistId: 'artist-a',
    creditedName: 'Echo',
    creditedNameKey: 'echo',
    participantKey: 'artist:artist-a',
    role: 'instrument' as const,
    instrument: 'Piano',
    instrumentKey: 'piano',
    displayOrder: 3,
    sourceLabel: 'Liner notes',
    evidenceNote: 'Page 2',
    assertedById: 'owner',
    assertedAt: new Date(1000),
    createdAt: new Date(0),
  }

  await db.insert(musicRecordingCreditsTable).values({ ...fact, id: 'piano' })
  await db
    .insert(musicRecordingCreditsTable)
    .values({ ...fact, id: 'bass', instrument: 'Bass', instrumentKey: 'bass', displayOrder: 1 })
  await db.insert(musicRecordingCreditsTable).values({
    ...fact,
    id: 'other-artist',
    artistId: 'artist-b',
    participantKey: 'artist:artist-b',
  })
  await db.insert(musicRecordingCreditsTable).values({
    ...fact,
    id: 'name-only',
    artistId: null,
    participantKey: 'name:echo',
    role: 'engineer',
    instrument: null,
    instrumentKey: '',
  })
  await db.insert(musicRecordingCreditsTable).values({
    ...fact,
    id: 'album-wide',
    trackId: null,
    albumId: 'album',
    role: 'producer',
    instrument: null,
    instrumentKey: '',
  })

  for (const invalid of [
    { id: 'duplicate' },
    { id: 'no-target', trackId: null },
    { id: 'two-targets', albumId: 'album' },
    { id: 'unknown-artist', artistId: 'missing', participantKey: 'artist:missing' },
    { id: 'no-instrument', instrument: null },
    { id: 'bad-key', instrumentKey: '' },
    { id: 'no-evidence', evidenceNote: null },
    { id: 'wrong-participant', participantKey: 'name:echo' },
    { id: 'bad-order', displayOrder: -1 },
    { id: 'fractional-order', displayOrder: 0.5 },
    { id: 'noninstrument-key', role: 'producer' as const, instrument: null },
  ])
    await expect(
      db.insert(musicRecordingCreditsTable).values({ ...fact, ...invalid }),
    ).rejects.toThrow()
  await expect(
    resource.database.prepare("DELETE FROM music_artists WHERE id='artist-a'").run(),
  ).rejects.toThrow()
  await resource.database.prepare("DELETE FROM user WHERE id='owner'").run()
  expect(await db.select().from(musicRecordingCreditsTable)).toHaveLength(5)
  expect((await db.select().from(musicRecordingCreditsTable))[0]).toMatchObject({
    assertedById: null,
    assertedAt: new Date(1000),
    createdAt: new Date(0),
  })
  await resource.database.prepare("DELETE FROM music_tracks WHERE id='track'").run()
  expect(await db.select().from(musicRecordingCreditsTable)).toMatchObject([{ id: 'album-wide' }])
  await resource.database.prepare("DELETE FROM music_albums WHERE id='album'").run()
  expect(await db.select().from(musicRecordingCreditsTable)).toEqual([])
})

test('alias uniqueness is per artist and assertion deletion never deletes public facts', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seed(resource.database)

  const alias = {
    name: 'Écho',
    nameKey: 'écho',
    sourceLabel: 'Sleeve',
    evidenceNote: 'Back cover',
    assertedById: 'owner',
    assertedAt: new Date(0),
    createdAt: new Date(0),
  }

  await db.insert(musicArtistAliasesTable).values([
    { ...alias, id: 'a', artistId: 'artist-a' },
    { ...alias, id: 'b', artistId: 'artist-b' },
  ])
  await expect(
    db.insert(musicArtistAliasesTable).values({ ...alias, id: 'duplicate', artistId: 'artist-a' }),
  ).rejects.toThrow()
  await resource.database.prepare("DELETE FROM user WHERE id='owner'").run()
  expect(await db.select().from(musicArtistAliasesTable)).toMatchObject([
    { assertedById: null },
    { assertedById: null },
  ])
  await resource.database.prepare("DELETE FROM music_artists WHERE id='artist-a'").run()
  expect(await db.select().from(musicArtistAliasesTable)).toMatchObject([{ id: 'b' }])
})

test('ordered references enforce typed targets, distinctness and optional primary without inferred managed state', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seed(resource.database)
  await db.insert(postsTable).values({ id: 'post', title: 'Post', slug: 'post', content: 'Body' })
  await db.insert(postMusicReferencesTable).values([
    { postId: 'post', position: 4, albumId: 'album', isPrimary: true },
    { postId: 'post', position: 0, trackId: 'track' },
  ])
  expect(
    await db.select().from(postMusicReferencesTable).orderBy(postMusicReferencesTable.position),
  ).toMatchObject([
    { position: 0, trackId: 'track', isPrimary: false },
    { position: 4, albumId: 'album', isPrimary: true },
  ])
  expect((await db.select().from(postsTable))[0]).toMatchObject({
    musicReferencesManaged: false,
    lastOperationId: null,
  })

  for (const invalid of [
    { position: 1 },
    { position: 1, albumId: 'album', trackId: 'track' },
    { position: 1, albumId: 'album' },
    { position: 50, trackId: 'track' },
    { position: 1, trackId: 'missing' },
  ])
    await expect(
      db.insert(postMusicReferencesTable).values({ postId: 'post', ...invalid }),
    ).rejects.toThrow()
  await expect(
    resource.database
      .prepare('UPDATE post_music_references SET is_primary=1 WHERE position=0')
      .run(),
  ).rejects.toThrow()
  await expect(
    resource.database.prepare("DELETE FROM music_albums WHERE id='album'").run(),
  ).rejects.toThrow()
  await resource.database.prepare("DELETE FROM posts WHERE id='post'").run()
  expect(await db.select().from(postMusicReferencesTable)).toEqual([])
})

test('reminder defaults permit new work, while invalid revisions/states/attempt markers reject', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seed(resource.database)
  await db.insert(musicReminder).values({
    id: 'new',
    userId: 'owner',
    musicTitle: 'Track',
    artistName: 'Echo',
    musicUrl: 'https://example.test',
    reminderDate: new Date(0),
  })
  expect((await db.select().from(musicReminder))[0]).toMatchObject({
    commandRevision: 1,
    dispatchState: 'open',
    lastOperationId: null,
  })

  for (const sql of [
    'UPDATE music_reminder SET command_revision=0',
    'UPDATE music_reminder SET command_revision=1.5',
    "UPDATE music_reminder SET dispatch_state='unknown'",
    "UPDATE music_reminder SET last_operation_id='bad'",
  ])
    await expect(resource.database.prepare(sql).run()).rejects.toThrow()
})
