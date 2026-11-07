import { Context, Effect, Layer, Schema } from 'effect'

import { McpAuthorization, McpAuthorizationLive } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'
import { MusicReminderService } from '@/services/music-reminder.service'

import {
  ListMusicRemindersInput,
  ListMusicRemindersResult,
  MusicReminderSummary,
} from './contracts'

const PersistedSummary = Schema.Struct({
  ...MusicReminderSummary.fields,
  reminderDate: Schema.Date,
})

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Music reminders are unavailable.' })

/** Rechecks live account and read permission on every owner-bounded query. */
export class ReminderReadService extends Context.Service<
  ReminderReadService,
  {
    readonly list: (
      input: typeof ListMusicRemindersInput.Type,
    ) => Effect.Effect<typeof ListMusicRemindersResult.Type, McpToolError>
  }
>()('gbfm/mcp/ReminderReadService') {}

/** Requires the existing reminder service and live database-backed authorization. */
export const ReminderReadServiceLayer = Layer.effect(
  ReminderReadService,
  Effect.gen(function* () {
    const authorization = yield* McpAuthorization
    const reminders = yield* MusicReminderService

    const list = Effect.fn('ReminderReadService.list')(function* (
      raw: typeof ListMusicRemindersInput.Type,
    ) {
      const actor = yield* authorization
        .listener(['reminders:read'])
        .pipe(
          Effect.mapError(
            (error) => new McpToolError({ code: error.code, message: error.message }),
          ),
        )

      const input = yield* Schema.decodeUnknownEffect(ListMusicRemindersInput)(raw).pipe(
        Effect.mapError(
          () =>
            new McpToolError({ code: 'invalid_input', message: 'Invalid reminder pagination.' }),
        ),
      )

      const limit = input.limit ?? 20
      const offset = input.offset ?? 0

      const page = yield* reminders.getPageByUserId(actor.userId, { limit, offset }).pipe(
        Effect.tapError(() =>
          Effect.logError('mcp.reminders.unavailable', {
            operation: 'reminders.page',
            table: 'music_reminder',
            dependency: 'database',
            code: 'database_error',
          }),
        ),
        Effect.mapError(unavailable),
      )

      const persisted = yield* Schema.decodeUnknownEffect(Schema.Array(PersistedSummary))(
        page.reminders,
      ).pipe(Effect.mapError(unavailable))

      const result = yield* Schema.decodeUnknownEffect(ListMusicRemindersResult)({
        reminders: persisted.map((reminder) => ({
          ...reminder,
          reminderDate: reminder.reminderDate.toISOString(),
        })),
        pagination: { limit, offset, hasMore: page.hasMore },
      }).pipe(Effect.mapError(unavailable))

      // MCP repeats this JSON as structured content and escaped text. A 64 KiB
      // result budget leaves room for both copies and framing under P1's final
      // 256 KiB transport cap, rather than letting ordinary pages hit outer 413.
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024)
        return yield* new McpToolError({
          code: 'unavailable',
          message: 'Reminder page exceeds the result-payload limit. Request a smaller page.',
        })

      return result
    })

    return ReminderReadService.of({ list })
  }),
).pipe(Layer.provide(McpAuthorizationLive))
