import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

/** Shared atomic-phase receipts. Deletion/redaction triggers live in migration 0016. */
export const mcpOperations = sqliteTable(
  'mcp_operations',
  {
    id: text().primaryKey(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    clientId: text('client_id'),
    inputHash: text('input_hash').notNull(),
    attemptId: text('attempt_id'),
    state: text({ enum: ['pending', 'complete', 'expired'] }).notNull(),
    outcome: text(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('mcp_operations_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.state} <> 'expired'`),
    index('mcp_operations_actor_idx').on(table.actorId),
    index('mcp_operations_client_idx').on(table.clientId),
    check(
      'mcp_operation_winner',
      sql`${table.state} <> 'complete' OR ${table.outcome} IS NOT NULL`,
    ),
    check('mcp_operations_id', sql`length(${table.id}) = 64`),
    check('mcp_operations_hash', sql`length(${table.inputHash}) = 64`),
    check('mcp_operations_state', sql`${table.state} IN ('pending', 'complete', 'expired')`),
    check(
      'mcp_operations_created',
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199168340991`,
    ),
    check(
      'mcp_operations_window',
      sql`typeof(${table.expiresAt}) = 'integer' AND ${table.expiresAt} = ${table.createdAt} + 86400000`,
    ),
    check(
      'mcp_operations_outcome',
      sql`${table.outcome} IS NULL OR (json_valid(${table.outcome}) AND length(CAST(${table.outcome} AS BLOB)) <= 65536)`,
    ),
    check(
      'mcp_operations_lifecycle',
      sql`(${table.state} = 'expired' AND ${table.outcome} IS NULL AND ${table.attemptId} IS NULL AND ${table.actorId} IS NULL AND ${table.clientId} IS NULL) OR (${table.state} IN ('pending', 'complete') AND ${table.actorId} IS NOT NULL AND ${table.clientId} IS NOT NULL AND ${table.attemptId} IS NOT NULL AND length(${table.attemptId}) = 36)`,
    ),
  ],
)

/** Same receipt's staged artwork phase; lifecycle/immutability triggers live in 0021. */
export const mcpOperationArtwork = sqliteTable(
  'mcp_operation_artwork',
  {
    operationId: text('operation_id')
      .primaryKey()
      .references(() => mcpOperations.id, { onDelete: 'restrict' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    clientId: text('client_id'),
    disposition: text({ enum: ['created', 'reused'] }),
    entityType: text('entity_type', {
      enum: ['artist', 'album', 'track', 'label', 'playlist'],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    catalogueRevision: integer('catalogue_revision').notNull(),
    sourceIdentityKey: text('source_identity_key'),
    artworkPolicy: text('artwork_policy', { enum: ['required', 'best_effort'] }).notNull(),
    phase: text({
      enum: ['pending', 'uploading', 'association_pending', 'delivered', 'failed'],
    }).notNull(),
    artifact: text(),
    leaseAttemptId: text('lease_attempt_id'),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    leaseExpiresAt: integer('lease_expires_at'),
    associatedRevision: integer('associated_revision'),
    failureCode: text('failure_code', {
      enum: [
        'access_denied',
        'target_missing',
        'stale_revision',
        'source_unavailable',
        'artifact_rejected',
      ],
    }),
    retired: integer().notNull().default(0),
  },
  (table) => [
    index('mcp_operation_artwork_recovery_idx')
      .on(table.phase, table.leaseExpiresAt)
      .where(sql`${table.retired} = 0`),
    check(
      'mcp_artwork_winner',
      sql`${table.associatedRevision} IS NULL OR (typeof(${table.associatedRevision}) = 'integer' AND ${table.associatedRevision} = ${table.catalogueRevision} + 1)`,
    ),
    check('mcp_artwork_disposition', sql`${table.disposition} IN ('created','reused')`),
    check(
      'mcp_artwork_type',
      sql`${table.entityType} IN ('artist','album','track','label','playlist')`,
    ),
    check('mcp_artwork_entity', sql`length(${table.entityId}) BETWEEN 1 AND 200`),
    check(
      'mcp_artwork_revision',
      sql`typeof(${table.catalogueRevision}) = 'integer' AND ${table.catalogueRevision} BETWEEN 0 AND 9007199254740990`,
    ),
    check('mcp_artwork_policy', sql`${table.artworkPolicy} IN ('required','best_effort')`),
    check(
      'mcp_artwork_phase',
      sql`${table.phase} IN ('pending','uploading','association_pending','delivered','failed')`,
    ),
    check(
      'mcp_artwork_artifact',
      sql`${table.artifact} IS NULL OR (json_valid(${table.artifact}) AND length(CAST(${table.artifact} AS BLOB)) <= 2048)`,
    ),
    check(
      'mcp_artwork_generation',
      sql`typeof(${table.leaseGeneration}) = 'integer' AND ${table.leaseGeneration} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'mcp_artwork_failure',
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN ('access_denied','target_missing','stale_revision','source_unavailable','artifact_rejected')`,
    ),
    check('mcp_artwork_retired', sql`${table.retired} IN (0,1)`),
    check(
      'mcp_artwork_delivered',
      sql`${table.phase} <> 'delivered' OR ${table.associatedRevision} IS NOT NULL`,
    ),
    check(
      'mcp_artwork_lease',
      sql`(${table.leaseAttemptId} IS NULL AND ${table.leaseExpiresAt} IS NULL) OR (${table.leaseAttemptId} IS NOT NULL AND length(${table.leaseAttemptId}) = 36 AND typeof(${table.leaseExpiresAt}) = 'integer' AND ${table.leaseExpiresAt} >= 0)`,
    ),
    check(
      'mcp_artwork_failed',
      sql`(${table.phase} = 'failed' AND ${table.failureCode} IS NOT NULL) OR (${table.phase} <> 'failed' AND ${table.failureCode} IS NULL)`,
    ),
    check(
      'mcp_artwork_snapshot',
      sql`(${table.phase} = 'pending' AND ${table.artifact} IS NULL) OR (${table.phase} IN ('uploading','association_pending','delivered') AND ${table.artifact} IS NOT NULL) OR ${table.phase} = 'failed'`,
    ),
    check(
      'mcp_artwork_lifecycle',
      sql`(${table.retired} = 1 AND ${table.disposition} IS NULL AND ${table.actorId} IS NULL AND ${table.clientId} IS NULL AND ${table.sourceIdentityKey} IS NULL AND ${table.leaseAttemptId} IS NULL AND ${table.leaseExpiresAt} IS NULL) OR (${table.retired} = 0 AND ${table.disposition} IS NOT NULL AND ${table.actorId} IS NOT NULL AND ${table.clientId} IS NOT NULL AND ${table.sourceIdentityKey} IS NOT NULL)`,
    ),
  ],
)
