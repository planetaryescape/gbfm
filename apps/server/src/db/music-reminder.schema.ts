import { REMINDER_STATUS, REMINDER_STATUSES } from '@gbfm/core/status'
import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

export const reminderStatusEnum = [...REMINDER_STATUSES] as const

export const musicReminder = sqliteTable(
  'music_reminder',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    musicTitle: text('music_title').notNull(),
    artistName: text('artist_name').notNull(),
    musicUrl: text('music_url').notNull(),
    albumCoverUrl: text('album_cover_url'),
    reminderDate: integer('reminder_date', { mode: 'timestamp_ms' }).notNull(),
    notes: text('notes'),
    status: text('status', { enum: reminderStatusEnum }).default(REMINDER_STATUS.PENDING).notNull(),
    isSent: integer('is_sent', { mode: 'boolean' }).default(false).notNull(),
    commandRevision: integer('command_revision').notNull().default(1),
    dispatchState: text('dispatch_state', { enum: ['open', 'fenced', 'accepted', 'cancelled'] })
      .notNull()
      .default('open'),
    lastOperationId: text('last_operation_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('music_reminder_user_id_idx').on(table.userId),
    index('music_reminder_reminder_date_idx').on(table.reminderDate),
    index('music_reminder_is_sent_idx').on(table.isSent),
    index('music_reminder_status_idx').on(table.status),
    check(
      'music_reminder_revision_check',
      sql`typeof(${table.commandRevision}) = 'integer' AND ${table.commandRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      'music_reminder_dispatch_check',
      sql`${table.dispatchState} IN ('open', 'fenced', 'accepted', 'cancelled')`,
    ),
    check(
      'music_reminder_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
  ],
)

export const musicReminderRelations = relations(musicReminder, ({ one }) => ({
  user: one(user, {
    fields: [musicReminder.userId],
    references: [user.id],
  }),
}))

export type MusicReminder = InferSelectModel<typeof musicReminder>

export type NewMusicReminder = InferInsertModel<typeof musicReminder>
