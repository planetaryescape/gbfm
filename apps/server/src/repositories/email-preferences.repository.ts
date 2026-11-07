import { and, eq, isNull, sql } from 'drizzle-orm'

import { user as userTable } from '@/db/auth.schema'
import {
  EMAIL_NOTIFICATION_TYPES,
  type EmailNotificationType,
  type InsertAuthorEmailPreferences,
  type SelectAuthorEmailPreferences,
  userEmailPreferencesTable,
} from '@/db/email.schema'
import type { DatabaseClient } from '@/db/layer'
import { newsletterSubscribersTable } from '@/db/newsletter.schema'

async function findEmailPreferencesByUserId(userId: string, database: DatabaseClient) {
  const [preferences] = await database
    .select()
    .from(userEmailPreferencesTable)
    .where(eq(userEmailPreferencesTable.userId, userId))
    .limit(1)

  return preferences
}

export async function getOrCreateEmailPreferencesByUserId(
  userId: string,
  database: DatabaseClient,
): Promise<SelectAuthorEmailPreferences> {
  const existing = await findEmailPreferencesByUserId(userId, database)

  if (existing) {
    return existing
  }

  const [newPreferences] = await database
    .insert(userEmailPreferencesTable)
    .values({
      userId: userId,
      mixReleaseEnabled: true,
      promotionalEnabled: true,
      systemEnabled: true,
      globalUnsubscribe: false,
      unsubscribeToken: crypto.randomUUID(),
    })
    .onConflictDoNothing({ target: userEmailPreferencesTable.userId })
    .returning()

  const preferences = newPreferences ?? (await findEmailPreferencesByUserId(userId, database))

  if (!preferences) {
    throw new Error('Failed to create email preferences')
  }

  return preferences
}

export async function updateEmailPreferences(
  userId: string,
  updates: Partial<InsertAuthorEmailPreferences>,
  database: DatabaseClient,
) {
  const [result] = await database
    .update(userEmailPreferencesTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(userEmailPreferencesTable.userId, userId))
    .returning()

  return result
}

export async function canReceiveEmail(
  userId: string,
  emailType: EmailNotificationType,
  database: DatabaseClient,
): Promise<boolean> {
  if (emailType === EMAIL_NOTIFICATION_TYPES.TRANSACTIONAL) {
    return true
  }

  const preferences = await getOrCreateEmailPreferencesByUserId(userId, database)

  if (preferences.globalUnsubscribe) {
    return false
  }

  switch (emailType) {
    case EMAIL_NOTIFICATION_TYPES.MIX_RELEASE:
      return preferences.mixReleaseEnabled
    case EMAIL_NOTIFICATION_TYPES.PROMOTIONAL:
      return preferences.promotionalEnabled
    case EMAIL_NOTIFICATION_TYPES.SYSTEM:
      return preferences.systemEnabled
    default:
      return false
  }
}

export async function globalUnsubscribe(userId: string, database: DatabaseClient) {
  const updates = {
    globalUnsubscribe: true,
    mixReleaseEnabled: false,
    promotionalEnabled: false,
    systemEnabled: false,
    updatedAt: new Date(),
  }

  const [preferences] = await database
    .insert(userEmailPreferencesTable)
    .values({ userId, unsubscribeToken: crypto.randomUUID(), ...updates })
    .onConflictDoUpdate({
      target: userEmailPreferencesTable.userId,
      set: updates,
      setWhere: sql`${userEmailPreferencesTable.globalUnsubscribe} = 0
        or ${userEmailPreferencesTable.mixReleaseEnabled} = 1
        or ${userEmailPreferencesTable.promotionalEnabled} = 1
        or ${userEmailPreferencesTable.systemEnabled} = 1`,
    })
    .returning()

  const persisted = preferences ?? (await findEmailPreferencesByUserId(userId, database))

  if (!persisted) throw new Error('Failed to persist email opt-out')

  return persisted
}

export async function getEmailPreferencesByUnsubscribeToken(
  token: string,
  database: DatabaseClient,
) {
  const [preferences] = await database
    .select()
    .from(userEmailPreferencesTable)
    .where(eq(userEmailPreferencesTable.unsubscribeToken, token))
    .limit(1)

  return preferences
}

/**
 * Resolves whether an email address should receive a given notification type,
 * bridging the two opt-out systems: account preferences are the source of truth
 * when the email belongs to a user, otherwise the newsletter subscription state.
 */
export async function canEmailReceive(
  email: string,
  emailType: EmailNotificationType,
  database: DatabaseClient,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()

  const [userRow] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, normalizedEmail))
    .limit(1)

  if (userRow) {
    return canReceiveEmail(userRow.id, emailType, database)
  }

  if (emailType === EMAIL_NOTIFICATION_TYPES.TRANSACTIONAL) {
    return true
  }

  const [subscriber] = await database
    .select({ unsubscribedAt: newsletterSubscribersTable.unsubscribedAt })
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.email, normalizedEmail))
    .limit(1)

  return subscriber ? subscriber.unsubscribedAt === null : false
}

/**
 * Returns the deduped set of email addresses that should receive a mix-release
 * blast: active newsletter subscribers plus users whose preferences allow it.
 * Each address is opt-out filtered through the SSOT.
 */
export async function getActiveMixRecipients(database: DatabaseClient): Promise<Array<string>> {
  const subscribers = await database
    .select({ email: newsletterSubscribersTable.email })
    .from(newsletterSubscribersTable)
    .where(isNull(newsletterSubscribersTable.unsubscribedAt))

  const optedInUsers = await database
    .select({ email: userTable.email })
    .from(userTable)
    .innerJoin(userEmailPreferencesTable, eq(userEmailPreferencesTable.userId, userTable.id))
    .where(
      and(
        eq(userEmailPreferencesTable.globalUnsubscribe, false),
        eq(userEmailPreferencesTable.mixReleaseEnabled, true),
      ),
    )

  const emails = new Set<string>()

  for (const row of subscribers) emails.add(row.email.toLowerCase())

  for (const row of optedInUsers) emails.add(row.email.toLowerCase())

  const result: Array<string> = []

  for (const email of emails) {
    if (await canEmailReceive(email, EMAIL_NOTIFICATION_TYPES.MIX_RELEASE, database)) {
      result.push(email)
    }
  }

  return result
}
