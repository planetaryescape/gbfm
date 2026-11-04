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

    const updatedRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({
            ...updateValues,
            updatedAt: sql`case when ${musicReminder.status} = ${REMINDER_STATUS.PROCESSING} then ${musicReminder.updatedAt} else max(${musicReminder.updatedAt} + 1, ${now}) end`,
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
      update: (id, userId, data) => provideDb(updateEffect(id, userId, data)),
      delete: (id, userId) => provideDb(deleteEffect(id, userId)),
    }
  }),
)
