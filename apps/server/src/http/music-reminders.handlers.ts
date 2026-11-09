import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { ReminderCommandConflict, ReminderPreconditionRequired } from '@gbfm/api/music-reminders'
import { Effect, type Schema } from 'effect'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { dieOnDatabaseError as makeDieOnDatabaseError } from '@/http/handler-utils'
import { omitUndefined } from '@/lib/omit-undefined'
import { CommandAuthority, makeSessionCommandAuthority } from '@/mcp/command-authority'
import { ReminderCommandService } from '@/mcp/reminders/service'
import { MusicReminderService } from '@/services/music-reminder.service'
import { ReminderSignalService } from '@/services/reminder-signal.service'

const dieOnDatabaseError = makeDieOnDatabaseError('music-reminders')

const executeCommand = Effect.fn('MusicRemindersHandlers.executeCommand')(
  function* (command: Schema.Json) {
    const authority = yield* makeSessionCommandAuthority
    const service = yield* ReminderCommandService

    return yield* service.execute(command).pipe(Effect.provideService(CommandAuthority, authority))
  },
  Effect.catchTag(
    'McpToolError',
    Effect.fn(function* (error) {
      switch (error.code) {
        case 'precondition_required':
          return yield* new ReminderPreconditionRequired({ message: error.message })
        case 'not_found':
          return yield* new HttpApiError.NotFound()
        case 'access_denied':
          return yield* new HttpApiError.Forbidden()
        case 'conflict':
        case 'expired':
          return yield* new ReminderCommandConflict({ message: error.message })
        case 'unavailable':
          return yield* new HttpApiError.ServiceUnavailable()
        default:
          return yield* new HttpApiError.BadRequest()
      }
    }),
  ),
)

const toReminderResponse = (reminder: {
  id: string
  userId: string
  musicTitle: string
  artistName: string
  musicUrl: string
  albumCoverUrl: string | null
  reminderDate: Date
  notes: string | null
  status: 'pending' | 'processing' | 'sent' | 'failed'
  isSent: boolean
  commandRevision: number
  dispatchState: 'open' | 'fenced' | 'accepted' | 'cancelled'
  createdAt: Date
  updatedAt: Date
}) => ({
  ...reminder,
  reminderDate: reminder.reminderDate.toISOString(),
  createdAt: reminder.createdAt.toISOString(),
  updatedAt: reminder.updatedAt.toISOString(),
})

export const MusicRemindersHandlersLive = HttpApiBuilder.group(Api, 'music-reminders', (handlers) =>
  handlers
    .handle('createMusicReminder', ({ payload }) =>
      Effect.gen(function* () {
        const reminder = yield* executeCommand({
          operation: 'create_music_reminder',
          input: omitUndefined(payload),
        })

        const signal = yield* ReminderSignalService
        yield* signal.signal

        return {
          success: true,
          reminder,
          message: 'Music reminder created successfully',
        }
      }),
    )
    .handle('getMusicReminders', () =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* MusicReminderService

        const reminders = yield* dieOnDatabaseError(svc.getByUserId(user.id))

        return {
          success: true,
          reminders: reminders.map(toReminderResponse),
          total: reminders.length,
        }
      }),
    )
    .handle('updateMusicReminder', ({ params, payload }) =>
      Effect.gen(function* () {
        const reminder = yield* executeCommand({
          operation: 'update_music_reminder',
          input: omitUndefined({ ...payload, reminderId: params.id }),
        })

        const signal = yield* ReminderSignalService
        yield* signal.signal

        return {
          success: true,
          reminder,
          message: 'Music reminder updated successfully',
        }
      }),
    )
    .handle('deleteMusicReminder', ({ params, payload }) =>
      Effect.gen(function* () {
        const reminder = yield* executeCommand({
          operation: 'cancel_music_reminder',
          input: omitUndefined({ ...payload, reminderId: params.id }),
        })

        return {
          success: true,
          reminder,
          message: 'Music reminder cancelled; pending delivery suppressed',
        }
      }),
    ),
)
