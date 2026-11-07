import { REMINDER_STATUSES } from '@gbfm/core/status'
import { Schema } from 'effect'

/** Owner-only summary query; no caller-selected owner or recipient. */
export const ListMusicRemindersInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

/** Deliberately excludes recipient details, notes, URLs and delivery internals. */
export const MusicReminderSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  musicTitle: Schema.String,
  artistName: Schema.String,
  reminderDate: Schema.String,
  status: Schema.Literals(REMINDER_STATUSES),
  isSent: Schema.Boolean,
})

/** Bounded page, ordered by UTC reminder time then stable ID. */
export const ListMusicRemindersResult = Schema.Struct({
  reminders: Schema.Array(MusicReminderSummary),
  pagination: Schema.Struct({
    limit: Schema.Int,
    offset: Schema.Int,
    hasMore: Schema.Boolean,
  }),
})
