import type { McpScope } from '@gbfm/core/editorial-mcp'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { McpToolError } from '@/mcp/contracts'
import { McpOperationStore } from '@/mcp/operations/store'

import { prepareReminderCommand } from './commands'
import { ReminderCommandResult } from './contracts'

/** Trusted request composition supplies this closure, never caller-selected identity or SQL. */
export interface ReminderAuthority {
  readonly checkpoint: (requiredScopes: ReadonlyArray<McpScope>) => Effect.Effect<
    {
      readonly actorId: string
      readonly clientId: string
      readonly resource: string
      readonly liveGuard: SQL
    },
    McpToolError
  >
}

const unavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Reminder command unavailable. Retry only with the identical requestId and input.',
  })

const notFound = () => new McpToolError({ code: 'not_found', message: 'Music reminder not found.' })

const makeCommands = Effect.gen(function* () {
  const db = yield* Database
  const operations = yield* McpOperationStore

  const execute = Effect.fn('ReminderCommandService.execute')(function* (
    raw: Schema.Json,
    authority: ReminderAuthority,
  ) {
    const services = yield* Effect.context()
    const runPromise = Effect.runPromiseWith(services)
    const initial = yield* authority.checkpoint(['reminders:write'])
    const command = yield* prepareReminderCommand(raw)
    const now = yield* Clock.currentTimeMillis

    const diagnose = (
      code: 'database_error' | 'invalid_persisted_row' | 'operation_unavailable',
      dependency: 'database' | 'operation-store',
    ) =>
      Effect.logError('mcp.reminders.command.unavailable', {
        operation: command.operation,
        table: 'music_reminder',
        dependency,
        code,
      })

    const findOwned = (id: string) =>
      Effect.tryPromise({
        try: () =>
          db
            .select({
              id: musicReminder.id,
              reminderDate: musicReminder.reminderDate,
              dispatchState: musicReminder.dispatchState,
            })
            .from(musicReminder)
            .where(and(eq(musicReminder.id, id), eq(musicReminder.userId, initial.actorId)))
            .limit(1),
        catch: unavailable,
      }).pipe(
        Effect.tapError(() => diagnose('database_error', 'database')),
        Effect.map((rows) => rows[0]),
      )

    const previous =
      command.operation === 'create_music_reminder'
        ? undefined
        : yield* findOwned(command.payload.reminderId)

    if (command.operation !== 'create_music_reminder' && !previous) return yield* notFound()

    // A replay after a successful later mutation must still disclose the original
    // receipt. Do not reject mutability here; the atomic CAS owns that decision.
    const reminderId =
      command.operation === 'create_music_reminder'
        ? crypto.randomUUID()
        : command.payload.reminderId

    const expected =
      command.operation === 'create_music_reminder' ? 0 : command.payload.expectedRevision

    if (expected === Number.MAX_SAFE_INTEGER)
      return yield* new McpToolError({ code: 'conflict', message: 'Reminder revision exhausted.' })

    const date =
      command.operation === 'cancel_music_reminder'
        ? previous?.reminderDate
        : new Date(command.payload.reminderDate)

    const validDate = yield* Schema.decodeUnknownEffect(Schema.Date)(date).pipe(
      Effect.tapError(() => diagnose('invalid_persisted_row', 'database')),
      Effect.mapError(unavailable),
    )

    const result = yield* Schema.decodeUnknownEffect(ReminderCommandResult)({
      reminderId,
      commandRevision: expected + 1,
      dispatchState: command.operation === 'cancel_music_reminder' ? 'cancelled' : 'open',
      reminderDate: validDate.toISOString(),
    }).pipe(
      Effect.tapError(() => diagnose('invalid_persisted_row', 'database')),
      Effect.mapError(unavailable),
    )

    const saved = yield* Effect.tryPromise({
      try: () =>
        operations.execute({
          key: {
            actorId: initial.actorId,
            clientId: initial.clientId,
            resource: initial.resource,
            operation: command.operation,
            requestId: command.requestId,
          },
          normalizedInput: command.payload,
          now,
          authorize: async (outcome) => {
            const current = await runPromise(
              authority.checkpoint(['reminders:write']).pipe(
                Effect.map(
                  (identity) =>
                    identity.actorId === initial.actorId &&
                    identity.clientId === initial.clientId &&
                    identity.resource === initial.resource,
                ),
                Effect.catchTag('McpToolError', (error) =>
                  error.code === 'access_denied' ? Effect.succeed(false) : Effect.fail(error),
                ),
              ),
            )

            if (!current) return false

            if (!outcome) return true

            const original = await runPromise(
              Schema.decodeUnknownEffect(ReminderCommandResult)(outcome.result).pipe(
                Effect.tapError(() => diagnose('invalid_persisted_row', 'operation-store')),
                Effect.mapError(unavailable),
              ),
            )

            return (await runPromise(findOwned(original.reminderId))) !== undefined
          },
          build: (context) => {
            const guard = sql`${context.fence} AND (${initial.liveGuard})`

            const statement =
              command.operation === 'create_music_reminder'
                ? context.prepare(sql`INSERT INTO music_reminder
              (id,user_id,music_title,artist_name,music_url,album_cover_url,notes,reminder_date,status,is_sent,command_revision,dispatch_state,last_operation_id,created_at,updated_at)
              SELECT ${reminderId},${initial.actorId},${command.payload.musicTitle},${command.payload.artistName},${command.payload.musicUrl},${command.payload.albumCoverUrl ?? null},${command.payload.notes ?? null},${validDate.getTime()},'pending',0,1,'open',${context.attemptId},${now},${now} WHERE ${guard}`)
                : context.prepare(sql`UPDATE music_reminder SET command_revision=command_revision+1,
                dispatch_state=${result.dispatchState}, last_operation_id=${context.attemptId},
                reminder_date=${validDate.getTime()}, status='pending', updated_at=max(updated_at+1,${now})
              WHERE id=${reminderId} AND user_id=${initial.actorId} AND command_revision=${expected}
                AND command_revision<9007199254740991 AND dispatch_state='open' AND is_sent=0
                AND status IN ('pending','processing','failed') AND ${guard}`)

            return {
              statements: [statement],
              assertApplied: sql`${guard} AND EXISTS (SELECT 1 FROM music_reminder WHERE id=${reminderId} AND user_id=${initial.actorId} AND last_operation_id=${context.attemptId} AND command_revision=${expected + 1})`,
              outcome: { result, revision: expected + 1, access: { reminderId } },
            }
          },
        }),
      catch: unavailable,
    }).pipe(Effect.tapError(() => diagnose('operation_unavailable', 'operation-store')))

    switch (saved.status) {
      case 'applied':
      case 'replayed':
        return yield* Schema.decodeUnknownEffect(ReminderCommandResult)(saved.outcome.result).pipe(
          Effect.tapError(() => diagnose('invalid_persisted_row', 'operation-store')),
          Effect.mapError(unavailable),
        )
      case 'conflict': {
        const current = yield* findOwned(reminderId)

        return yield* new McpToolError({
          code: 'conflict',
          message:
            current?.dispatchState === 'fenced' || current?.dispatchState === 'accepted'
              ? 'delivery_may_have_started: this reminder cannot be recalled.'
              : 'Reminder changed or requestId was reused with different input.',
        })
      }

      case 'unavailable':
        yield* diagnose('operation_unavailable', 'operation-store')

        return yield* unavailable()
      default:
        return yield* new McpToolError({
          code: saved.status,
          message: 'Reminder command denied or retry window expired.',
        })
    }
  })

  return { execute }
})

/** Separate from read service: commands require the common receipt backend. */
export class ReminderCommandService extends Context.Service<
  ReminderCommandService,
  Effect.Success<typeof makeCommands>
>()('gbfm/reminders/Commands') {}

export const ReminderCommandServiceLayer = Layer.effect(ReminderCommandService, makeCommands)
