import { eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { Database } from '@/db/layer'
import { type MusicReminder, musicReminder } from '@/db/music-reminder.schema'
import { DatabaseError, getErrorMessage } from '@/errors'

export interface MusicReminderService {
  readonly getByUserId: (userId: string) => Effect.Effect<Array<MusicReminder>, DatabaseError>
  /** Owner predicate precedes bounded pagination; no notes, recipient or delivery data. */
  readonly getPageByUserId: (
    userId: string,
    page: { readonly limit: number; readonly offset: number },
  ) => Effect.Effect<
    {
      readonly reminders: ReadonlyArray<
        Pick<
          MusicReminder,
          | 'id'
          | 'musicTitle'
          | 'artistName'
          | 'reminderDate'
          | 'status'
          | 'isSent'
          | 'commandRevision'
          | 'dispatchState'
        >
      >
      readonly hasMore: boolean
    },
    DatabaseError
  >
}

export const MusicReminderService = Context.Service<MusicReminderService>('MusicReminderService')

const getByUserIdEffect = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const reminders = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(musicReminder)
          .where(eq(musicReminder.userId, userId))
          .orderBy(musicReminder.reminderDate),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch music reminders: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_reminder',
        }),
    })

    yield* Effect.logInfo('[MusicReminder] Reminders retrieved', {
      count: reminders.length,
    })

    return reminders
  })

const getPageByUserIdEffect = (
  userId: string,
  page: { readonly limit: number; readonly offset: number },
) =>
  Effect.gen(function* () {
    const db = yield* Database

    // The service is also callable outside MCP. Never let an invalid page become
    // SQLite's unbounded LIMIT -1, even if a caller bypasses its input schema.
    if (
      !Number.isInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > 50 ||
      !Number.isInteger(page.offset) ||
      page.offset < 0 ||
      page.offset > 10_000
    )
      return yield* new DatabaseError({
        message: 'Invalid reminder page',
        operation: 'select',
        table: 'music_reminder',
      })

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: musicReminder.id,
            musicTitle: musicReminder.musicTitle,
            artistName: musicReminder.artistName,
            reminderDate: musicReminder.reminderDate,
            status: musicReminder.status,
            isSent: musicReminder.isSent,
            commandRevision: musicReminder.commandRevision,
            dispatchState: musicReminder.dispatchState,
          })
          .from(musicReminder)
          .where(eq(musicReminder.userId, userId))
          .orderBy(musicReminder.reminderDate, musicReminder.id)
          .limit(page.limit + 1)
          .offset(page.offset),
      catch: () =>
        new DatabaseError({
          message: 'Failed to fetch reminder page',
          operation: 'select',
          table: 'music_reminder',
        }),
    })

    return { reminders: rows.slice(0, page.limit), hasMore: rows.length > page.limit }
  })

export const MusicReminderServiceLayer = Layer.effect(
  MusicReminderService,
  Effect.gen(function* () {
    const db = yield* Database
    const provideDb = Effect.provideService(Database, db)

    return {
      getByUserId: (userId) => provideDb(getByUserIdEffect(userId)),
      getPageByUserId: (userId, page) => provideDb(getPageByUserIdEffect(userId, page)),
    }
  }),
)
