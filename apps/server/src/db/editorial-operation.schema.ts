import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

export const editorialOperations = sqliteTable(
  'editorial_operations',
  {
    id: text().primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    postId: text('post_id').notNull(),
    inputHash: text('input_hash').notNull(),
    result: text(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('editorial_operations_actor_idx').on(table.actorId),
    index('editorial_operations_expiry_idx')
      .on(table.createdAt)
      .where(sql`${table.result} IS NOT NULL`),
  ],
)
