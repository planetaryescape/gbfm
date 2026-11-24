import { Effect, Option, type Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '@/mcp/authorization'
import { CommandAuthority } from '@/mcp/command-authority'
import { McpToolError } from '@/mcp/contracts'

import {
  CancelReminderCommandInput,
  CreateReminderCommandInput,
  ReminderCommandResult,
  RescheduleReminderCommandInput,
} from './contracts'
import { ReminderCommandService } from './service'

export const ReminderCommandToolkit = Toolkit.make(
  Tool.make('create_music_reminder', {
    description:
      'Schedule a private music reminder email to yourself. Requires reminders:write, an explicit calendar-valid UTC reminderDate ending in Z, music title, artist, listening URL and UUIDv4 requestId. Never guess the desired time or timezone. Recipient and owner come only from your authenticated account. Save requestId before calling; identical retries within 24 hours return the original receipt without creating another reminder, changed input conflicts, and expired keys never execute again. Success means durably scheduled, not delivered. Uses the existing scheduler; email delivery is at-least-once.',
    parameters: CreateReminderCommandInput,
    success: ReminderCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['reminders:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Strict, true),
  Tool.make('reschedule_music_reminder', {
    description:
      'Move your unsent music reminder to an explicit UTC reminderDate ending in Z. Requires reminders:write, UUIDv4 requestId, reminderId and the commandRevision observed when reading the reminder as expectedRevision. Missing revision requires a read; stale revision conflicts. Never silently refresh a revision and retry old intent. Identical retries within 24 hours replay the original receipt; changed input conflicts and expired keys never execute again. Once delivery may have started, returns conflict rather than promising recall.',
    parameters: RescheduleReminderCommandInput,
    success: ReminderCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['reminders:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Strict, true),
  Tool.make('cancel_music_reminder', {
    description:
      'Cancel your music reminder only before delivery may have started. Requires reminders:write, UUIDv4 requestId, reminderId and the commandRevision observed when reading the reminder as expectedRevision. Missing revision requires a read; stale revision conflicts. Cancellation retains a private tombstone. Identical retries within 24 hours replay the original receipt; changed input conflicts and expired keys never execute again. A delivery_may_have_started conflict means email cannot be recalled, not successful cancellation.',
    parameters: CancelReminderCommandInput,
    success: ReminderCommandResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['reminders:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Strict, true),
)

export const ReminderCommandToolHandlersLayer = ReminderCommandToolkit.toLayer(
  Effect.gen(function* () {
    const commands = yield* ReminderCommandService

    const execute = Effect.fn('ReminderMcp.execute')(function* (command: Schema.Json) {
      const authority = yield* Effect.serviceOption(CommandAuthority)

      if (Option.isNone(authority))
        return yield* new McpToolError({
          code: 'access_denied',
          message: 'Command authority required.',
        })

      return yield* commands
        .execute(command)
        .pipe(Effect.provideService(CommandAuthority, authority.value))
    })

    return {
      create_music_reminder: (input) => execute({ operation: 'create_music_reminder', input }),
      reschedule_music_reminder: (input) =>
        execute({ operation: 'reschedule_music_reminder', input }),
      cancel_music_reminder: (input) => execute({ operation: 'cancel_music_reminder', input }),
    }
  }),
)
