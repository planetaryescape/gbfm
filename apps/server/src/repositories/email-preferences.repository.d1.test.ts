import { eq, sql } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { userEmailPreferencesTable } from '@/db/email.schema'
import { makeDatabaseClient } from '@/db/layer'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createMigratedD1Database } from '@/test/migrate-d1'

import {
  getOrCreateEmailPreferencesByUserId,
  globalUnsubscribe,
} from './email-preferences.repository'

test('a getter paused after an absent read returns the winning opt-out without replacing identity or consent', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })

  const gate = gatedPostDatabase(
    resource.database,
    'after',
    /^select .*from "user_email_preferences"/i,
  )

  const pending = getOrCreateEmailPreferencesByUserId('listener', makeDatabaseClient(gate.database))

  try {
    await gate.reached
    const optedOut = await globalUnsubscribe('listener', db)
    gate.release()
    expect(await pending).toEqual(optedOut)
    expect(await db.select().from(userEmailPreferencesTable)).toEqual([optedOut])
    expect(optedOut).toMatchObject({
      globalUnsubscribe: true,
      mixReleaseEnabled: false,
      promotionalEnabled: false,
      systemEnabled: false,
    })
  } finally {
    gate.release()
    await pending
  }
})

test('an opt-out paused before insertion repairs a winning default creation without replacing identity or token', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })

  const gate = gatedPostDatabase(
    resource.database,
    'before',
    /^insert into "user_email_preferences"/i,
  )

  const pending = globalUnsubscribe('listener', makeDatabaseClient(gate.database))

  try {
    await gate.reached
    const original = await getOrCreateEmailPreferencesByUserId('listener', db)
    gate.release()
    const optedOut = await pending
    expect(optedOut).toMatchObject({
      id: original.id,
      unsubscribeToken: original.unsubscribeToken,
      createdAt: original.createdAt,
      globalUnsubscribe: true,
      mixReleaseEnabled: false,
      promotionalEnabled: false,
      systemEnabled: false,
    })
    expect(await db.select().from(userEmailPreferencesTable)).toEqual([optedOut])
  } finally {
    gate.release()
    await pending
  }
})

test('concurrent default creators return the same persisted preference identity', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })

  const preferences = await Promise.all(
    Array.from({ length: 4 }, () => getOrCreateEmailPreferencesByUserId('listener', db)),
  )

  const rows = await db.select().from(userEmailPreferencesTable)
  expect(rows).toHaveLength(1)

  for (const result of preferences) expect(result).toEqual(rows[0])
})

test('an already fully opted-out row is returned unchanged without an update', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
  const original = await globalUnsubscribe('listener', db)
  await db
    .update(userEmailPreferencesTable)
    .set({ updatedAt: new Date(0) })
    .where(eq(userEmailPreferencesTable.userId, 'listener'))
  const [before] = await db.select().from(userEmailPreferencesTable)
  await db.run(
    sql`CREATE TRIGGER reject_redundant_update BEFORE UPDATE ON user_email_preferences BEGIN SELECT RAISE(ABORT, 'fixture redundant update'); END`,
  )

  const repeated = await globalUnsubscribe('listener', db)
  expect(repeated).toEqual(before)
  expect(repeated.id).toBe(original.id)
  expect(repeated.unsubscribeToken).toBe(original.unsubscribeToken)
  expect(repeated.updatedAt).toEqual(new Date(0))
  expect(await db.select().from(userEmailPreferencesTable)).toEqual([before])
})

test.each([
  'globalUnsubscribe',
  'mixReleaseEnabled',
  'promotionalEnabled',
  'systemEnabled',
] as const)('an inconsistent %s flag is repaired rather than skipped as a no-op', async (flag) => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
  const original = await globalUnsubscribe('listener', db)
  await db
    .update(userEmailPreferencesTable)
    .set({ [flag]: flag !== 'globalUnsubscribe', updatedAt: new Date(0) })
    .where(eq(userEmailPreferencesTable.userId, 'listener'))

  const repaired = await globalUnsubscribe('listener', db)
  expect(repaired).toMatchObject({
    id: original.id,
    unsubscribeToken: original.unsubscribeToken,
    globalUnsubscribe: true,
    mixReleaseEnabled: false,
    promotionalEnabled: false,
    systemEnabled: false,
  })
  expect(repaired.updatedAt.getTime()).toBeGreaterThan(0)
})
