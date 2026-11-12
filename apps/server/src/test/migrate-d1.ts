import { readFileSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { D1Database } from '@cloudflare/workers-types'
import { Miniflare } from 'miniflare'

const directory = path.dirname(fileURLToPath(import.meta.url))

const migrationsDirectory = path.resolve(directory, '../../drizzle-d1')

/** The forward D1 migrations used by local server tests. */
export const d1MigrationFiles = [
  '0000_public_thunderbolt.sql',
  '0001_search_fts.sql',
  '0002_email_provider_receipt.sql',
  '0003_music_entity_resolution_claim.sql',
  '0004_music_entity_resolution_claim_lease.sql',
  '0005_navigation_lookup_indexes.sql',
  '0006_canonical_music_identity.sql',
  '0007_music_identity_backfill_checkpoint.sql',
  '0008_canonical_audio_urls.sql',
  '0009_featured_mix.sql',
  '0010_audio_artists.sql',
  '0011_listening_collections.sql',
  '0012_personal_access_keys.sql',
  '0013_editorial_oauth.sql',
  '0014_editorial_operations.sql',
  '0015_music_catalogue_read_indexes.sql',
  '0016_mcp_durable_operations.sql',
  '0017_mcp_domain_revisions.sql',
  '0018_music_credits_aliases.sql',
  '0019_post_music_references.sql',
  '0020_playlist_command_revisions.sql',
  '0021_mcp_staged_operations.sql',
  '0022_creator_revisions.sql',
  '0023_metadata_review.sql',
  '0024_music_entity_merges.sql',
  '0025_playlist_import_status.sql',
] as const

const splitStatements = (migration: string) =>
  migration
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

/** Applies selected forward D1 migrations to a local D1 binding. */
export const applyD1Migrations = async (
  database: D1Database,
  migrations: ReadonlyArray<(typeof d1MigrationFiles)[number]> = d1MigrationFiles,
) => {
  for (const migration of migrations) {
    const statements = splitStatements(
      readFileSync(path.join(migrationsDirectory, migration), 'utf8'),
    ).map((statement) => database.prepare(statement))

    if (statements.length > 0) await database.batch(statements)
  }
}

/** An isolated migrated D1 binding and the Miniflare runtime that owns it. */
export interface MigratedD1Database extends AsyncDisposable {
  readonly database: D1Database
  readonly dispose: () => Promise<void>
}

export const createD1MigrationTemplate = async (directory: string) => {
  const miniflare = new Miniflare({
    script: 'export default { fetch() { return new Response() } }',
    modules: true,
    d1Databases: { DB: 'test-d1' },
    resourcePersistencePath: directory,
  })

  try {
    await applyD1Migrations(await miniflare.getD1Database('DB'))
  } finally {
    await miniflare.dispose()
  }
}

export const createMigratedD1Database = async (
  migrations?: ReadonlyArray<(typeof d1MigrationFiles)[number]>,
): Promise<MigratedD1Database> => {
  const template = migrations === undefined ? process.env.GBFM_D1_TEST_TEMPLATE : undefined
  const directory = template ? await mkdtemp(path.join(tmpdir(), 'gbfm-d1-copy-')) : undefined
  let miniflare: Miniflare | undefined

  try {
    if (template && directory) await cp(template, directory, { recursive: true })

    miniflare = new Miniflare({
      script: 'export default { fetch() { return new Response() } }',
      modules: true,
      d1Databases: { DB: 'test-d1' },
      resourcePersistencePath: directory,
    })

    const runtime = miniflare
    const database = await runtime.getD1Database('DB')

    if (!template) await applyD1Migrations(database, migrations)
    let disposed = false

    const dispose = async () => {
      if (disposed) return
      disposed = true

      try {
        await runtime.dispose()
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true })
      }
    }

    return {
      database,
      dispose,
      [Symbol.asyncDispose]: dispose,
    }
  } catch (cause) {
    try {
      await miniflare?.dispose()
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true })
    }

    throw cause
  }
}
