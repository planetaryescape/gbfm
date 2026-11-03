import { REMINDER_STATUS } from '@gbfm/core/status'
import { buildMusicReminderEmail } from '@gbfm/email/index'
import { and, asc, eq, lte, or } from 'drizzle-orm'
import { Chunk, Effect } from 'effect'

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
  const db = yield* Database
  const now = new Date()
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

  // Atomically claim pending reminders (or stalled ones)
  const claimedReminders = yield* Effect.tryPromise({
    try: () =>
      db
        .update(musicReminder)
        .set({
          status: REMINDER_STATUS.PROCESSING,
          updatedAt: new Date(),
        })
        .where(
          and(
            lte(musicReminder.reminderDate, now),
            or(
              eq(musicReminder.status, REMINDER_STATUS.PENDING),
              and(
                eq(musicReminder.status, REMINDER_STATUS.PROCESSING),
                lte(musicReminder.updatedAt, fiveMinutesAgo),
              ),
              eq(musicReminder.status, REMINDER_STATUS.FAILED),
            ),
          ),
        )
        .returning(),
    catch: (error) =>
      new ReminderProcessingError({
        message: `Failed to claim pending reminders: ${getErrorMessage(error)}`,
        reminderId: 'batch',
        stage: 'query',
      }),
  })

  if (claimedReminders.length === 0) {
    yield* Effect.logInfo('No pending reminders to process')

    return
  }

  yield* Effect.logInfo(`Processing ${claimedReminders.length} claimed reminders`)

  // Process reminders in batches with concurrency control
  yield* Effect.forEach(
    Chunk.fromIterable(claimedReminders),
    (reminder) =>
      processSingleReminder(reminder).pipe(
        Effect.catchTag('ReminderProcessingError', (error) =>
          Effect.logError('Failed to process reminder email', { stage: error.stage }),
        ),
      ),
    { concurrency: 3 },
  )
})

const processSingleReminder = (reminder: typeof musicReminder.$inferSelect) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* deliverReminderEmail(reminder)

    // Mark reminder as sent
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({
            status: REMINDER_STATUS.SENT,
            isSent: true,
            updatedAt: new Date(),
          })
          .where(eq(musicReminder.id, reminder.id)),
      catch: (error) =>
        new ReminderProcessingError({
          message: `Failed to update reminder status to sent: ${getErrorMessage(error)}`,
          reminderId: reminder.id,
          stage: 'update',
        }),
    })

    yield* Effect.logInfo(`Successfully processed reminder`, {
      reminderId: reminder.id,
      musicTitle: reminder.musicTitle,
      artistName: reminder.artistName,
    })
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const db = yield* Database
        // Log the failure
        yield* Effect.logError(`Failed to send reminder ${reminder.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          reminderId: reminder.id,
          musicTitle: reminder.musicTitle,
        })

        // Mark as failed so it can be picked up later
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(musicReminder)
              .set({
                status: REMINDER_STATUS.FAILED,
                updatedAt: new Date(),
              })
              .where(eq(musicReminder.id, reminder.id)),
          catch: () => undefined, // ignore update failure in error handler
        }).pipe(Effect.ignore)

        return yield* error
      }),
    ),
  )

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

// Bounded read for the Cron Trigger: reminders due now, still pending. The
// scheduled handler enqueues one job per row rather than claiming here --
// claiming happens in the queue consumer, guarded against the same reminder
// being enqueued twice by an overlapping cron run.
export const queryDueReminders = Effect.gen(function* () {
  const db = yield* Database
  const now = new Date()

  return yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: musicReminder.id, reminderDate: musicReminder.reminderDate })
        .from(musicReminder)
        .where(
          and(
            lte(musicReminder.reminderDate, now),
            eq(musicReminder.status, REMINDER_STATUS.PENDING),
          ),
        )
        .orderBy(asc(musicReminder.reminderDate))
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

// Guarded UPDATE ... WHERE status is PENDING or FAILED. A queue redelivery
// reclaims the FAILED state written after a delivery failure, while zero rows
// still means another invocation already owns this reminder and can be acked.
const claimReminderRow = (reminderId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const claimed = yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({ status: REMINDER_STATUS.PROCESSING, updatedAt: new Date() })
          .where(
            and(
              eq(musicReminder.id, reminderId),
              or(
                eq(musicReminder.status, REMINDER_STATUS.PENDING),
                eq(musicReminder.status, REMINDER_STATUS.FAILED),
              ),
            ),
          )
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

    if (!(yield* findReminderById(reminder.id))) return

    yield* deliverReminderEmail(reminder)

    yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicReminder)
          .set({ status: REMINDER_STATUS.SENT, isSent: true, updatedAt: new Date() })
          .where(eq(musicReminder.id, reminder.id)),
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
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(musicReminder)
              .set({ status: REMINDER_STATUS.FAILED, updatedAt: new Date() })
              .where(eq(musicReminder.id, reminder.id)),
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
