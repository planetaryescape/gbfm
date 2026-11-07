import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'
import { mcpOperations } from './mcp-operation.schema'

/** Bounded playlist import progress/outbox, attached to the shared receipt. */
export const playlistImportStatusesTable = sqliteTable(
  'playlist_import_statuses',
  {
    operationId: text('operation_id')
      .primaryKey()
      .references(() => mcpOperations.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    resource: text('resource').notNull(),
    playlistId: text('playlist_id'),
    playlistRevision: integer('playlist_revision'),
    phase: text('phase', {
      enum: [
        'importing',
        'enrichment_pending',
        'enriching',
        'completed',
        'partial',
        'failed',
        'interrupted',
        'retired',
      ],
    }).notNull(),
    importedProcessed: integer('imported_processed').notNull().default(0),
    importFailed: integer('import_failed').notNull().default(0),
    enrichmentProcessed: integer('enrichment_processed').notNull().default(0),
    enrichmentFailed: integer('enrichment_failed').notNull().default(0),
    importedTotal: integer('imported_total'),
    enrichmentTotal: integer('enrichment_total'),
    failureCode: text('failure_code', {
      enum: [
        'provider_unavailable',
        'source_changed',
        'authority_denied',
        'target_changed',
        'status_unavailable',
        'interrupted',
      ],
    }),
    revision: integer('revision').notNull().default(0),
    lastAttemptId: text('last_attempt_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    terminalAt: integer('terminal_at'),
    dispatchState: text('dispatch_state', { enum: ['none', 'pending', 'sent'] })
      .notNull()
      .default('none'),
    dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
    nextDispatchAt: integer('next_dispatch_at'),
    dispatchedAt: integer('dispatched_at'),
    attemptId: text('attempt_id'),
    generation: integer('generation').notNull().default(0),
    leaseUntil: integer('lease_until'),
    cursorPosition: integer('cursor_position'),
    cursorTrackId: text('cursor_track_id'),
  },
  (t) => [
    check(
      'playlist_import_statuses_namespace',
      sql`instr(${t.clientId}, char(0)) = 0 AND length(${t.clientId}) BETWEEN 1 AND 256 AND instr(${t.resource}, char(0)) = 0 AND length(${t.resource}) BETWEEN 1 AND 2048`,
    ),
    check(
      'playlist_import_statuses_phase',
      sql`${t.phase} IN ('importing','enrichment_pending','enriching','completed','partial','failed','interrupted','retired')`,
    ),
    check(
      'playlist_import_statuses_import_counts',
      sql`typeof(${t.importedProcessed}) = 'integer' AND ${t.importedProcessed} BETWEEN 0 AND 9007199254740991 AND typeof(${t.importFailed}) = 'integer' AND ${t.importFailed} BETWEEN 0 AND ${t.importedProcessed} AND (${t.importedTotal} IS NULL OR (typeof(${t.importedTotal}) = 'integer' AND ${t.importedTotal} BETWEEN ${t.importedProcessed} AND 9007199254740991))`,
    ),
    check(
      'playlist_import_statuses_enrichment_counts',
      sql`typeof(${t.enrichmentProcessed}) = 'integer' AND ${t.enrichmentProcessed} BETWEEN 0 AND 9007199254740991 AND typeof(${t.enrichmentFailed}) = 'integer' AND ${t.enrichmentFailed} BETWEEN 0 AND ${t.enrichmentProcessed} AND (${t.enrichmentTotal} IS NULL OR (typeof(${t.enrichmentTotal}) = 'integer' AND ${t.enrichmentTotal} BETWEEN ${t.enrichmentProcessed} AND 9007199254740991))`,
    ),
    check(
      'playlist_import_statuses_failure',
      sql`${t.failureCode} IS NULL OR ${t.failureCode} IN ('provider_unavailable','source_changed','authority_denied','target_changed','status_unavailable','interrupted')`,
    ),
    check(
      'playlist_import_statuses_revision',
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'playlist_import_statuses_last_attempt',
      sql`${t.lastAttemptId} IS NULL OR length(${t.lastAttemptId}) = 36`,
    ),
    check(
      'playlist_import_statuses_times',
      sql`typeof(${t.createdAt}) = 'integer' AND ${t.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${t.updatedAt}) = 'integer' AND ${t.updatedAt} BETWEEN ${t.createdAt} AND 9007199254740991 AND (${t.terminalAt} IS NULL OR (typeof(${t.terminalAt}) = 'integer' AND ${t.terminalAt} BETWEEN ${t.createdAt} AND 9007199254740991))`,
    ),
    check(
      'playlist_import_statuses_dispatch_attempts',
      sql`typeof(${t.dispatchAttempts}) = 'integer' AND ${t.dispatchAttempts} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'playlist_import_statuses_dispatch_times',
      sql`(${t.nextDispatchAt} IS NULL OR (typeof(${t.nextDispatchAt}) = 'integer' AND ${t.nextDispatchAt} BETWEEN 0 AND 9007199254740991)) AND (${t.dispatchedAt} IS NULL OR (typeof(${t.dispatchedAt}) = 'integer' AND ${t.dispatchedAt} BETWEEN 0 AND 9007199254740991))`,
    ),
    check(
      'playlist_import_statuses_lease_values',
      sql`(${t.attemptId} IS NULL OR length(${t.attemptId}) = 36) AND typeof(${t.generation}) = 'integer' AND ${t.generation} BETWEEN 0 AND 9007199254740991 AND (${t.leaseUntil} IS NULL OR (typeof(${t.leaseUntil}) = 'integer' AND ${t.leaseUntil} BETWEEN 0 AND 9007199254740991))`,
    ),
    check(
      'playlist_import_statuses_target',
      sql`(${t.playlistId} IS NULL AND ${t.playlistRevision} IS NULL) OR (${t.playlistId} IS NOT NULL AND ${t.playlistRevision} IS NOT NULL AND typeof(${t.playlistRevision}) = 'integer' AND ${t.playlistRevision} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      'playlist_import_statuses_target_required',
      sql`${t.phase} NOT IN ('enrichment_pending','enriching') OR ${t.playlistId} IS NOT NULL`,
    ),
    check(
      'playlist_import_statuses_cursor_values',
      sql`(${t.cursorPosition} IS NULL OR (typeof(${t.cursorPosition}) = 'integer' AND ${t.cursorPosition} BETWEEN 0 AND 9007199254740991)) AND (${t.cursorTrackId} IS NULL OR length(${t.cursorTrackId}) = 36)`,
    ),
    check(
      'playlist_import_statuses_cursor',
      sql`(${t.cursorPosition} IS NULL AND ${t.cursorTrackId} IS NULL) OR (${t.phase} = 'enriching' AND ${t.cursorPosition} IS NOT NULL AND ${t.cursorTrackId} IS NOT NULL)`,
    ),
    check(
      'playlist_import_statuses_terminal',
      sql`(${t.phase} IN ('completed','partial','failed','interrupted','retired')) = (${t.terminalAt} IS NOT NULL)`,
    ),
    check(
      'playlist_import_statuses_completed',
      sql`${t.phase} <> 'completed' OR (${t.importedTotal} IS NOT NULL AND ${t.importedProcessed} = ${t.importedTotal} AND ${t.importFailed} = 0 AND ${t.enrichmentTotal} IS NOT NULL AND ${t.enrichmentProcessed} = ${t.enrichmentTotal} AND ${t.enrichmentFailed} = 0)`,
    ),
    check(
      'playlist_import_statuses_partial',
      sql`${t.phase} <> 'partial' OR (${t.importedTotal} IS NOT NULL AND ${t.importedProcessed} = ${t.importedTotal} AND ${t.importFailed} = 0 AND ${t.enrichmentTotal} IS NOT NULL AND ${t.enrichmentFailed} > 0)`,
    ),
    check(
      'playlist_import_statuses_lease',
      sql`(${t.phase} IN ('importing','enriching') AND ${t.attemptId} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL AND ${t.generation} >= 1) OR (${t.phase} NOT IN ('importing','enriching') AND ${t.attemptId} IS NULL AND ${t.leaseUntil} IS NULL)`,
    ),
    check(
      'playlist_import_statuses_import_generation',
      sql`${t.phase} <> 'importing' OR ${t.generation} = 1`,
    ),
    check(
      'playlist_import_statuses_dispatch_values',
      sql`(${t.dispatchState} = 'none' AND ${t.nextDispatchAt} IS NULL AND ${t.dispatchedAt} IS NULL) OR (${t.dispatchState} = 'pending' AND ${t.phase} = 'enrichment_pending' AND ${t.nextDispatchAt} IS NOT NULL AND ${t.dispatchedAt} IS NULL) OR (${t.dispatchState} = 'sent' AND ${t.phase} IN ('enrichment_pending','enriching') AND ${t.nextDispatchAt} IS NULL AND ${t.dispatchedAt} IS NOT NULL)`,
    ),
    check(
      'playlist_import_statuses_dispatch_phase',
      sql`(${t.phase} = 'enrichment_pending' AND ${t.dispatchState} IN ('pending','sent')) OR (${t.phase} = 'enriching' AND ${t.dispatchState} = 'sent') OR (${t.phase} NOT IN ('enrichment_pending','enriching') AND ${t.dispatchState} = 'none')`,
    ),
    index('playlist_import_statuses_actor_idx').on(t.actorId, t.createdAt, t.operationId),
    index('playlist_import_statuses_dispatch_idx').on(
      t.dispatchState,
      t.nextDispatchAt,
      t.operationId,
    ),
  ],
)
