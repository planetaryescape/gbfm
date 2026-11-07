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
