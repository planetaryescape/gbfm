import { Deferred, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { withTestLayer } from '@/test/effect'

import {
  deliverMixNotificationRecipients,
  MixNotificationRecipientOutcome,
} from './mix-notification-delivery'

test('admits only five recipient workflows despite uneven prerequisites and overlaps five sends', async () => {
  await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const recipients = Array.from({ length: 8 }, (_, index) => `listener-${index}@example.com`)
        const releaseSends = yield* Deferred.make<void>()
        const admitted: Array<string> = []
        const sending: Array<string> = []
        let active = 0
        let maxActive = 0
        let inFlight = 0
        let maxInFlight = 0

        const delivery = yield* deliverMixNotificationRecipients(recipients, (recipient) =>
          Effect.gen(function* () {
            admitted.push(recipient)
            active += 1
            maxActive = Math.max(maxActive, active)

            yield* Effect.sleep(`${recipients.indexOf(recipient) * 100} millis`)
            sending.push(recipient)
            inFlight += 1
            maxInFlight = Math.max(maxInFlight, inFlight)
            yield* Deferred.await(releaseSends)
            inFlight -= 1
            active -= 1

            return MixNotificationRecipientOutcome.sent({
              recipient,
              emailId: `receipt-${recipient}`,
            })
          }),
        ).pipe(Effect.forkScoped)

        yield* TestClock.adjust('0 millis')
        expect(admitted).toEqual(recipients.slice(0, 5))
        expect(sending).toEqual(recipients.slice(0, 1))
        expect(maxActive).toBe(5)

        yield* TestClock.adjust('400 millis')
        expect(admitted).toEqual(recipients.slice(0, 5))
        expect(sending).toEqual(recipients.slice(0, 5))
        expect(inFlight).toBe(5)
        expect(maxInFlight).toBe(5)

        yield* Deferred.succeed(releaseSends, undefined)
        yield* TestClock.adjust('1 second')
        const result = yield* Fiber.join(delivery)
        expect(admitted).toEqual(recipients)
        expect(maxActive).toBe(5)
        expect(maxInFlight).toBe(5)
        expect(result).toEqual({
          sentTo: recipients,
          emailIds: recipients.map((recipient) => `receipt-${recipient}`),
          skipped: [],
          errors: [],
        })
      }).pipe(Effect.scoped),
      TestClock.layer(),
    ),
  )
})

test('collects successful receipts, skips and failures in recipient order', async () => {
  const result = await Effect.runPromise(
    deliverMixNotificationRecipients(['first', 'skipped', 'failed', 'last'], (recipient) =>
      Effect.sync(() => {
        if (recipient === 'skipped') return MixNotificationRecipientOutcome.skipped({ recipient })

        if (recipient === 'failed') return MixNotificationRecipientOutcome.failed({ recipient })

        return MixNotificationRecipientOutcome.sent({ recipient, emailId: `receipt-${recipient}` })
      }),
    ),
  )

  expect(result).toEqual({
    sentTo: ['first', 'last'],
    emailIds: ['receipt-first', 'receipt-last'],
    skipped: ['skipped'],
    errors: ['failed'],
  })
})
