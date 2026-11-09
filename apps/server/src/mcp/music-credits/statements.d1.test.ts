import type { D1Database } from '@cloudflare/workers-types'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, test } from 'vitest'

import { user } from '../../db/auth.schema'
import { musicArtistAliasesTable, musicRecordingCreditsTable } from '../../db/music-credit.schema'
import { musicAlbumsTable, musicArtistsTable, musicTracksTable } from '../../db/music-entity.schema'
import { createMigratedD1Database } from '../../test/migrate-d1'
import { createMcpOperationStore, type ExecuteOperation } from '../operations/store'
import { artistAliasStatements, recordingCreditStatements } from './statements'

const actorId = 'facts-admin'

const clientId = 'facts-client'

const trackId = '00000000-0000-4000-8000-000000000001'

const artistId = '00000000-0000-4000-8000-000000000002'

const albumId = '00000000-0000-4000-8000-000000000003'

const now = 1_800_000_000_000

const evidence = {
  sourceLabel: 'Sleeve',
  sourceUrl: null,
  evidenceNote: 'Page 2',
  assertedById: actorId,
  assertedAt: new Date(now),
  createdAt: new Date(now),
}

const seed = async (database: D1Database) => {
  const db = drizzle(database)
  await db.insert(user).values({
    id: actorId,
    name: 'Admin',
    email: 'facts@example.test',
    role: 'admin',
    banned: false,
  })
  await database
    .prepare('INSERT INTO oauth_client(id,client_id,redirect_uris,disabled) VALUES(?,?,?,0)')
    .bind('facts-oauth', clientId, '[]')
    .run()
  await db.insert(musicArtistsTable).values({ id: artistId, name: 'Echo', slug: 'echo' })
  await db
    .insert(musicAlbumsTable)
    .values({ id: albumId, title: 'Album', slug: 'album', artistNames: ['Old billing'] })
  await db
    .insert(musicTracksTable)
    .values({ id: trackId, title: 'Track', slug: 'track', albumId, artistNames: ['Old billing'] })

  return db
}

const credit = (instrument: string): typeof musicRecordingCreditsTable.$inferSelect => ({
  id: crypto.randomUUID(),
  trackId,
  albumId: null,
  artistId,
  creditedName: 'Echo',
  creditedNameKey: 'echo',
  role: 'instrument',
  instrument,
  instrumentKey: instrument.toLowerCase(),
  participantKey: `artist:${artistId}`,
  displayOrder: instrument === 'Bass' ? 0 : 1,
  ...evidence,
})

const alias = (name: string): typeof musicArtistAliasesTable.$inferSelect => ({
  id: crypto.randomUUID(),
  artistId,
  name,
  nameKey: name.toLowerCase(),
  ...evidence,
})

// This test-only root CAS composes the real domain statement builders with the
// shared executor. It is NOT P1's production live-grant checkpoint or registration.
const command = (
  database: D1Database,
  expectedRevision: number,
  rows: ReadonlyArray<typeof musicRecordingCreditsTable.$inferSelect>,
  requestId = crypto.randomUUID(),
  target: { readonly type: 'track' | 'album'; readonly id: string } = {
    type: 'track',
    id: trackId,
  },
): Extract<ExecuteOperation, { readonly prepare?: never }> => ({
  key: {
    actorId,
    clientId,
    resource: 'https://mcp.test/resource',
    operation: 'set_recording_credits',
    requestId,
  },
  now,
  normalizedInput: {
    target,
    expectedRevision,
    rows: rows.map((row) => ({
      ...row,
      assertedAt: row.assertedAt.getTime(),
      createdAt: row.createdAt.getTime(),
    })),
  },
  authorize: async () =>
    Boolean(
      await database
        .prepare("SELECT id FROM user WHERE id=? AND role='admin' AND banned=0")
        .bind(actorId)
        .first(),
    ),
  build: (context) => {
    const parent = sql.identifier(target.type === 'track' ? 'music_tracks' : 'music_albums')
    const winner = sql`EXISTS (SELECT 1 FROM ${parent} WHERE id=${target.id} AND last_operation_id=${context.attemptId})`

    return {
      statements: [
        context.prepare(
          sql`UPDATE ${parent} SET revision=revision+1,last_operation_id=${context.attemptId} WHERE id=${target.id} AND revision=${expectedRevision} AND (${context.fence}) AND EXISTS(SELECT 1 FROM user WHERE id=${actorId} AND role='admin' AND banned=0)`,
        ),
        ...recordingCreditStatements(context, winner, target, rows),
      ],
      assertApplied: winner,
      outcome: {
        result: rows.map((row) => ({ id: row.id, instrument: row.instrument })),
        revision: expectedRevision + 1,
        access: target,
      },
    }
  },
})

describe('M2 fact statements on migrated D1 with shared receipts', () => {
  test('opaque OR predicates cannot bypass either guard or widen target deletion', async () => {
    await using resource = await createMigratedD1Database()
    const db = await seed(resource.database)
    const otherTrackId = '00000000-0000-4000-8000-000000000004'
    const otherArtistId = '00000000-0000-4000-8000-000000000005'
    await db.insert(musicTracksTable).values({ id: otherTrackId, title: 'Other', slug: 'other' })
    await db.insert(musicArtistsTable).values({ id: otherArtistId, name: 'Other', slug: 'other' })
    const originalCredit = credit('Bass')
    const otherCredit = { ...credit('Piano'), trackId: otherTrackId }
    const originalAlias = alias('Original')
    const otherAlias = { ...alias('Other'), artistId: otherArtistId }
    await db.insert(musicRecordingCreditsTable).values([originalCredit, otherCredit])
    await db.insert(musicArtistAliasesTable).values([originalAlias, otherAlias])
    const replacementCredit = credit('Organ')
    const replacementAlias = alias('Replacement')
    const store = createMcpOperationStore(resource.database)

    for (const { fence, winner } of [
      { fence: sql`1 OR 0`, winner: sql`0` },
      { fence: sql`0`, winner: sql`0 OR 1` },
    ]) {
      const result = await store.execute({
        ...command(resource.database, 0, []),
        build: (context) => ({
          statements: [
            ...recordingCreditStatements(
              { ...context, fence },
              winner,
              { type: 'track', id: trackId },
              [replacementCredit],
            ),
            ...artistAliasStatements({ ...context, fence }, winner, artistId, [replacementAlias]),
          ],
          // Isolate builder predicates: a root/finalization rollback must not hide leaked DML.
          // These literal guards are test probes, not an authorized runtime command.
          assertApplied: sql`1`,
          outcome: { result: null, revision: null, access: null },
        }),
      })

      expect(result.status).toBe('applied')
      expect(
        await db.select().from(musicRecordingCreditsTable).orderBy(musicRecordingCreditsTable.id),
      ).toEqual([originalCredit, otherCredit].toSorted((a, b) => a.id.localeCompare(b.id)))
      expect(
        await db.select().from(musicArtistAliasesTable).orderBy(musicArtistAliasesTable.id),
      ).toEqual([originalAlias, otherAlias].toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    const result = await store.execute({
      ...command(resource.database, 0, []),
      build: (context) => ({
        statements: [
          ...recordingCreditStatements(
            { ...context, fence: sql`1 OR 0` },
            sql`1 OR 0`,
            { type: 'track', id: trackId },
            [replacementCredit],
          ),
          ...artistAliasStatements({ ...context, fence: sql`1 OR 0` }, sql`1 OR 0`, artistId, [
            replacementAlias,
          ]),
        ],
        assertApplied: sql`1`,
        outcome: { result: null, revision: null, access: null },
      }),
    })

    expect(result.status).toBe('applied')
    expect(
      await db.select().from(musicRecordingCreditsTable).orderBy(musicRecordingCreditsTable.id),
    ).toEqual([replacementCredit, otherCredit].toSorted((a, b) => a.id.localeCompare(b.id)))
    expect(
      await db.select().from(musicArtistAliasesTable).orderBy(musicArtistAliasesTable.id),
    ).toEqual([replacementAlias, otherAlias].toSorted((a, b) => a.id.localeCompare(b.id)))
  })

  test('replaces only credits, clears explicitly, and replays the original after later edits', async () => {
    await using resource = await createMigratedD1Database()
    const db = await seed(resource.database)
    const rows = [credit('Bass'), credit('Piano')]
    const store = createMcpOperationStore(resource.database)
    const input = command(resource.database, 0, rows)
    const first = await store.execute(input)
    expect(first.status).toBe('applied')
    expect(
      await db
        .select()
        .from(musicRecordingCreditsTable)
        .orderBy(musicRecordingCreditsTable.displayOrder),
    ).toEqual(rows)
    expect(await db.select().from(musicTracksTable)).toMatchObject([
      { revision: 1, artistNames: ['Old billing'] },
    ])
    expect(await db.select().from(musicAlbumsTable)).toMatchObject([
      { revision: 0, artistNames: ['Old billing'] },
    ])
    expect((await store.execute(command(resource.database, 1, []))).status).toBe('applied')
    expect(await db.select().from(musicRecordingCreditsTable)).toEqual([])
    expect(await createMcpOperationStore(resource.database).execute(input)).toEqual({
      ...first,
      status: 'replayed',
    })
    expect(await db.select().from(musicRecordingCreditsTable)).toEqual([])
    expect(await db.select().from(musicTracksTable)).toMatchObject([{ revision: 2 }])
    expect((await store.execute({ ...input, normalizedInput: { changed: true } })).status).toBe(
      'conflict',
    )

    const albumCredit: typeof musicRecordingCreditsTable.$inferSelect = {
      ...credit('Bass'),
      trackId: null,
      albumId,
      artistId: null,
      creditedName: 'Name-only Engineer',
      creditedNameKey: 'name-only engineer',
      participantKey: 'name:name-only engineer',
      role: 'engineer',
      instrument: null,
      instrumentKey: '',
    }

    expect(
      (
        await store.execute(
          command(resource.database, 0, [albumCredit], crypto.randomUUID(), {
            type: 'album',
            id: albumId,
          }),
        )
      ).status,
    ).toBe('applied')
    expect(await db.select().from(musicRecordingCreditsTable)).toEqual([albumCredit])
    expect(await db.select().from(musicTracksTable)).toMatchObject([{ revision: 2 }])
    expect(await db.select().from(musicAlbumsTable)).toMatchObject([
      { revision: 1, artistNames: ['Old billing'] },
    ])
  })

  test('one concurrent version wins; loser and constraint failures cannot leave partial credits or receipts', async () => {
    await using resource = await createMigratedD1Database()
    const db = await seed(resource.database)
    const store = createMcpOperationStore(resource.database)
    const bass = credit('Bass')
    const piano = credit('Piano')
    const inputs = [command(resource.database, 0, [bass]), command(resource.database, 0, [piano])]
    const results = await Promise.all(inputs.map((input) => store.execute(input)))
    expect(results.map((result) => result.status).toSorted()).toEqual(['applied', 'conflict'])
    const winningRows = results[0]?.status === 'applied' ? [bass] : [piano]
    expect(await db.select().from(musicRecordingCreditsTable)).toEqual(winningRows)
    const duplicate = credit('Bass')

    const broken = command(resource.database, 1, [
      duplicate,
      { ...duplicate, id: crypto.randomUUID() },
    ])

    expect((await store.execute(broken)).status).toBe('unavailable')
    expect(await db.select().from(musicRecordingCreditsTable)).toEqual(winningRows)
    expect(await db.select().from(musicTracksTable)).toMatchObject([{ revision: 1 }])
    expect(
      await resource.database.prepare('SELECT count(*) AS count FROM mcp_operations').first(),
    ).toEqual({ count: 1 })
    await resource.database.prepare('UPDATE user SET banned=1 WHERE id=?').bind(actorId).run()
    const successful = inputs[results[0]?.status === 'applied' ? 0 : 1]

    if (!successful) throw new Error('Expected one successful command')
    expect((await store.execute(successful)).status).toBe('access_denied')
  })

  test('alias replacement preserves explicit IDs and commits or clears only its artist collection', async () => {
    await using resource = await createMigratedD1Database()
    const db = await seed(resource.database)
    const store = createMcpOperationStore(resource.database)
    const original = alias('Other Name')

    const run = (
      revision: number,
      rows: ReadonlyArray<typeof musicArtistAliasesTable.$inferSelect>,
    ) =>
      store.execute({
        ...command(resource.database, revision, []),
        key: {
          actorId,
          clientId,
          resource: 'https://mcp.test/resource',
          operation: 'set_artist_aliases',
          requestId: crypto.randomUUID(),
        },
        normalizedInput: {
          artistId,
          revision,
          rows: rows.map((row) => ({
            ...row,
            assertedAt: row.assertedAt.getTime(),
            createdAt: row.createdAt.getTime(),
          })),
        },
        build: (context) => {
          const winner = sql`EXISTS(SELECT 1 FROM music_artists WHERE id=${artistId} AND last_operation_id=${context.attemptId})`

          return {
            statements: [
              context.prepare(
                sql`UPDATE music_artists SET revision=revision+1,last_operation_id=${context.attemptId} WHERE id=${artistId} AND revision=${revision} AND (${context.fence}) AND EXISTS(SELECT 1 FROM user WHERE id=${actorId} AND role='admin' AND banned=0)`,
              ),
              ...artistAliasStatements(context, winner, artistId, rows),
            ],
            assertApplied: winner,
            outcome: {
              result: rows.map((row) => ({ id: row.id, name: row.name })),
              revision: revision + 1,
              access: { artistId },
            },
          }
        },
      })

    expect((await run(0, [original])).status).toBe('applied')
    const edited = { ...original, name: 'Other Spelling', nameKey: 'other spelling' }
    expect((await run(1, [edited])).status).toBe('applied')
    expect(await db.select().from(musicArtistAliasesTable)).toEqual([edited])
    expect((await run(2, [])).status).toBe('applied')
    expect(await db.select().from(musicArtistAliasesTable)).toEqual([])
    expect(await db.select().from(musicArtistsTable)).toMatchObject([{ revision: 3, name: 'Echo' }])
    expect(await db.select().from(musicTracksTable)).toMatchObject([{ revision: 0 }])
  })
})
