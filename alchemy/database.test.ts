import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { databaseMigrationsDirectory, databaseProps } from './database'

const directories: Array<string> = []

const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'gbfm-local-database-'))
  directories.push(directory)

  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

test('deployment keeps the existing migrations and ignores local clone configuration', () => {
  expect(databaseProps({ isLocalDev: false, isProduction: false }, '/does/not/exist')).toEqual({
    migrations: databaseMigrationsDirectory,
  })
  expect(databaseProps({ isLocalDev: false, isProduction: true }, '/does/not/exist')).toEqual({
    migrations: { dir: databaseMigrationsDirectory, table: 'd1_migrations' },
  })
})

test('local development without a clone uses a local migrated database without a production name', () => {
  const directory = join(temporaryDirectory(), 'missing')
  expect(databaseProps({ isLocalDev: true, isProduction: false }, undefined, directory)).toEqual({
    migrations: databaseMigrationsDirectory,
  })
})

test('a clone keeps its baseline and synchronizes only migrations production has not applied', () => {
  const directory = temporaryDirectory()
  const migrations = join(directory, 'migrations')
  mkdirSync(migrations)
  writeFileSync(join(migrations, '00000000_production_clone.sql'), 'SELECT 1;')
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({
      appliedMigrations: readdirSync(databaseMigrationsDirectory).filter(
        (file) => file !== '0009_featured_mix.sql',
      ),
      baselineMigrations: ['00000000_production_clone.sql'],
    }),
  )

  expect(databaseProps({ isLocalDev: true, isProduction: false }, directory)).toEqual({
    migrations,
  })
  expect(readdirSync(migrations).sort()).toEqual([
    '00000000_production_clone.sql',
    '1000000009_0009_featured_mix.sql',
  ])
  expect(readFileSync(join(migrations, '1000000009_0009_featured_mix.sql'), 'utf8')).toBe(
    readFileSync(join(databaseMigrationsDirectory, '0009_featured_mix.sql'), 'utf8'),
  )
  expect(readFileSync(join(migrations, '00000000_production_clone.sql'), 'utf8')).toBe('SELECT 1;')
})

test('an explicitly configured missing or incomplete clone fails instead of using production', () => {
  expect(() =>
    databaseProps({ isLocalDev: true, isProduction: false }, join(temporaryDirectory(), 'missing')),
  ).toThrow()
  const directory = temporaryDirectory()
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({ appliedMigrations: [], baselineMigrations: [] }),
  )
  expect(() => databaseProps({ isLocalDev: true, isProduction: false }, directory)).toThrow(
    'missing its baseline',
  )
})
