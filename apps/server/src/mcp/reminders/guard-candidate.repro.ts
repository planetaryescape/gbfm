// Proposed guards only, NOT an application schema/migration or write tool.
// Run like storage-gates.repro.ts, using a temporary *.d1.test.ts filename.
import { expect, test } from 'vitest'

import { createMigratedD1Database } from '@/test/migrate-d1'

test('candidate revision and sticky dispatch fence arbitrate both race orders on D1', async () => {
  await using resource = await createMigratedD1Database()
  const d1 = resource.database
  // Separate disposable proof table; never changes music_reminder or migrations.
  await d1
    .prepare(`CREATE TABLE reminder_guard_candidate (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    command_revision INTEGER NOT NULL DEFAULT 1
      CHECK(typeof(command_revision) = 'integer' AND command_revision BETWEEN 1 AND 9007199254740991),
    dispatch_state TEXT NOT NULL DEFAULT 'open'
      CHECK(dispatch_state IN ('open', 'fenced', 'accepted', 'cancelled')),
    claim_generation INTEGER NOT NULL DEFAULT 0
  )`)
    .run()

  for (const id of ['cancel-first', 'fence-first', 'stale', 'reschedule-first'])
    await d1
      .prepare('INSERT INTO reminder_guard_candidate(id, owner_id) VALUES (?, ?)')
      .bind(id, 'owner')
      .run()

  const cancel = (id: string, owner: string, revision: number) =>
    d1
      .prepare(`
    UPDATE reminder_guard_candidate SET dispatch_state = 'cancelled', command_revision = command_revision + 1
    WHERE id = ? AND owner_id = ? AND command_revision = ? AND dispatch_state = 'open'
      AND command_revision < 9007199254740991 RETURNING id
  `)
      .bind(id, owner, revision)
      .all()

  const fence = (id: string, revision: number) =>
    d1
      .prepare(`
    UPDATE reminder_guard_candidate SET dispatch_state = 'fenced'
    WHERE id = ? AND command_revision = ? AND claim_generation = 0 AND dispatch_state = 'open'
    RETURNING id
  `)
      .bind(id, revision)
      .all()

  const revise = (id: string, revision: number) =>
    d1
      .prepare(`
    UPDATE reminder_guard_candidate SET command_revision = command_revision + 1
    WHERE id = ? AND owner_id = 'owner' AND command_revision = ? AND dispatch_state = 'open'
      AND command_revision < 9007199254740991 RETURNING id
  `)
      .bind(id, revision)
      .all()

  expect((await cancel('cancel-first', 'owner', 1)).results).toHaveLength(1)
  expect((await fence('cancel-first', 1)).results).toEqual([])
  expect((await fence('fence-first', 1)).results).toHaveLength(1)
  expect((await cancel('fence-first', 'owner', 1)).results).toEqual([])
  expect((await revise('fence-first', 1)).results).toEqual([])
  expect((await cancel('stale', 'other', 1)).results).toEqual([])
  expect((await revise('stale', 1)).results).toHaveLength(1)
  expect((await cancel('stale', 'owner', 1)).results).toEqual([])
  expect((await revise('stale', 1)).results).toEqual([])
  expect((await revise('reschedule-first', 1)).results).toHaveLength(1)
  expect((await fence('reschedule-first', 1)).results).toEqual([])
  expect((await fence('reschedule-first', 2)).results).toHaveLength(1)

  // Recovery moves only the claim generation. The dispatch fence stays sticky:
  // an unknown/failed provider outcome cannot silently restore cancellation.
  await d1
    .prepare(`UPDATE reminder_guard_candidate SET claim_generation = 1 WHERE id = 'fence-first'`)
    .run()
  expect(
    await d1
      .prepare(`SELECT command_revision, dispatch_state, claim_generation
    FROM reminder_guard_candidate WHERE id = 'fence-first'`)
      .first(),
  ).toEqual({ command_revision: 1, dispatch_state: 'fenced', claim_generation: 1 })
  expect((await cancel('fence-first', 'owner', 1)).results).toEqual([])
  await expect(
    d1.prepare(`UPDATE reminder_guard_candidate SET command_revision = 0`).run(),
  ).rejects.toThrow()
  await expect(
    d1.prepare(`UPDATE reminder_guard_candidate SET dispatch_state = 'unknown'`).run(),
  ).rejects.toThrow()
})
