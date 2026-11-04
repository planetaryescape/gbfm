import { REMINDER_STATUS } from '@gbfm/core/status'
import { buildMusicReminderEmail } from '@gbfm/email/index'
import { and, asc, eq, lte, or, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { user } from '@/db/auth.schema'
import { EMAIL_NOTIFICATION_TYPES } from '@/db/email.schema'
import { Database } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { getErrorMessage, ReminderProcessingError } from '@/errors'
import { omitUndefined } from '@/lib/omit-undefined'

import { EmailDelivery } from './email-delivery.service'

const deliverReminderEmail = (reminder: typeof musicReminder.$inferSelect) =>
  Effect.gen(function* () {
    const db = yield* Database
    const delivery = yield* EmailDelivery

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ email: user.email, name: user.name })
          .from(user)
          .where(eq(user.id, reminder.userId))
          .limit(1),
      catch: (cause) =>
        new ReminderProcessingError({
          message: `Failed to load reminder recipient: ${getErrorMessage(cause)}`,
          reminderId: reminder.id,
          stage: 'query',
        }),
    })

    const recipient = rows[0]

    if (!recipient?.email) {
      return yield* new ReminderProcessingError({
        message: 'Reminder recipient has no email address',
        reminderId: reminder.id,
        stage: 'email',
      })
    }

    const message = yield* buildMusicReminderEmail({
      to: recipient.email,
      username: recipient.name || recipient.email.split('@')[0] || 'listener',
      musicTitle: reminder.musicTitle,
      artistName: reminder.artistName,
      musicUrl: reminder.musicUrl,
      reminderDate: reminder.reminderDate.toISOString(),
      notes: reminder.notes,
      albumCoverUrl: reminder.albumCoverUrl,
    }).pipe(
      Effect.mapError(
        () =>
          new ReminderProcessingError({
            message: 'Failed to render reminder email',
            reminderId: reminder.id,
            stage: 'email',
          }),
      ),
    )

    yield* delivery
      .deliver(
        omitUndefined({
          message,
          emailType: EMAIL_NOTIFICATION_TYPES.MIX_RELEASE,
          userId: reminder.userId,
          recipientName: recipient.name || undefined,
          safeMetadata: { kind: 'music-reminder' as const, reminderId: reminder.id },
        }),
      )
      .pipe(
        Effect.mapError(
          () =>
            new ReminderProcessingError({
              message: 'Failed to deliver reminder email',
              reminderId: reminder.id,
              stage: 'email',
            }),
        ),
      )

    return undefined
  })

// Process all pending music reminders
export const processPendingReminders = Effect.gen(function* () {
  const reminders = yield* queryDueReminders
  yield* Effect.forEach(
    reminders,
    (reminder) =>
      processReminderJob(reminder.id).pipe(
        Effect.catchTag('ReminderProcessingError', (error) =>
          Effect.logError('Failed to process reminder email', { stage: error.stage }),
        ),
      ),
    { concurrency: 3 },
  )
})

// Returns the soonest reminderDate among pending/failed reminders (past or future)
export const queryNextDueReminder = Effect.gen(function* () {
  const db = yield* Database

  const results = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ reminderDate: musicReminder.reminderDate })
        .from(musicReminder)
        .where(
          or(
            eq(musicReminder.status, REMINDER_STATUS.PENDING),
            eq(musicReminder.status, REMINDER_STATUS.FAILED),
          ),
        )
        .orderBy(asc(musicReminder.reminderDate))
        .limit(1),
    catch: (error) =>
      new ReminderProcessingError({
        message: `Failed to query next due reminder: ${getErrorMessage(error)}`,
        reminderId: 'next-query',
        stage: 'query',
      }),
  })

  return results[0]?.reminderDate ?? null
})

// Get statistics about pending reminders (for monitoring)
// not using this anywhere yet👀
export const getReminderStats = Effect.gen(function* () {
  const db = yield* Database
  const now = new Date()

  const [stats] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          totalPending: db.$count(
            musicReminder,
            or(
              eq(musicReminder.status, REMINDER_STATUS.PENDING),
              eq(musicReminder.status, REMINDER_STATUS.FAILED),
            ),
          ),
          dueNow: db.$count(
            musicReminder,
            and(
              lte(musicReminder.reminderDate, now),
              or(
                eq(musicReminder.status, REMINDER_STATUS.PENDING),
                eq(musicReminder.status, REMINDER_STATUS.FAILED),
              ),
            ),
          ),
          processing: db.$count(
            musicReminder,
            eq(musicReminder.status, REMINDER_STATUS.PROCESSING),
          ),
        })
        .from(musicReminder),
    catch: (error) =>
      new ReminderProcessingError({
        message: `Failed to get reminder stats: ${getErrorMessage(error)}`,
        reminderId: 'stats',
        stage: 'query',
      }),
  })

  return {
    totalPending: stats?.totalPending || 0,
    dueNow: stats?.dueNow || 0,
    timestamp: now.toISOString(),
  }
})

const DUE_REMINDERS_LIMIT = 100

const REMINDER_STALE_MS = 5 * 60 * 1000

const eligibleReminder = (now: number) =>
  and(
    lte(musicReminder.reminderDate, new Date(now)),
    eq(musicReminder.isSent, false),
    or(
      eq(musicReminder.status, REMINDER_STATUS.PENDING),
      and(
        or(
          eq(musicReminder.status, REMINDER_STATUS.FAILED),
          eq(musicReminder.status, REMINDER_STATUS.PROCESSING),
        ),
        lte(musicReminder.updatedAt, new Date(now - REMINDER_STALE_MS)),
      ),
    ),
  )

const ownsClaim = (reminder: typeof musicReminder.$inferSelect) =>
  and(
    eq(musicReminder.id, reminder.id),
    eq(musicReminder.status, REMINDER_STATUS.PROCESSING),
    eq(musicReminder.isSent, false),
    eq(musicReminder.updatedAt, reminder.updatedAt),
  )

const nextGeneration = (now: number) => sql`max(${musicReminder.updatedAt} + 1, ${now})`

export const queryDueReminders = Effect.gen(function* () {
  const db = yield* Database
  const now = yield* Clock.currentTimeMillis

  return yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: musicReminder.id, reminderDate: musicReminder.reminderDate })
        .from(musicReminder)
        .where(eligibleReminder(now))
        .orderBy(asc(musicReminder.reminderDate), asc(musicReminder.id))
        .limit(DUE_REMINDERS_LIMIT),
    catch: (error) =>
      new ReminderProcessingError({
        message: `Failed to query due reminders: ${getErrorMessage(error)}`,
        reminderId: 'due-query',
        stage: 'query',
      }),
  })
})

export type ReminderClaimResult = { readonly claimed: true } | { readonly claimed: false }

const claimReminderRow = (reminderId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    const now = yield* Clock.currentTimeMillis

    const claimed = yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({ status: REMINDER_STATUS.PROCESSING, updatedAt: nextGeneration(now) })
          .where(and(eq(musicReminder.id, reminderId), eligibleReminder(now)))
          .returning(),
      catch: (error) =>
        new ReminderProcessingError({
          message: `Failed to claim reminder: ${getErrorMessage(error)}`,
          reminderId,
          stage: 'query',
        }),
    })

    return claimed[0] ?? null
  })

export const claimReminder = (reminderId: string) =>
  claimReminderRow(reminderId).pipe(
    Effect.map((reminder): ReminderClaimResult => ({ claimed: reminder !== null })),
  )

// Sends one already-claimed reminder and marks it sent/failed. Each invocation
// makes one provider call. If the provider accepts just before the terminal D1
// update fails, queue redelivery can send a duplicate; the persisted receipt
// records accepted attempts but cannot make this external side effect atomic.
export const sendClaimedReminder = (reminder: typeof musicReminder.$inferSelect) =>
  Effect.gen(function* () {
    const db = yield* Database

    if (reminder.status !== REMINDER_STATUS.PROCESSING || reminder.isSent) return

    const currentReminder = yield* Effect.tryPromise({
      try: () => db.select().from(musicReminder).where(ownsClaim(reminder)).limit(1),
      catch: (error) =>
        new ReminderProcessingError({
          message: `Failed to load reminder: ${getErrorMessage(error)}`,
          reminderId: reminder.id,
          stage: 'query',
        }),
    }).pipe(Effect.map((rows) => rows[0]))

    if (!currentReminder) return

    yield* deliverReminderEmail(currentReminder)
    const now = yield* Clock.currentTimeMillis

    yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({ status: REMINDER_STATUS.SENT, isSent: true, updatedAt: nextGeneration(now) })
          .where(ownsClaim(reminder)),
      catch: (error) =>
        new ReminderProcessingError({
          message: `Failed to update reminder status to sent: ${getErrorMessage(error)}`,
          reminderId: reminder.id,
          stage: 'update',
        }),
    })
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to send reminder ${reminder.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          reminderId: reminder.id,
          musicTitle: reminder.musicTitle,
        })

        const db = yield* Database
        const now = yield* Clock.currentTimeMillis
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(musicReminder)
              .set({ status: REMINDER_STATUS.FAILED, updatedAt: nextGeneration(now) })
              .where(ownsClaim(reminder)),
          catch: () => undefined,
        }).pipe(Effect.ignore)

        return yield* error
      }),
    ),
  )

export const findReminderById = (reminderId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(musicReminder).where(eq(musicReminder.id, reminderId)).limit(1),
      catch: (error) =>
        new ReminderProcessingError({
          message: `Failed to load reminder: ${getErrorMessage(error)}`,
          reminderId,
          stage: 'query',
        }),
    })

    return rows[0] ?? null
  })

export const processReminderJob = (reminderId: string) =>
  Effect.gen(function* () {
    const reminder = yield* claimReminderRow(reminderId)

    if (!reminder) return

    yield* sendClaimedReminder(reminder)
  })
