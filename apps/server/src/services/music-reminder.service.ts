import { REMINDER_STATUS } from '@gbfm/core/status'
import { eq, sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer } from 'effect'

import { Database } from '@/db/layer'
import {
  type MusicReminder,
  musicReminder,
  type NewMusicReminder,
} from '@/db/music-reminder.schema'
import { DatabaseError, getErrorMessage, NotFoundError, UnauthorizedError } from '@/errors'

export interface MusicReminderService {
  readonly create: (data: NewMusicReminder) => Effect.Effect<MusicReminder, DatabaseError>
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
          'id' | 'musicTitle' | 'artistName' | 'reminderDate' | 'status' | 'isSent'
        >
      >
      readonly hasMore: boolean
    },
    DatabaseError
  >
  readonly update: (
    id: string,
    userId: string,
    data: Partial<NewMusicReminder>,
  ) => Effect.Effect<MusicReminder, DatabaseError | NotFoundError | UnauthorizedError>
  readonly delete: (
    id: string,
    userId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError | UnauthorizedError>
}

export const MusicReminderService = Context.Service<MusicReminderService>('MusicReminderService')

const createEffect = (data: NewMusicReminder) =>
  Effect.withSpan('music-reminder.create')(
    Effect.gen(function* () {
      const db = yield* Database

      const records = yield* Effect.tryPromise({
        try: () => db.insert(musicReminder).values(data).returning(),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to create music reminder: ${getErrorMessage(error)}`,
            operation: 'insert',
            table: 'music_reminder',
          }),
      })

      const record = records[0]

      if (!record) {
        return yield* new DatabaseError({
          message: 'Failed to create music reminder',
          operation: 'insert',
          table: 'music_reminder',
        })
      }

      yield* Effect.logInfo('[MusicReminder] Reminder created', {
        reminderId: record.id,
        reminderDate: record.reminderDate.toISOString(),
      })

      return record
    }),
  )

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

const updateEffect = (id: string, userId: string, data: Partial<NewMusicReminder>) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(musicReminder).where(eq(musicReminder.id, id)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check reminder existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_reminder',
        }),
    })

    const existing = existingRecords[0]

    if (!existing) {
      return yield* new NotFoundError({
        message: 'Music reminder not found',
        resource: 'music_reminder',
        id,
      })
    }

    if (existing.userId !== userId) {
      return yield* new UnauthorizedError({
        message: 'Unauthorized',
        userId,
      })
    }

    const updateValues: Partial<typeof musicReminder.$inferInsert> = {}

    if (data.musicTitle !== undefined) updateValues.musicTitle = data.musicTitle

    if (data.artistName !== undefined) updateValues.artistName = data.artistName

    if (data.musicUrl !== undefined) updateValues.musicUrl = data.musicUrl

    if (data.albumCoverUrl !== undefined) updateValues.albumCoverUrl = data.albumCoverUrl

    if (data.reminderDate !== undefined) updateValues.reminderDate = data.reminderDate

    if (data.notes !== undefined) updateValues.notes = data.notes

    const now = yield* Clock.currentTimeMillis

    const scheduleChanged =
      data.reminderDate === undefined
        ? sql`0`
        : sql`${musicReminder.reminderDate} != ${data.reminderDate.getTime()}`

    const updatedRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({
            ...updateValues,
            status: sql`case when ${musicReminder.status} = ${REMINDER_STATUS.PROCESSING} and ${musicReminder.isSent} = 0 and (${scheduleChanged}) then ${REMINDER_STATUS.PENDING} else ${musicReminder.status} end`,
            updatedAt: sql`case when ${musicReminder.status} = ${REMINDER_STATUS.PROCESSING} and not (${scheduleChanged}) then ${musicReminder.updatedAt} else max(${musicReminder.updatedAt} + 1, ${now}) end`,
          })
          .where(eq(musicReminder.id, id))
          .returning(),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to update music reminder: ${getErrorMessage(error)}`,
          operation: 'update',
          table: 'music_reminder',
        }),
    })

    const updated = updatedRecords[0]

    if (!updated) {
      return yield* new DatabaseError({
        message: 'Failed to update music reminder',
        operation: 'update',
        table: 'music_reminder',
      })
    }

    yield* Effect.logInfo('[MusicReminder] Reminder updated', {
      reminderId: updated.id,
    })

    return updated
  })

const deleteEffect = (id: string, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(musicReminder).where(eq(musicReminder.id, id)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check reminder existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_reminder',
        }),
    })

    const existing = existingRecords[0]

    if (!existing) {
      return yield* new NotFoundError({
        message: 'Music reminder not found',
        resource: 'music_reminder',
        id,
      })
    }

    if (existing.userId !== userId) {
      return yield* new UnauthorizedError({
        message: 'Unauthorized',
        userId,
      })
    }

    yield* Effect.tryPromise({
      try: () => db.delete(musicReminder).where(eq(musicReminder.id, id)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to delete music reminder: ${getErrorMessage(error)}`,
          operation: 'delete',
          table: 'music_reminder',
        }),
    })

    yield* Effect.logInfo('[MusicReminder] Reminder deleted', {
      reminderId: id,
    })

    return undefined
  })

export const MusicReminderServiceLayer = Layer.effect(
  MusicReminderService,
  Effect.gen(function* () {
    const db = yield* Database
    const provideDb = Effect.provideService(Database, db)

    return {
      create: (data) => provideDb(createEffect(data)),
      getByUserId: (userId) => provideDb(getByUserIdEffect(userId)),
      getPageByUserId: (userId, page) => provideDb(getPageByUserIdEffect(userId, page)),
      update: (id, userId, data) => provideDb(updateEffect(id, userId, data)),
      delete: (id, userId) => provideDb(deleteEffect(id, userId)),
    }
  }),
)
