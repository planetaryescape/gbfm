import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { account, user, verification } from '@/db/auth.schema'
import { emailDeliveryLogsTable, userEmailPreferencesTable } from '@/db/email.schema'
import { makeDatabaseClient } from '@/db/layer'
import { newsletterSubscribersTable } from '@/db/newsletter.schema'
import { getOrCreateEmailPreferencesByUserId } from '@/repositories/email-preferences.repository'
import {
  linkOrCreateSubscriberForUser,
  markSubscriberUnsubscribedByUserId,
} from '@/repositories/newsletter.repository'
import {
  EmailTransport,
  EmailUnavailable,
  makeRecordingEmailTransport,
} from '@/services/email-transport.service'
import { SignupProtection } from '@/services/signup-protection'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

const password = 'disposable-local-password-123'

const SignedIn = Schema.Struct({ token: Schema.String })

const setup = async (unavailable = false) => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  const recording = makeRecordingEmailTransport()

  const transport = unavailable
    ? Layer.succeed(EmailTransport, { send: () => Effect.fail(new EmailUnavailable({})) })
    : recording.layer

  const web = createTestWebHandler(
    resource.database,
    transport,
    undefined,
    undefined,
    undefined,
    Layer.succeed(SignupProtection, { authorize: () => Effect.void }),
  )

  const request = (path: string, body: Record<string, string>, token?: string) =>
    web.handler(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : undefined),
        },
        body: JSON.stringify(body),
      }),
    )

  const login = async (id: string, role = 'user') => {
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, role })
    await db.insert(account).values({
      id: `${id}-account`,
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    const response = await request('/auth/sign-in/email', { email: `${id}@example.test`, password })
    expect(response.status).toBe(200)

    return Schema.decodeUnknownSync(SignedIn)(await response.json()).token
  }

  const seedInvite = async (expiresAt: Date) => {
    await db.insert(user).values({ id: 'invited', name: 'Invited', email: 'invited@example.test' })
    const token = crypto.randomUUID()
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `reset-password:${token}`,
      value: 'invited',
      expiresAt,
    })

    return token
  }

  return {
    db,
    request,
    login,
    seedInvite,
    messages: recording.messages,
    async [Symbol.asyncDispose]() {
      await web.dispose()
      await resource[Symbol.asyncDispose]()
    },
  }
}

describe('account lifecycles', { timeout: 30000 }, () => {
  test('subscriber absence, linking and repeated account opt-out preserve the original subscription identity', async () => {
    await using f = await setup()
    await f.db
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
    expect(
      await linkOrCreateSubscriberForUser(
        { userId: 'listener', email: ' LISTENER@example.test ' },
        f.db,
      ),
    ).toEqual({ previouslyUnsubscribed: false })
    const [original] = await f.db.select().from(newsletterSubscribersTable)
    await markSubscriberUnsubscribedByUserId('listener', f.db)
    await markSubscriberUnsubscribedByUserId('listener', f.db)
    expect(
      await linkOrCreateSubscriberForUser(
        { userId: 'listener', email: 'listener@example.test' },
        f.db,
      ),
    ).toEqual({ previouslyUnsubscribed: true })
    const rows = await f.db.select().from(newsletterSubscribersTable)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: original?.id,
      unsubscribeToken: original?.unsubscribeToken,
      userId: 'listener',
    })
    expect(rows[0]?.unsubscribedAt).toBeInstanceOf(Date)
  })

  test('repeated public unsubscribe succeeds, preserves opt-out on subscribe and suppresses unsubscribe-link delivery', async () => {
    await using f = await setup()
    await f.db
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
    await getOrCreateEmailPreferencesByUserId('listener', f.db)

    const [subscriber] = await f.db
      .insert(newsletterSubscribersTable)
      .values({ email: 'listener@example.test', userId: 'listener' })
      .returning()

    const token = subscriber?.unsubscribeToken

    if (!token) throw new Error('Expected unsubscribe token')

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.request('/api/newsletter/unsubscribe', { token })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
    }

    expect((await f.db.select().from(userEmailPreferencesTable))[0]).toMatchObject({
      globalUnsubscribe: true,
      promotionalEnabled: false,
      systemEnabled: false,
      mixReleaseEnabled: false,
    })
    const count = f.messages.length
    expect(count).toBe(2)

    const subscribed = await f.request('/api/newsletter/subscribe', {
      email: 'listener@example.test',
      turnstileToken: 'fixture',
    })

    expect(await subscribed.json()).toEqual({ subscribed: false, email: 'listener@example.test' })

    const requested = await f.request('/api/newsletter/request-unsubscribe', {
      email: 'listener@example.test',
    })

    expect(await requested.json()).toEqual({ sent: true })
    expect(f.messages).toHaveLength(count)
    expect(
      (await f.db.select().from(newsletterSubscribersTable))[0]?.unsubscribedAt,
    ).toBeInstanceOf(Date)
  })

  test('newsletter mail failure does not roll back subscription or change the non-enumerating response', async () => {
    await using f = await setup(true)

    const response = await f.request('/api/newsletter/subscribe', {
      email: 'listener@example.test',
      turnstileToken: 'fixture',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ subscribed: true, email: 'listener@example.test' })
    expect(await f.db.select().from(newsletterSubscribersTable)).toHaveLength(1)
    expect((await f.db.select().from(emailDeliveryLogsTable)).map((row) => row.status)).toEqual([
      'FAILED',
      'FAILED',
    ])

    for (const email of ['listener@example.test', 'absent@example.test']) {
      const requested = await f.request('/api/newsletter/request-unsubscribe', { email })
      expect(requested.status).toBe(200)
      expect(await requested.json()).toEqual({ sent: true })
    }
  })

  test('preference propagation failure leaves the subscriber opted out before a retry completes the account opt-out', async () => {
    await using f = await setup()
    await f.db
      .insert(user)
      .values({ id: 'listener', name: 'Listener', email: 'listener@example.test' })
    await getOrCreateEmailPreferencesByUserId('listener', f.db)

    const [subscriber] = await f.db
      .insert(newsletterSubscribersTable)
      .values({ email: 'listener@example.test', userId: 'listener' })
      .returning()

    if (!subscriber?.unsubscribeToken) throw new Error('Expected unsubscribe token')
    await f.db.run(
      sql`CREATE TRIGGER reject_preferences BEFORE UPDATE ON user_email_preferences BEGIN SELECT RAISE(ABORT, 'fixture preferences failure'); END`,
    )
    expect(
      (await f.request('/api/newsletter/unsubscribe', { token: subscriber.unsubscribeToken }))
        .status,
    ).toBe(500)
    expect(
      (await f.db.select().from(newsletterSubscribersTable))[0]?.unsubscribedAt,
    ).toBeInstanceOf(Date)
    expect((await f.db.select().from(userEmailPreferencesTable))[0]?.globalUnsubscribe).toBe(false)
    expect(f.messages).toHaveLength(0)
    await f.db.run(sql`DROP TRIGGER reject_preferences`)
    expect(
      (await f.request('/api/newsletter/unsubscribe', { token: subscriber.unsubscribeToken }))
        .status,
    ).toBe(200)
    expect((await f.db.select().from(userEmailPreferencesTable))[0]?.globalUnsubscribe).toBe(true)
  })

  test('anonymous newsletter opt-out is carried into account preferences by real signup', async () => {
    await using f = await setup()
    const optedOutAt = new Date(0)
    await f.db
      .insert(newsletterSubscribersTable)
      .values({ email: 'signup@example.test', unsubscribedAt: optedOutAt })

    const response = await f.request('/auth/sign-up/email', {
      email: 'signup@example.test',
      name: 'Signup',
      password,
      turnstileToken: 'fixture',
    })

    expect(response.status).toBe(200)
    const [subscriber] = await f.db.select().from(newsletterSubscribersTable)
    expect(subscriber?.userId).toBeTruthy()
    expect(subscriber?.unsubscribedAt).toEqual(optedOutAt)
    expect((await f.db.select().from(userEmailPreferencesTable))[0]).toMatchObject({
      globalUnsubscribe: true,
      mixReleaseEnabled: false,
      promotionalEnabled: false,
      systemEnabled: false,
    })
  })

  test('invitation delivery failure leaves an issued token and a later successful confirm consumes it', async () => {
    await using f = await setup(true)
    const admin = await f.login('admin', 'admin')
    await f.db
      .insert(user)
      .values({ id: 'invited', name: 'Invited', email: 'invited@example.test' })
    const sent = await f.request('/api/invite/send', { userId: 'invited' }, admin)
    expect(sent.status).toBe(500)
    const [issued] = await f.db.select().from(verification)

    if (!issued) throw new Error('Expected issued invite')
    expect(issued.value).toBe('invited')
    expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    const token = issued.identifier.replace('reset-password:', '')
    const confirmed = await f.request('/api/invite/confirm', { token, password })
    expect(confirmed.status).toBe(200)
    expect(confirmed.headers.get('set-cookie')).toBeTruthy()
    expect(await f.db.select().from(verification)).toHaveLength(0)
    expect((await f.request('/api/invite/confirm', { token, password })).status).toBe(400)
  })

  test('expired invitation stays unconsumed and never establishes a password', async () => {
    await using f = await setup()
    const token = await f.seedInvite(new Date(0))
    expect((await f.request('/api/invite/confirm', { token, password })).status).toBe(400)
    expect(await f.db.select().from(verification)).toHaveLength(1)
    expect(await f.db.select().from(account)).toHaveLength(0)
  })

  test('password establishment survives sign-in failure, with its token already consumed', async () => {
    await using f = await setup()
    const token = await f.seedInvite(new Date(Date.now() + 3600000))
    await f.db.run(
      sql`CREATE TRIGGER reject_invite_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'fixture session failure'); END`,
    )
    const response = await f.request('/api/invite/confirm', { token, password })
    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await f.db.select().from(verification)).toHaveLength(0)
    const [credential] = await f.db.select().from(account).where(eq(account.userId, 'invited'))

    if (!credential?.password) throw new Error('Expected established password')
    expect(await verifyPassword({ hash: credential.password, password })).toBe(true)
    await f.db.run(sql`DROP TRIGGER reject_invite_session`)
    expect(
      (await f.request('/auth/sign-in/email', { email: 'invited@example.test', password })).status,
    ).toBe(200)
    expect((await f.request('/api/invite/confirm', { token, password })).status).toBe(400)
  })
})
