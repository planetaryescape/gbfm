import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'

import { ListMusicRemindersInput, ListMusicRemindersResult } from './contracts'
import { ReminderReadService } from './reads'

/** Only the safe read is exposed. Scheduling awaits durable command guards. */
export const ReminderToolkit = Toolkit.make(
  Tool.make('list_music_reminders', {
    description:
      'List only your music reminder summaries, including pending, processing, failed and sent reminders. Requires reminders:read independently of reminders:write. Dates are UTC; default 20, maximum 50, ordered by reminder date then ID. Offset pagination is not a snapshot while schedules change. Does not schedule or send notifications.',
    parameters: ListMusicRemindersInput,
    success: ListMusicRemindersResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['reminders:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** P1 composes this layer and toolkit; production registration is not changed here. */
export const ReminderToolHandlersLayer = ReminderToolkit.toLayer(
  Effect.gen(function* () {
    const reminders = yield* ReminderReadService

    return { list_music_reminders: reminders.list }
  }),
)
