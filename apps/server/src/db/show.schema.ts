import type { RichContentDocument } from '@gbfm/rich-content/schema'
import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'
import { defaultContentFields } from './util'

export const showsTable = sqliteTable(
  'shows',
  {
    ...defaultContentFields,
    revision: integer().notNull().default(0),
    lastOperationId: text('last_operation_id'),
  },
  (table) => [
    index('shows_slug_idx').on(table.slug),
    check(
      'shows_revision_check',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'shows_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
  ],
)

export type SelectShow = InferSelectModel<typeof showsTable> & { tags: Array<string> | null }

export type InsertShow = InferInsertModel<typeof showsTable> & { tags?: Array<string> }

export type SelectMdxCompiledShow = SelectShow & {
  compiledContent: string
  richContent: RichContentDocument
  hosts?: Array<{
    id: string
    name: string
    username: string | null
  }>
}

export const showCreators = sqliteTable(
  'show_creators',
  {
    showId: text()
      .notNull()
      .references(() => showsTable.id, { onDelete: 'cascade' }),
    creatorId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.showId, t.creatorId] }),
    index('show_creators_creatorId_idx').on(t.creatorId),
  ],
)

export const showSubscriptionsTable = sqliteTable(
  'show_subscriptions',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    showId: text()
      .notNull()
      .references(() => showsTable.id, { onDelete: 'cascade' }),
    createdAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('show_subscriptions_user_show_unique').on(table.userId, table.showId),
    index('show_subscriptions_user_idx').on(table.userId),
    index('show_subscriptions_show_idx').on(table.showId),
  ],
)

export type SelectShowSubscription = InferSelectModel<typeof showSubscriptionsTable>

export type InsertShowSubscription = InferInsertModel<typeof showSubscriptionsTable>

export const showsRelations = relations(showsTable, ({ many }) => ({
  showCreators: many(showCreators),
  subscriptions: many(showSubscriptionsTable),
}))

export const showCreatorsRelations = relations(showCreators, ({ one }) => ({
  show: one(showsTable, {
    fields: [showCreators.showId],
    references: [showsTable.id],
  }),
  creator: one(user, {
    fields: [showCreators.creatorId],
    references: [user.id],
  }),
}))

export const showSubscriptionsRelations = relations(showSubscriptionsTable, ({ one }) => ({
  user: one(user, {
    fields: [showSubscriptionsTable.userId],
    references: [user.id],
  }),
  show: one(showsTable, {
    fields: [showSubscriptionsTable.showId],
    references: [showsTable.id],
  }),
}))
