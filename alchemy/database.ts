import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type * as Cloudflare from 'alchemy/Cloudflare'
import { Schema } from 'effect'

import { pendingCloneMigrationName } from './clone-sql'
import type { StageConfig } from './stage'

export const localDatabaseCloneDirectory = '.alchemy/dev-database'

export const databaseMigrationsDirectory = './apps/server/drizzle-d1'

export const CloneManifest = Schema.Struct({
  appliedMigrations: Schema.Array(Schema.String),
  baselineMigrations: Schema.Array(Schema.String),
})

export const databaseProps = (
  config: Pick<StageConfig, 'isLocalDev' | 'isProduction'>,
  cloneDirectory: string | undefined,
  defaultDirectory = localDatabaseCloneDirectory,
): Cloudflare.D1.DatabaseProps => {
  const migrations = databaseMigrationsDirectory

  // Production already records exact Alchemy-format hashes in this table.
  // Keep using it rather than creating a second ledger and replaying history.
  if (config.isProduction) return { migrations: { dir: migrations, table: 'd1_migrations' } }

  if (!config.isLocalDev) return { migrations }

  const directory = cloneDirectory ?? defaultDirectory

  if (cloneDirectory === undefined && !existsSync(directory)) return { migrations }

  const manifest = Schema.decodeUnknownSync(CloneManifest)(
    JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')),
  )

  const localMigrations = join(directory, 'migrations')

  if (
    manifest.baselineMigrations.length === 0 ||
    manifest.baselineMigrations.some((file) => !existsSync(join(localMigrations, file)))
  ) {
    throw new Error('Local database clone is missing its baseline migration')
  }

  for (const file of readdirSync(migrations).filter((file) => file.endsWith('.sql'))) {
    if (!manifest.appliedMigrations.includes(file)) {
      copyFileSync(join(migrations, file), join(localMigrations, pendingCloneMigrationName(file)))
    }
  }

  return { migrations: localMigrations }
}
