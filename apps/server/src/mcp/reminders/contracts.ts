import { REMINDER_STATUSES } from '@gbfm/core/status'
import { Schema } from 'effect'

/** Independent of the processor's updatedAt claim generation. */
export const ReminderCommandRevision = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
)

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
  commandRevision: ReminderCommandRevision,
  dispatchState: Schema.Literals(['open', 'fenced', 'accepted', 'cancelled']),
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

const ReminderRequestId = Schema.String.check(Schema.isUUID(4))

const ReminderId = Schema.String.check(Schema.isUUID(4))

const ReminderText = Schema.NonEmptyString.check(
  Schema.isMaxLength(500),
  Schema.makeFilter((value) => value.trim().length > 0),
)

const ReminderHttpUrl = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter((value) => {
    const url = URL.parse(value)

    return url !== null &&
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? undefined
      : 'Expected an HTTP URL without credentials'
  }),
)

/** Explicit calendar-valid UTC; at most millisecond precision, no silent truncation. */
export const ReminderUtcInstant = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
      return 'Expected a millisecond-precision UTC instant ending in Z'
    const date = new Date(value)

    if (Number.isNaN(date.getTime())) return 'Invalid UTC instant'

    const normalized = value.includes('.')
      ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, '0')}Z`)
      : value.replace(/Z$/, '.000Z')

    return date.toISOString() === normalized ? undefined : 'Invalid calendar date'
  }),
)

/** Only actor-derived ownership/recipient is permitted; decode with excess-property rejection. */
export const CreateReminderCommandInput = Schema.Struct({
  requestId: ReminderRequestId,
  musicTitle: ReminderText,
  artistName: ReminderText,
  musicUrl: ReminderHttpUrl,
  albumCoverUrl: Schema.optionalKey(Schema.NullOr(ReminderHttpUrl)),
  reminderDate: ReminderUtcInstant,
  notes: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))),
})

export const RescheduleReminderCommandInput = Schema.Struct({
  requestId: ReminderRequestId,
  reminderId: ReminderId,
  expectedRevision: ReminderCommandRevision,
  reminderDate: ReminderUtcInstant,
})

export const CancelReminderCommandInput = Schema.Struct({
  requestId: ReminderRequestId,
  reminderId: ReminderId,
  expectedRevision: ReminderCommandRevision,
})

/** Saved original command outcome, not a claim about provider acceptance. */
export const ReminderCommandResult = Schema.Struct({
  reminderId: ReminderId,
  commandRevision: ReminderCommandRevision,
  dispatchState: Schema.Literals(['open', 'cancelled']),
  reminderDate: ReminderUtcInstant,
})
