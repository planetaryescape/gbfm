import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

export const editorialOperations = sqliteTable('editorial_operations', {
  id: text().primaryKey(),
  actorId: text('actor_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  postId: text('post_id').notNull(),
  inputHash: text('input_hash').notNull(),
  result: text().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})
