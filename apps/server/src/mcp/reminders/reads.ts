import { Context, Effect, Layer, Schema } from 'effect'

import { McpAuthorization, McpAuthorizationLive } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'
import { MusicReminderService } from '@/services/music-reminder.service'

import { ListMusicRemindersInput, ListMusicRemindersResult } from './contracts'

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

      const page = yield* reminders
        .getPageByUserId(actor.userId, { limit, offset })
        .pipe(Effect.mapError(unavailable))

      const result = yield* Schema.decodeUnknownEffect(ListMusicRemindersResult)({
        reminders: page.reminders.map((reminder) => ({
          ...reminder,
          reminderDate: reminder.reminderDate.toISOString(),
        })),
        pagination: { limit, offset, hasMore: page.hasMore },
      }).pipe(Effect.mapError(unavailable))

      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
        return yield* new McpToolError({
          code: 'unavailable',
          message: 'Reminder page exceeds the response limit. Request a smaller page.',
        })

      return result
    })

    return ReminderReadService.of({ list })
  }),
).pipe(Layer.provide(McpAuthorizationLive))
