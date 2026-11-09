import { eq, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { mcpOperations } from '@/db/mcp-operation.schema'
import { musicPlaylistsTable } from '@/db/music-entity.schema'
import { playlistImportStatusesTable } from '@/db/playlist-import-status.schema'
import { omitUndefined } from '@/lib/omit-undefined'
import { prepareOperationStatement } from '@/mcp/operations/persistence'
import { createMcpOperationStore } from '@/mcp/operations/store'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { playlistImportRetirementStatements, playlistImportWorkerFence } from './statements'

const resource = await createMigratedD1Database()

const database = resource.database

const db = drizzle(database)

const prepare = (statement: SQL) => prepareOperationStatement(database, statement)

const store = createMcpOperationStore(database, () => {})

const now = 1_800_000_000_000

const workerAttempt = '12345678-1234-4234-8234-123456789012'

const otherAttempt = '22345678-1234-4234-8234-123456789012'

const operationId = 'a'.repeat(64)

const namespace = { actorId: 'actor', clientId: 'gbfm:session', resource: 'https://test/api' }

const liveGuard = sql`0 OR EXISTS (SELECT 1 FROM user WHERE id='actor' AND banned=0 AND role='admin')`

const key = {
  ...namespace,
  operation: 'delete_playlist',
  requestId: '32345678-1234-4234-8234-123456789012',
}

afterAll(() => resource.dispose())

beforeEach(async () => {
  await db.delete(mcpOperations)
  await db.delete(musicPlaylistsTable)
  await db.delete(user)
  await db.insert(user).values({ id: 'actor', name: 'Admin', email: 'admin@test', role: 'admin' })
  await db.insert(musicPlaylistsTable).values([
    { id: 'playlist', title: 'Playlist', slug: 'playlist' },
    { id: 'other', title: 'Other', slug: 'other' },
  ])
  await db.insert(mcpOperations).values({
    id: operationId,
    actorId: 'actor',
    clientId: namespace.clientId,
    inputHash: 'b'.repeat(64),
    attemptId: workerAttempt,
    state: 'complete',
    outcome: '{}',
    createdAt: now,
    expiresAt: now + 86_400_000,
  })
  await db.insert(playlistImportStatusesTable).values({
    operationId,
    ...namespace,
    phase: 'enriching',
    playlistId: 'playlist',
    playlistRevision: 0,
    importedProcessed: 3,
    importedTotal: 3,
    enrichmentProcessed: 2,
    enrichmentFailed: 1,
    enrichmentTotal: 5,
    generation: 2,
    attemptId: workerAttempt,
    leaseUntil: Number.MAX_SAFE_INTEGER,
    cursorPosition: 7,
    cursorTrackId: otherAttempt,
    dispatchState: 'sent',
    dispatchAttempts: 4,
    dispatchedAt: now,
    createdAt: now,
    updatedAt: now,
  })
})

const deletePlaylist = (
  options: {
    readonly expectedRevision?: number
    readonly parentWinner?: SQL
    readonly fence?: SQL
    readonly revokeAfterLookup?: boolean
  } = {},
) =>
  store.execute({
    key,
    normalizedInput: { playlistId: 'playlist', expectedRevision: options.expectedRevision ?? 0 },
    now,
    authorize: async () => {
      const row = await prepare(sql`SELECT (${liveGuard}) AS allowed`).first<{ allowed: number }>()

      return row?.allowed === 1
    },
    prepare: async () => {
      if (options.revokeAfterLookup) await db.update(user).set({ banned: true })

      return {
        status: 'ready',
        build: (ctx) => {
          const parentWinner =
            options.parentWinner ??
            sql`EXISTS (SELECT 1 FROM music_playlists
            WHERE id='playlist' AND last_operation_id=${ctx.attemptId})`

          const guard = sql`(${ctx.fence}) AND (${liveGuard}) AND (${parentWinner})`

          return {
            statements: [
              ctx.prepare(sql`UPDATE music_playlists
                SET revision=revision+1,last_operation_id=${ctx.attemptId}
                WHERE id='playlist' AND revision=${options.expectedRevision ?? 0}
                  AND (${ctx.fence}) AND (${liveGuard})`),
              ...playlistImportRetirementStatements({
                playlistId: 'playlist',
                ctx: options.fence ? { ...ctx, fence: options.fence } : ctx,
                parentWinner,
                liveGuard,
                now,
              }),
              ctx.prepare(sql`DELETE FROM music_playlists WHERE id='playlist' AND (${guard})`),
            ],
            // The guarded DELETE is immediately before common receipt finalization.
            // Only at this adjacency does changes() prove this physical deletion;
            // absence alone also holds when the parent never existed.
            assertApplied: sql`(${ctx.fence}) AND (${liveGuard})
              AND changes()=1
              AND NOT EXISTS (SELECT 1 FROM music_playlists WHERE id='playlist')
              AND NOT EXISTS (SELECT 1 FROM playlist_import_statuses WHERE playlist_id='playlist')`,
            outcome: { result: { deleted: true }, revision: 1, access: 'playlist' },
          }
        },
      }
    },
  })

test('a fresh delete key cannot claim a physical winner when the parent is already absent', async () => {
  await db.delete(mcpOperations)
  await db.delete(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, 'playlist'))
  expect((await deletePlaylist()).status).toBe('conflict')
  expect(await db.select().from(mcpOperations)).toEqual([])
  expect(await db.select().from(playlistImportStatusesTable)).toEqual([])
})

test('coupled delete retires actual worker state, retains safe aggregates and replays a lost response', async () => {
  // Concurrent same-key invocations race on the real common receipt, not a JS lock.
  const results = await Promise.all(Array.from({ length: 6 }, () => deletePlaylist()))
  expect(results.filter((result) => result.status === 'applied')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'replayed')).toHaveLength(5)
  const replay = await deletePlaylist()
  expect(replay).toMatchObject({ status: 'replayed', outcome: { result: { deleted: true } } })
  expect(await db.select().from(musicPlaylistsTable)).toMatchObject([{ id: 'other' }])
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    {
      phase: 'retired',
      revision: 1,
      terminalAt: now,
      updatedAt: now,
      playlistId: null,
      playlistRevision: null,
      cursorPosition: null,
      cursorTrackId: null,
      attemptId: null,
      leaseUntil: null,
      dispatchState: 'none',
      nextDispatchAt: null,
      dispatchedAt: null,
      generation: 2,
      dispatchAttempts: 4,
      importedProcessed: 3,
      importedTotal: 3,
      enrichmentProcessed: 2,
      enrichmentFailed: 1,
      enrichmentTotal: 5,
    },
  ])
  const [row] = await db.select().from(playlistImportStatusesTable)
  expect(row?.lastAttemptId).toMatch(/^[0-9a-f-]{36}$/)
  expect(
    (
      await store.execute({
        key,
        normalizedInput: { changed: true },
        now,
        authorize: async () => true,
        build: () => {
          throw new Error('Replay must precede building')
        },
      })
    ).status,
  ).toBe('conflict')
})

test.each(['stale-parent', 'wrong-winner', 'missing-fence', 'revoked'] as const)(
  '%s cannot retire, delete or save a receipt even with compound OR authority',
  async (scenario) => {
    const result = await deletePlaylist(
      omitUndefined({
        expectedRevision: scenario === 'stale-parent' ? 7 : 0,
        parentWinner: scenario === 'wrong-winner' ? sql`0 OR 0` : undefined,
        fence: scenario === 'missing-fence' ? sql`0 OR 0` : undefined,
        revokeAfterLookup: scenario === 'revoked',
      }),
    )

    expect(result.status).toBe('conflict')
    expect(
      await db.select().from(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, 'playlist')),
    ).toMatchObject([{ revision: 0, lastOperationId: null }])
    expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
      { phase: 'enriching', revision: 0, attemptId: workerAttempt },
    ])
    expect(await db.select().from(mcpOperations)).toHaveLength(1)
  },
)

test('one exhausted status rolls back every retirement, parent CAS, delete and new receipt', async () => {
  await db.insert(mcpOperations).values({
    id: 'c'.repeat(64),
    actorId: 'actor',
    clientId: 'other-client',
    inputHash: 'd'.repeat(64),
    attemptId: otherAttempt,
    state: 'complete',
    outcome: '{}',
    createdAt: now,
    expiresAt: now + 86_400_000,
  })
  await db.insert(playlistImportStatusesTable).values({
    operationId: 'c'.repeat(64),
    ...namespace,
    clientId: 'other-client',
    phase: 'enrichment_pending',
    playlistId: 'playlist',
    playlistRevision: 0,
    dispatchState: 'pending',
    nextDispatchAt: now,
    createdAt: now,
    updatedAt: now,
    revision: Number.MAX_SAFE_INTEGER,
  })
  expect((await deletePlaylist()).status).toBe('unavailable')
  expect(
    await db.select().from(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, 'playlist')),
  ).toMatchObject([{ revision: 0, lastOperationId: null }])
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { phase: 'enriching', revision: 0, playlistId: 'playlist' },
    { phase: 'enrichment_pending', revision: Number.MAX_SAFE_INTEGER, playlistId: 'playlist' },
  ])
  expect(await db.select().from(mcpOperations)).toHaveLength(2)
})

test('worker fence rejects expiry, takeover, terminal retirement and every namespace mismatch', async () => {
  const input = {
    operationId,
    namespace,
    attemptId: workerAttempt,
    generation: 2,
    phase: 'enriching',
  } as const

  const allowed = async (value: Parameters<typeof playlistImportWorkerFence>[0]) =>
    (
      await prepare(sql`SELECT (${playlistImportWorkerFence(value)}) AS allowed`).first<{
        allowed: number
      }>()
    )?.allowed

  expect(await allowed(input)).toBe(1)

  for (const changed of [
    { ...input, operationId: 'e'.repeat(64) },
    { ...input, attemptId: otherAttempt },
    { ...input, generation: 1 },
    { ...input, phase: 'importing' as const },
    ...(['actorId', 'clientId', 'resource'] as const).map((field) => ({
      ...input,
      namespace: { ...namespace, [field]: 'other' },
    })),
  ])
    expect(await allowed(changed)).toBe(0)
  await db.update(playlistImportStatusesTable).set({ leaseUntil: 0 })
  expect(await allowed(input)).toBe(0)
  await db.update(playlistImportStatusesTable).set({
    leaseUntil: Number.MAX_SAFE_INTEGER,
    attemptId: otherAttempt,
    generation: 3,
  })
  expect(await allowed(input)).toBe(0)
  expect(await allowed({ ...input, attemptId: otherAttempt, generation: 3 })).toBe(1)
  expect((await deletePlaylist()).status).toBe('applied')
  expect(await allowed({ ...input, attemptId: otherAttempt, generation: 3 })).toBe(0)
})
