import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from 'effect/http-api'

import { AuthMiddleware } from './middleware/auth'

const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Uuid = Schema.String.pipe(Schema.check(Schema.isPattern(UuidPattern)))

const UrlPattern = /^https?:\/\/.+/i

const UrlString = Schema.String.pipe(Schema.check(Schema.isPattern(UrlPattern)))

// Matches zod's z.string().datetime() default (no offset, no local): UTC
// only, 'Z' suffix required, calendar-valid date. Derived from
// zod/src/v4/core/regexes.ts's dateSource/timeSource/datetime() with
// offset=false, local=false, precision=null (fractional seconds optional,
// any length).
const IsoDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/

const IsoDateTimeString = Schema.String.pipe(Schema.check(Schema.isPattern(IsoDateTimePattern)))

const MusicReminderStatus = Schema.Literals(['pending', 'processing', 'sent', 'failed'])

const CommandRevision = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
)

const RequestId = Schema.String.check(Schema.isUUID(4))

export class ReminderPreconditionRequired extends Schema.TaggedError<ReminderPreconditionRequired>()(
  'ReminderPreconditionRequired',
  {
    message: Schema.String,
  },
  { httpApiStatus: 428 },
) {}

export class ReminderCommandConflict extends Schema.TaggedError<ReminderCommandConflict>()(
  'ReminderCommandConflict',
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

const CommandReceipt = Schema.Struct({
  reminderId: Uuid,
  commandRevision: CommandRevision,
  dispatchState: Schema.Literals(['open', 'cancelled']),
  reminderDate: Schema.String,
})

export const MusicReminderResponse = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  musicTitle: Schema.String,
  artistName: Schema.String,
  musicUrl: Schema.String,
  albumCoverUrl: Schema.NullOr(Schema.String),
  reminderDate: Schema.String,
  notes: Schema.NullOr(Schema.String),
  status: MusicReminderStatus,
  isSent: Schema.Boolean,
  commandRevision: CommandRevision,
  dispatchState: Schema.Literals(['open', 'fenced', 'accepted', 'cancelled']),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export const CreateMusicReminderInput = Schema.Struct({
  requestId: RequestId,
  musicTitle: Schema.NonEmptyString,
  artistName: Schema.NonEmptyString,
  musicUrl: UrlString,
  albumCoverUrl: Schema.optional(UrlString),
  reminderDate: IsoDateTimeString,
  notes: Schema.optional(Schema.String),
})

export type CreateMusicReminderInput = typeof CreateMusicReminderInput.Type

export const CreateMusicReminderResponse = Schema.Struct({
  success: Schema.Boolean,
  reminder: CommandReceipt,
  message: Schema.String,
})

export const GetMusicRemindersResponse = Schema.Struct({
  success: Schema.Boolean,
  reminders: Schema.Array(MusicReminderResponse),
  total: Schema.Number,
})

export const UpdateMusicReminderInput = Schema.Struct({
  requestId: RequestId,
  expectedRevision: Schema.optional(CommandRevision),
  musicTitle: Schema.optional(Schema.NonEmptyString),
  artistName: Schema.optional(Schema.NonEmptyString),
  musicUrl: Schema.optional(UrlString),
  albumCoverUrl: Schema.optional(Schema.NullOr(UrlString)),
  reminderDate: Schema.optional(IsoDateTimeString),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
})

export type UpdateMusicReminderInput = typeof UpdateMusicReminderInput.Type

export const UpdateMusicReminderResponse = Schema.Struct({
  success: Schema.Boolean,
  reminder: CommandReceipt,
  message: Schema.String,
})

export const DeleteMusicReminderResponse = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  reminder: CommandReceipt,
})

export const DeleteMusicReminderInput = Schema.Struct({
  requestId: RequestId,
  expectedRevision: Schema.optional(CommandRevision),
})

const CommandErrors = [
  HttpApiError.BadRequest,
  HttpApiError.NotFound,
  HttpApiError.Forbidden,
  ReminderCommandConflict,
  HttpApiError.ServiceUnavailable,
  ReminderPreconditionRequired,
]

export const MusicRemindersGroup = /* @__PURE__ */ (() =>
  HttpApiGroup.make('music-reminders')
    .add(
      HttpApiEndpoint.post('createMusicReminder', '/api/music-reminders', {
        payload: CreateMusicReminderInput,
        success: CreateMusicReminderResponse,
        error: CommandErrors,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getMusicReminders', '/api/music-reminders', {
        success: GetMusicRemindersResponse,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.put('updateMusicReminder', '/api/music-reminders/:id', {
        params: { id: Uuid },
        payload: UpdateMusicReminderInput,
        success: UpdateMusicReminderResponse,
        error: CommandErrors,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteMusicReminder', '/api/music-reminders/:id', {
        params: { id: Uuid },
        payload: DeleteMusicReminderInput,
        success: DeleteMusicReminderResponse,
        error: CommandErrors,
      }).middleware(AuthMiddleware),
    ))()
