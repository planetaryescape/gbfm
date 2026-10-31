import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

export const personalAccessKeys = sqliteTable(
  'personal_access_keys',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    issuanceRequestId: text('issuance_request_id').notNull(),
    name: text('name').notNull(),
    environment: text('environment').notNull(),
    scopes: text('scopes').notNull(),
    secretHash: text('secret_hash').notNull(),
    displayPrefix: text('display_prefix').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    rateWindowStart: integer('rate_window_start'),
    rateRequestCount: integer('rate_request_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('personal_access_keys_hash_uq').on(table.secretHash),
    uniqueIndex('personal_access_keys_issuance_uq').on(
      table.ownerUserId,
      table.environment,
      table.issuanceRequestId,
    ),
    index('personal_access_keys_owner_idx').on(
      table.ownerUserId,
      table.environment,
      table.createdAt,
    ),
  ],
)
