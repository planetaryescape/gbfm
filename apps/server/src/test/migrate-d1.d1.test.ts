import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { createMigratedD1Database, d1MigrationFiles } from './migrate-d1'

const directory = path.dirname(fileURLToPath(import.meta.url))

const migrationsDirectory = path.resolve(directory, '../../drizzle-d1')

describe('migrated D1 test database', () => {
  test('keeps the deploy directory flat and aligned with the replay list', () => {
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith('.sql'))
      .sort()

    expect(existsSync(path.join(migrationsDirectory, 'meta', '_journal.json'))).toBe(false)
    expect(sqlFiles).toEqual([...d1MigrationFiles])
  })

  test('releases its Miniflare runtime when disposed', async () => {
    await using resource = await createMigratedD1Database([])

    await expect(resource.database.prepare('SELECT 1').first()).resolves.toBeDefined()
    await resource.dispose()

    expect(() => resource.database.prepare('SELECT 1').first()).toThrow('poisoned stub')
  })

  test('copies the complete migrated schema including indexes, triggers and FTS tables', async () => {
    expect(process.env.GBFM_D1_TEST_TEMPLATE).toBeDefined()
    await using copied = await createMigratedD1Database()
    await using replayed = await createMigratedD1Database(d1MigrationFiles)

    const schemaQuery =
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"

    const copiedSchema = await copied.database.prepare(schemaQuery).all()
    const replayedSchema = await replayed.database.prepare(schemaQuery).all()
    expect(copiedSchema.results).toEqual(replayedSchema.results)
    expect(await copied.database.prepare('PRAGMA foreign_keys').first()).toEqual(
      await replayed.database.prepare('PRAGMA foreign_keys').first(),
    )
  })

  test('isolates simultaneous copies and leaves the template unchanged after writes and disposal', async () => {
    await using first = await createMigratedD1Database()
    await using second = await createMigratedD1Database()

    for (const resource of [first, second])
      await resource.database.prepare('CREATE TABLE isolation_probe (value TEXT NOT NULL)').run()

    await first.database.prepare("INSERT INTO isolation_probe VALUES ('first')").run()
    await second.database.prepare("INSERT INTO isolation_probe VALUES ('second')").run()
    expect(await first.database.prepare('SELECT value FROM isolation_probe').first()).toEqual({
      value: 'first',
    })
    expect(await second.database.prepare('SELECT value FROM isolation_probe').first()).toEqual({
      value: 'second',
    })
    await first.dispose()
    expect(await second.database.prepare('SELECT value FROM isolation_probe').first()).toEqual({
      value: 'second',
    })

    await using fresh = await createMigratedD1Database()
    expect(
      await fresh.database
        .prepare("SELECT name FROM sqlite_master WHERE name = 'isolation_probe'")
        .first(),
    ).toBeNull()
  })

  test('replays explicitly selected migrations without copying the full schema', async () => {
    await using empty = await createMigratedD1Database([])
    await using initial = await createMigratedD1Database([d1MigrationFiles[0]])

    const userTable = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'"
    expect(await empty.database.prepare(userTable).first()).toBeNull()
    expect(await initial.database.prepare(userTable).first()).toEqual({ name: 'user' })
    expect(
      await initial.database
        .prepare("SELECT name FROM sqlite_master WHERE name = 'music_source_identities'")
        .first(),
    ).toBeNull()
  })
})
