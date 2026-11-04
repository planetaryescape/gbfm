import {
  EmailLogsResponse,
  MixAnnouncementOptions,
  SendMixNotificationResponse,
} from '@gbfm/api/email'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { session, user } from '@/db/auth.schema'
import { emailDeliveryLogsTable, userEmailPreferencesTable } from '@/db/email.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { newsletterSubscribersTable } from '@/db/newsletter.schema'
import { EmailTransport, type OutboundEmailMessage } from '@/services/email-transport.service'
import { withTestLayer } from '@/test/effect'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

const makeTrackingEmailTransport = (sendGate: Promise<void> = Promise.resolve()) => {
  const messages: Array<OutboundEmailMessage> = []
  const fiveAdmitted = Promise.withResolvers<void>()
  let inFlight = 0
  let maxInFlight = 0

  return {
    fiveAdmitted: fiveAdmitted.promise,
    get messages(): ReadonlyArray<OutboundEmailMessage> {
      return messages
    },
    get maxInFlight(): number {
      return maxInFlight
    },
    layer: Layer.succeed(EmailTransport, {
      send: (message) =>
        Effect.promise(async () => {
          messages.push(message)
          const messageId = `recorded-${messages.length}`
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)

          if (inFlight === 5) fiveAdmitted.resolve()

          try {
            await sendGate

            return { provider: 'cloudflare' as const, messageId }
          } finally {
            inFlight -= 1
          }
        }),
    }),
  }
}

describe('sendMixNotification', () => {
  test('skips explicitly addressed disabled and unsubscribed recipients before transport or logging', async () => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const transport = makeTrackingEmailTransport()
    const webHandler = createTestWebHandler(d1, transport.layer)
    const suffix = crypto.randomUUID()
    const adminId = `email-admin-${suffix}`
    const adminToken = `email-admin-token-${suffix}`
    const disabledUserId = `disabled-user-${suffix}`
    const mixSlug = `email-mix-${suffix}`

    await database.insert(user).values([
      {
        id: adminId,
        name: 'Email admin',
        email: `${adminId}@example.com`,
        role: 'admin',
      },
      {
        id: disabledUserId,
        name: 'Disabled listener',
        email: `disabled-${suffix}@example.com`,
      },
    ])
    await database.insert(userEmailPreferencesTable).values({
      userId: disabledUserId,
      mixReleaseEnabled: false,
      promotionalEnabled: false,
      systemEnabled: false,
      globalUnsubscribe: true,
    })
    await database.insert(newsletterSubscribersTable).values({
      email: `unsubscribed-${suffix}@example.com`,
      unsubscribedAt: new Date(),
    })
    await database
      .insert(newsletterSubscribersTable)
      .values({ email: `active-${suffix}@example.com` })
    await database.insert(session).values({
      id: crypto.randomUUID(),
      token: adminToken,
      userId: adminId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await database.insert(session).values({
      id: crypto.randomUUID(),
      token: `member-${suffix}`,
      userId: disabledUserId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await database.insert(audioTable).values({
      title: 'Preference-aware mix',
      slug: mixSlug,
      content: 'mix content',
      type: 'mix',
      url: 'https://goosebumps.fm/mixes/preference-aware',
    })
    await database.insert(audioTable).values({
      title: 'Unpublished mix',
      slug: `draft-${suffix}`,
      content: '',
      type: 'mix',
      url: 'https://example.test/draft.mp3',
      draft: true,
    })

    try {
      const optionsPath = 'http://localhost/api/email/mix-announcement-options'
      const unauthorized = await webHandler.handler(new Request(optionsPath))
      expect(unauthorized.status).toBe(401)

      const forbidden = await webHandler.handler(
        new Request(optionsPath, {
          headers: { authorization: `Bearer member-${suffix}` },
        }),
      )

      expect(forbidden.status).toBe(403)

      const optionsResponse = await webHandler.handler(
        new Request(optionsPath, {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
      )

      expect(optionsResponse.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(MixAnnouncementOptions)(await optionsResponse.json()),
      ).toEqual({
        mixes: [{ slug: mixSlug, title: 'Preference-aware mix' }],
        recipients: [`active-${suffix}@example.com`],
      })

      const response = await webHandler.handler(
        new Request('http://localhost/api/email/send-mix-notification', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            recipients: [`DISABLED-${suffix}@EXAMPLE.COM`, `UNSUBSCRIBED-${suffix}@EXAMPLE.COM`],
            mixSlug,
          }),
        }),
      )

      expect(response.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(SendMixNotificationResponse)(await response.json()),
      ).toMatchObject({
        sentTo: [],
        emailIds: [],
      })
      expect(transport.messages).toEqual([])
      await expect(database.select().from(emailDeliveryLogsTable)).resolves.toEqual([])
    } finally {
      await webHandler.dispose()
    }
  })

  test('limits delivery concurrency to five while retaining one receipt and log per recipient', async ({
    onTestFinished,
  }) => {
    await using d1Resource = await createMigratedD1Database()
    const d1 = d1Resource.database
    const database = Effect.runSync(withTestLayer(Database, DatabaseLayer(d1)))
    const releaseSends = Promise.withResolvers<void>()
    onTestFinished(() => releaseSends.resolve())
    const transport = makeTrackingEmailTransport(releaseSends.promise)
    const webHandler = createTestWebHandler(d1, transport.layer)
    const suffix = crypto.randomUUID()
    const adminId = `email-admin-${suffix}`
    const adminToken = `email-admin-token-${suffix}`
    const mixSlug = `email-mix-${suffix}`

    const recipients = Array.from(
      { length: 6 },
      (_, index) => `listener-${index}-${suffix}@example.com`,
    )

    await database.insert(user).values({
      id: adminId,
      name: 'Email admin',
      email: `${adminId}@example.com`,
      role: 'admin',
    })
    await database.insert(newsletterSubscribersTable).values(recipients.map((email) => ({ email })))
    await database.insert(session).values({
      id: crypto.randomUUID(),
      token: adminToken,
      userId: adminId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await database.insert(audioTable).values({
      title: 'Concurrent mix',
      slug: mixSlug,
      content: 'mix content',
      type: 'mix',
      url: 'https://goosebumps.fm/mixes/concurrent',
    })

    let pending: Promise<Response> | undefined

    try {
      pending = webHandler.handler(
        new Request('http://localhost/api/email/send-mix-notification', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ recipients, mixSlug }),
        }),
      )

      await Promise.race([
        transport.fiveAdmitted,
        pending.then(() => {
          throw new Error('Delivery completed before five concurrent sends were admitted')
        }),
      ])
      expect(transport.messages).toHaveLength(5)
      expect(transport.maxInFlight).toBe(5)
      releaseSends.resolve()
      const response = await pending

      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(SendMixNotificationResponse)(await response.json())
      const deliveryLogs = await database.select().from(emailDeliveryLogsTable)

      expect(body.sentTo).toEqual(recipients)
      expect(body.emailIds).toHaveLength(recipients.length)
      expect(transport.messages.map((message) => message.to).sort()).toEqual([...recipients].sort())
      expect(transport.maxInFlight).toBe(5)
      expect(deliveryLogs).toHaveLength(recipients.length)
      expect(deliveryLogs.map((log) => log.recipientEmail).sort()).toEqual([...recipients].sort())
      expect(deliveryLogs.every((log) => log.status === 'SENT')).toBe(true)

      const logsResponse = await webHandler.handler(
        new Request('http://localhost/api/email/logs', {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
      )

      const rawLogsBody: unknown = await logsResponse.json()
      const logsBody = Schema.decodeUnknownSync(EmailLogsResponse)(rawLogsBody)

      expect(logsResponse.status).toBe(200)
      expect(rawLogsBody).not.toMatchObject({
        data: [expect.objectContaining({ metadata: expect.anything() })],
      })
      expect(logsBody.data[0]).not.toHaveProperty('metadata')

      const filtered = await webHandler.handler(
        new Request(
          `http://localhost/api/email/logs?recipientEmail=${encodeURIComponent(`LISTENER-0-${suffix.toUpperCase()}@EXAMPLE.COM`)}&status=SENT&limit=1`,
          { headers: { authorization: `Bearer ${adminToken}` } },
        ),
      )

      expect(filtered.status).toBe(200)
      const filteredBody = Schema.decodeUnknownSync(EmailLogsResponse)(await filtered.json())
      expect(filteredBody.data.map((log) => log.recipientEmail)).toEqual([recipients[0]])
      expect(filteredBody.pagination.total).toBe(1)
    } finally {
      releaseSends.resolve()
      await Promise.allSettled(pending ? [pending] : [])
      await webHandler.dispose()
    }
  })
})
