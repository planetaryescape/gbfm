import type { D1Database } from '@cloudflare/workers-types'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { expect, test } from 'vitest'

import { applyD1Migrations, createMigratedD1Database, d1MigrationFiles } from '@/test/migrate-d1'

import { user } from './auth.schema'
import { mcpOperations } from './mcp-operation.schema'
import { musicPlaylistsTable } from './music-entity.schema'
import { playlistImportStatusesTable } from './playlist-import-status.schema'

const attempt = '12345678-1234-4234-8234-123456789012'

const operationId = 'a'.repeat(64)

const importing = {
  operationId,
  actorId: 'actor',
  clientId: 'gbfm:session',
  resource: 'https://example.test/api',
  phase: 'importing',
  createdAt: 100,
  updatedAt: 100,
  attemptId: attempt,
  generation: 1,
  leaseUntil: 60100,
} as const

const seedReceipt = async (database: D1Database) => {
  const db = drizzle(database)
  await db.insert(user).values({ id: 'actor', name: 'Actor', email: 'actor@example.test' })
  await db.insert(mcpOperations).values({
    id: operationId,
    actorId: 'actor',
    clientId: 'gbfm:session',
    inputHash: 'b'.repeat(64),
    attemptId: attempt,
    state: 'complete',
    outcome: JSON.stringify({ status: 'accepted' }),
    createdAt: 100,
    expiresAt: 86400100,
  })

  return db
}

test('populated replay adds no fabricated jobs; session/PAT status shares real receipt and actor only', async () => {
  await using resource = await createMigratedD1Database(
    d1MigrationFiles.filter((name) => name < '0025'),
  )

  const db = await seedReceipt(resource.database)
  await applyD1Migrations(resource.database, ['0025_playlist_import_status.sql'])
  expect(await db.select().from(playlistImportStatusesTable)).toEqual([])
  await db.insert(playlistImportStatusesTable).values(importing)
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    {
      clientId: 'gbfm:session',
      phase: 'importing',
      revision: 0,
      importedTotal: null,
      importedProcessed: 0,
      importFailed: 0,
      dispatchState: 'none',
      terminalAt: null,
    },
  ])
  // Namespace equality/immutability is checked by backend against the common receipt.
  await db.update(playlistImportStatusesTable).set({ clientId: 'gbfm:pat:persisted-key' })

  for (const column of ['clientId', 'resource'] as const) {
    await expect(
      db.update(playlistImportStatusesTable).set({ [column]: 'g\u0000' + 'x'.repeat(3000) }),
    ).rejects.toThrow()
  }

  await expect(
    db.insert(playlistImportStatusesTable).values({ ...importing, operationId: 'c'.repeat(64) }),
  ).rejects.toThrow()

  for (const set of [
    "client_id=''",
    "resource=''",
    "phase='pending'",
    'imported_processed=-1',
    'enrichment_processed=0.5',
    'import_failed=1',
    'imported_total=-1',
    'enrichment_failed=1',
    'enrichment_total=9007199254740992',
    'revision=9007199254740992',
    "last_attempt_id='bad'",
    'updated_at=99',
    'terminal_at=100',
    'playlist_revision=0',
    "cursor_track_id='12345678-1234-4234-8234-123456789012'",
    'generation=2',
    'lease_until=NULL',
    "attempt_id='bad'",
    'dispatch_attempts=-1',
    'next_dispatch_at=100',
    "failure_code='raw provider message'",
  ]) {
    await expect(
      resource.database.prepare(`UPDATE playlist_import_statuses SET ${set}`).run(),
    ).rejects.toThrow()
  }

  await db
    .update(mcpOperations)
    .set({ state: 'expired', actorId: null, clientId: null, attemptId: null, outcome: null })
    .where(eq(mcpOperations.id, operationId))
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { phase: 'importing', importedProcessed: 0 },
  ])
  await db.delete(mcpOperations).where(eq(mcpOperations.id, operationId))
  expect(await db.select().from(playlistImportStatusesTable)).toEqual([])
})

test('pending queue acceptance cannot fabricate worker completion or retain terminal resumable state', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seedReceipt(resource.database)
  await db.insert(playlistImportStatusesTable).values({
    ...importing,
    phase: 'enrichment_pending',
    attemptId: null,
    leaseUntil: null,
    playlistId: 'playlist',
    playlistRevision: 7,
    importedProcessed: 3,
    importedTotal: 3,
    enrichmentTotal: 2,
    dispatchState: 'pending',
    nextDispatchAt: 101,
  })

  for (const set of [
    "dispatch_state='none',next_dispatch_at=NULL",
    'playlist_id=NULL',
    'playlist_revision=NULL',
    "dispatch_state='sent',next_dispatch_at=NULL",
    'dispatched_at=102',
    `attempt_id='${attempt}',lease_until=60100`,
    "phase='completed',terminal_at=102",
    "phase='partial',terminal_at=102",
  ]) {
    await expect(
      resource.database.prepare(`UPDATE playlist_import_statuses SET ${set}`).run(),
    ).rejects.toThrow()
  }

  await db
    .update(playlistImportStatusesTable)
    .set({ dispatchState: 'sent', nextDispatchAt: null, dispatchedAt: 102, dispatchAttempts: 1 })
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { phase: 'enrichment_pending', enrichmentProcessed: 0 },
  ])
  await db.update(playlistImportStatusesTable).set({
    phase: 'enriching',
    attemptId: attempt,
    leaseUntil: 60102,
    generation: 2,
    cursorPosition: 0,
    cursorTrackId: attempt,
  })

  for (const set of [
    'cursor_position=NULL',
    'cursor_track_id=NULL',
    'lease_until=NULL',
    'generation=0',
  ]) {
    await expect(
      resource.database.prepare(`UPDATE playlist_import_statuses SET ${set}`).run(),
    ).rejects.toThrow()
  }

  await expect(
    db.update(playlistImportStatusesTable).set({ phase: 'completed', terminalAt: 103 }),
  ).rejects.toThrow()
  await db.update(playlistImportStatusesTable).set({
    phase: 'partial',
    terminalAt: 104,
    updatedAt: 104,
    enrichmentProcessed: 1,
    enrichmentFailed: 1,
    attemptId: null,
    leaseUntil: null,
    cursorPosition: null,
    cursorTrackId: null,
    dispatchState: 'none',
    dispatchedAt: null,
  })
  await db
    .update(playlistImportStatusesTable)
    .set({ playlistId: null, playlistRevision: null, failureCode: null })
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    {
      phase: 'partial',
      playlistId: null,
      importedProcessed: 3,
      enrichmentProcessed: 1,
      enrichmentFailed: 1,
      dispatchAttempts: 1,
    },
  ])
  await expect(
    db.update(playlistImportStatusesTable).set({ enrichmentFailed: 0 }),
  ).rejects.toThrow()
  await expect(db.update(playlistImportStatusesTable).set({ phase: 'completed' })).rejects.toThrow()
})

test('interruption preserves actual counts and guarded retirement can clear target without losing history', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seedReceipt(resource.database)
  await db.insert(playlistImportStatusesTable).values({
    ...importing,
    playlistId: 'deleted-target',
    playlistRevision: 9,
    importedProcessed: 2,
  })
  await db.update(playlistImportStatusesTable).set({
    phase: 'interrupted',
    terminalAt: 200,
    updatedAt: 200,
    failureCode: 'interrupted',
    attemptId: null,
    leaseUntil: null,
  })
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { phase: 'interrupted', importedProcessed: 2, importFailed: 0, importedTotal: null },
  ])
  await db
    .update(playlistImportStatusesTable)
    .set({ phase: 'retired', playlistId: null, playlistRevision: null })
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { phase: 'retired', importedProcessed: 2 },
  ])
  await db.delete(user).where(eq(user.id, 'actor'))
  expect(await db.select().from(playlistImportStatusesTable)).toEqual([])
})

test('completed requires independently known successful totals and supports terminal pruning', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seedReceipt(resource.database)

  const completed = {
    ...importing,
    phase: 'completed',
    attemptId: null,
    leaseUntil: null,
    terminalAt: 100,
    importedProcessed: 3,
    importedTotal: 3,
    enrichmentProcessed: 2,
    enrichmentTotal: 2,
  } as const

  await db.insert(playlistImportStatusesTable).values(completed)

  for (const set of [
    'imported_total=NULL',
    'enrichment_total=NULL',
    'imported_processed=2',
    'enrichment_processed=1',
    'import_failed=1',
    'enrichment_failed=1',
    'terminal_at=NULL',
    `attempt_id='${attempt}',lease_until=1000`,
  ]) {
    await expect(
      resource.database.prepare(`UPDATE playlist_import_statuses SET ${set}`).run(),
    ).rejects.toThrow()
  }

  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { phase: 'completed', playlistId: null, playlistRevision: null },
  ])
})

test('status capacity exhaustion aborts the retirement batch without deleting the playlist', async () => {
  await using resource = await createMigratedD1Database()
  const db = await seedReceipt(resource.database)
  await db
    .insert(musicPlaylistsTable)
    .values({ id: 'playlist', title: 'Playlist', slug: 'playlist' })
  const secondOperationId = 'c'.repeat(64)
  await db.insert(mcpOperations).values({
    id: secondOperationId,
    actorId: 'actor',
    clientId: 'gbfm:session',
    inputHash: 'b'.repeat(64),
    attemptId: attempt,
    state: 'complete',
    outcome: JSON.stringify({ status: 'accepted' }),
    createdAt: 100,
    expiresAt: 86400100,
  })
  await db.insert(playlistImportStatusesTable).values([
    { ...importing, playlistId: 'playlist', playlistRevision: 0 },
    {
      ...importing,
      operationId: secondOperationId,
      playlistId: 'playlist',
      playlistRevision: 0,
      revision: 9007199254740991,
    },
  ])
  await expect(
    resource.database.batch([
      resource.database.prepare(
        "UPDATE playlist_import_statuses SET phase='retired',terminal_at=200,updated_at=200,playlist_id=NULL,playlist_revision=NULL,attempt_id=NULL,lease_until=NULL,revision=revision+1 WHERE playlist_id='playlist'",
      ),
      resource.database.prepare("DELETE FROM music_playlists WHERE id='playlist'"),
    ]),
  ).rejects.toThrow()
  expect(await db.select().from(musicPlaylistsTable)).toMatchObject([{ id: 'playlist' }])
  const statuses = await db.select().from(playlistImportStatusesTable)
  expect(statuses).toHaveLength(2)
  expect(statuses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operationId,
        phase: 'importing',
        playlistId: 'playlist',
        revision: 0,
      }),
      expect.objectContaining({
        operationId: secondOperationId,
        phase: 'importing',
        playlistId: 'playlist',
        revision: 9007199254740991,
      }),
    ]),
  )
})
