import { AuthSession } from '@gbfm/api/middleware/auth'
import { eq, sql } from 'drizzle-orm'
import { Effect, Exit, Result } from 'effect'
import { afterAll, beforeEach, expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { mcpOperations } from '@/db/mcp-operation.schema'
import { musicPlaylistsTable } from '@/db/music-entity.schema'
import { playlistImportStatusesTable } from '@/db/playlist-import-status.schema'
import { CommandAuthority, makeSessionCommandAuthority } from '@/mcp/command-authority'
import type { McpToolError } from '@/mcp/contracts'
import { createMcpOperationStore } from '@/mcp/operations/store'
import { ConfigService } from '@/services/config.service'
import { createEditorialOAuthFixture } from '@/test/editorial-oauth'

import { playlistImportAcceptanceStatement } from './acceptance'
import { makePlaylistImportStatusService } from './service'

const fixture = await createEditorialOAuthFixture()

const db = fixture.db

const store = createMcpOperationStore(db.$client, () => {})

const workerAttempt = '12345678-1234-4234-8234-123456789012'

const nextAttempt = '22345678-1234-4234-8234-123456789012'

const receiptId = 'a'.repeat(64)

const requestId = '32345678-1234-4234-8234-123456789012'

const authority = await Effect.runPromise(
  makeSessionCommandAuthority.pipe(
    Effect.provideService(AuthSession, {
      user: { id: 'owner', name: 'owner', email: 'owner@example.com' },
      session: { id: 'owner-session', createdAt: new Date() },
    }),
    Effect.provideService(Database, db),
    Effect.provideService(ConfigService, fixture.config),
  ),
)

const service = await Effect.runPromise(
  makePlaylistImportStatusService.pipe(
    Effect.provideService(Database, db),
    Effect.provideService(CommandAuthority, authority),
  ),
)

afterAll(() => fixture[Symbol.asyncDispose]())

beforeEach(async () => {
  await db.delete(mcpOperations)
  await db.delete(musicPlaylistsTable)
  await db.update(user).set({ role: 'admin', banned: false }).where(eq(user.id, 'owner'))
  await db.update(session).set({ expiresAt: new Date(Date.now() + 600_000) })
  await db
    .insert(musicPlaylistsTable)
    .values({ id: 'playlist', title: 'Playlist', slug: 'playlist' })
  const checked = await Effect.runPromise(authority.checkpoint(['catalogue:write']))
  await db.insert(mcpOperations).values({
    id: receiptId,
    actorId: 'owner',
    clientId: checked.clientId,
    inputHash: 'b'.repeat(64),
    attemptId: workerAttempt,
    state: 'complete',
    outcome: '{}',
    createdAt: 100,
    expiresAt: 86_400_100,
  })
  await db.insert(playlistImportStatusesTable).values({
    operationId: receiptId,
    actorId: 'owner',
    clientId: checked.clientId,
    resource: checked.resource,
    phase: 'importing',
    attemptId: workerAttempt,
    generation: 1,
    leaseUntil: Date.now() + 60_000,
    importedTotal: 3,
    importedProcessed: 3,
    createdAt: 100,
    updatedAt: 100,
  })
})

const importedWorker = {
  operationId: receiptId,
  expectedRevision: 0,
  attemptId: workerAttempt,
  generation: 1,
  phase: 'importing',
} as const

const enqueue = () =>
  service.enqueueEnrichment({ ...importedWorker, playlistId: 'playlist', playlistRevision: 0 })

const failure = async <A>(effect: Effect.Effect<A, McpToolError>) => {
  const result = await Effect.runPromise(Effect.result(effect))
  expect(Result.isFailure(result)).toBe(true)

  return result
}

test('acceptance shares the original receipt; concurrency and lost response never fabricate completion', async () => {
  const checked = await Effect.runPromise(authority.checkpoint(['catalogue:write']))

  const input = {
    key: { ...checked, operation: 'fixture_admitted_import', requestId },
    normalizedInput: { sourceKey: 'controlled:test' },
    now: Date.now(),
    authorize: async () => {
      const result = await Effect.runPromise(Effect.exit(authority.checkpoint(['catalogue:write'])))

      return Exit.isSuccess(result)
    },
    build: (ctx: Parameters<typeof playlistImportAcceptanceStatement>[0]['ctx']) => ({
      statements: [playlistImportAcceptanceStatement({ ctx, authority: checked })],
      assertApplied: sql`(${ctx.fence}) AND (${checked.liveGuard}) AND EXISTS
        (SELECT 1 FROM playlist_import_statuses WHERE operation_id=${ctx.operationId} AND last_attempt_id=${ctx.attemptId})`,
      outcome: { result: { status: 'accepted' }, revision: 0, access: 'import_status' },
    }),
  }

  const results = await Promise.all(Array.from({ length: 6 }, () => store.execute(input)))
  expect(results.filter((result) => result.status === 'applied')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'replayed')).toHaveLength(5)
  const replay = await store.execute(input)
  expect(replay).toMatchObject({ status: 'replayed', outcome: { result: { status: 'accepted' } } })

  if (replay.status !== 'replayed') throw new Error('Expected original acceptance receipt')
  expect(await Effect.runPromise(service.read({ operationId: replay.operationId }))).toMatchObject({
    phase: 'importing',
    generation: 1,
    revision: 0,
    importedProcessed: 0,
    importedTotal: null,
    enrichmentProcessed: 0,
    enrichmentTotal: null,
    dispatchState: 'none',
    playlistId: null,
  })
  expect(await db.select().from(mcpOperations)).toHaveLength(2)
  expect(await db.select().from(playlistImportStatusesTable)).toHaveLength(2)
})

test('pending outbox survives send ambiguity; delivery before acknowledgment claims once without completing work', async () => {
  const queued = await Effect.runPromise(enqueue())
  expect(queued).toMatchObject({
    phase: 'enrichment_pending',
    revision: 1,
    dispatchState: 'pending',
    enrichmentTotal: null,
    leaseUntil: null,
  })

  const noted = await Effect.runPromise(
    service.noteDispatchAttempt({ operationId: receiptId, expectedRevision: 1 }),
  )

  expect(noted).toMatchObject({ revision: 2, dispatchState: 'pending', dispatchAttempts: 1 })
  expect(noted.nextDispatchAt).toBeGreaterThan(Date.now())

  const results = await Promise.all(
    [workerAttempt, nextAttempt].map((attemptId) =>
      Effect.runPromise(
        Effect.result(
          service.acquireEnrichment({ operationId: receiptId, expectedRevision: 2, attemptId }),
        ),
      ),
    ),
  )

  expect(results.filter(Result.isSuccess)).toHaveLength(1)
  expect(results.filter(Result.isFailure)).toHaveLength(1)
  expect(
    await failure(service.acknowledgeDispatch({ operationId: receiptId, expectedRevision: 2 })),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(await Effect.runPromise(service.read({ operationId: receiptId }))).toMatchObject({
    phase: 'enriching',
    revision: 3,
    generation: 2,
    enrichmentProcessed: 0,
    enrichmentTotal: null,
  })
})

test('lease renewal uses DB time; expired import interrupts and cannot be taken over or renewed', async () => {
  expect(await Effect.runPromise(service.renew(importedWorker))).toMatchObject({
    revision: 1,
    generation: 1,
  })
  await db.update(playlistImportStatusesTable).set({ leaseUntil: 0 })
  expect(await failure(service.renew({ ...importedWorker, expectedRevision: 1 }))).toMatchObject({
    failure: { code: 'conflict' },
  })
  expect(
    await failure(
      service.acquireEnrichment({
        operationId: receiptId,
        expectedRevision: 1,
        attemptId: nextAttempt,
      }),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(
    await Effect.runPromise(
      service.interruptExpiredImport({ operationId: receiptId, expectedRevision: 1 }),
    ),
  ).toMatchObject({
    phase: 'interrupted',
    failureCode: 'interrupted',
    revision: 2,
    importedProcessed: 3,
    importFailed: 0,
    attemptId: null,
    leaseUntil: null,
  })
})

test('expired enrichment takeover pins target revision and preserves actual cursor/outcomes', async () => {
  await Effect.runPromise(enqueue())
  await Effect.runPromise(
    service.acquireEnrichment({
      operationId: receiptId,
      expectedRevision: 1,
      attemptId: workerAttempt,
    }),
  )
  await db.update(playlistImportStatusesTable).set({
    leaseUntil: 0,
    enrichmentTotal: 4,
    enrichmentProcessed: 2,
    enrichmentFailed: 1,
    cursorPosition: 7,
    cursorTrackId: nextAttempt,
  })
  await db.update(musicPlaylistsTable).set({ revision: 1 })
  expect(
    await failure(
      service.acquireEnrichment({
        operationId: receiptId,
        expectedRevision: 2,
        attemptId: nextAttempt,
      }),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  await db.update(musicPlaylistsTable).set({ revision: 0 })

  const resumed = await Effect.runPromise(
    service.acquireEnrichment({
      operationId: receiptId,
      expectedRevision: 2,
      attemptId: nextAttempt,
    }),
  )

  expect(resumed).toMatchObject({
    generation: 3,
    revision: 3,
    attemptId: nextAttempt,
    enrichmentProcessed: 2,
    enrichmentFailed: 1,
    cursorPosition: 7,
    cursorTrackId: nextAttempt,
  })
  expect(
    await failure(
      service.renew({
        operationId: receiptId,
        expectedRevision: 3,
        attemptId: workerAttempt,
        generation: 2,
        phase: 'enriching',
      }),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
})

test('partial TTL redaction preserves safe totals; inflight TTL never prunes a worker', async () => {
  expect(
    await failure(service.pruneTerminal({ operationId: receiptId, expectedRevision: 0 })),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(await Effect.runPromise(service.read({ operationId: receiptId }))).toMatchObject({
    phase: 'importing',
  })
  await db.update(playlistImportStatusesTable).set({
    phase: 'partial',
    playlistId: 'playlist',
    playlistRevision: 0,
    terminalAt: 1000,
    attemptId: null,
    leaseUntil: null,
    enrichmentTotal: 5,
    enrichmentProcessed: 2,
    enrichmentFailed: 1,
  })
  expect(await failure(service.read({ operationId: receiptId }))).toMatchObject({
    failure: { code: 'not_found' },
  })
  expect(
    await Effect.runPromise(service.pruneTerminal({ operationId: receiptId, expectedRevision: 0 })),
  ).toMatchObject({
    phase: 'partial',
    playlistId: null,
    playlistRevision: null,
    importedProcessed: 3,
    enrichmentFailed: 1,
    enrichmentTotal: 5,
  })
})

test('fresh session authority and immutable namespace block every mutation and disclosure', async () => {
  await db.update(playlistImportStatusesTable).set({ clientId: 'gbfm:pat:not-this-session' })
  expect(await failure(service.read({ operationId: receiptId }))).toMatchObject({
    failure: { code: 'not_found' },
  })
  expect(await failure(service.renew(importedWorker))).toMatchObject({
    failure: { code: 'conflict' },
  })
  await db.update(playlistImportStatusesTable).set({ clientId: 'gbfm:session' })
  await db
    .update(session)
    .set({ expiresAt: new Date(0) })
    .where(eq(session.id, 'owner-session'))
  expect(await failure(service.read({ operationId: receiptId }))).toMatchObject({
    failure: { code: 'access_denied' },
  })
  expect(await failure(service.renew(importedWorker))).toMatchObject({
    failure: { code: 'access_denied' },
  })
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([{ revision: 0 }])
})

test('session expiry after the real checkpoint is fenced at SQL time', async () => {
  const raced = await Effect.runPromise(
    makePlaylistImportStatusService.pipe(
      Effect.provideService(Database, db),
      Effect.provideService(
        CommandAuthority,
        CommandAuthority.of({
          checkpoint: (scopes) =>
            authority.checkpoint(scopes).pipe(
              Effect.tap(() =>
                Effect.promise(() =>
                  db
                    .update(session)
                    .set({ expiresAt: new Date(0) })
                    .where(eq(session.id, 'owner-session')),
                ),
              ),
            ),
        }),
      ),
    ),
  )

  expect(await failure(raced.renew(importedWorker))).toMatchObject({
    failure: { code: 'conflict' },
  })
  expect(await db.select().from(playlistImportStatusesTable)).toMatchObject([
    { revision: 0, generation: 1, attemptId: workerAttempt },
  ])
})

test('successful send acknowledgment is not worker completion and invalid inputs cannot advance state', async () => {
  await Effect.runPromise(enqueue())
  await Effect.runPromise(
    service.noteDispatchAttempt({ operationId: receiptId, expectedRevision: 1 }),
  )
  expect(
    await Effect.runPromise(
      service.acknowledgeDispatch({ operationId: receiptId, expectedRevision: 2 }),
    ),
  ).toMatchObject({
    phase: 'enrichment_pending',
    dispatchState: 'sent',
    revision: 3,
    attemptId: null,
    leaseUntil: null,
    enrichmentProcessed: 0,
  })

  for (const raw of [
    { operationId: receiptId, expectedRevision: -1, attemptId: nextAttempt },
    { operationId: receiptId, expectedRevision: 3, attemptId: 'not-a-uuid' },
    { operationId: receiptId, expectedRevision: 3, attemptId: nextAttempt, actorId: 'forged' },
  ])
    expect(await failure(service.acquireEnrichment(raw))).toMatchObject({
      failure: { code: 'invalid_input' },
    })
  expect(await Effect.runPromise(service.read({ operationId: receiptId }))).toMatchObject({
    revision: 3,
    phase: 'enrichment_pending',
  })
})
