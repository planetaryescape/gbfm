import { Api } from '@gbfm/api/api'
import { NewsletterRateLimitError } from '@gbfm/api/newsletter'
import {
  buildNewsletterAdminNotificationEmail,
  buildNewsletterUnsubscribeLinkEmail,
  buildNewsletterWelcomeEmail,
  type EmailRenderError,
  type RenderedEmail,
} from '@gbfm/email/index'
import { and, eq, isNull } from 'drizzle-orm'
import { Clock, Effect, Result } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { EMAIL_NOTIFICATION_TYPES } from '@/db/email.schema'
import { Database } from '@/db/layer'
import { newsletterSubscribersTable } from '@/db/newsletter.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { dieOnDatabaseError as makeDieOnDatabaseError } from '@/http/handler-utils'
import { globalUnsubscribe } from '@/repositories/email-preferences.repository'
import { ConfigService } from '@/services/config.service'
import { EmailDelivery } from '@/services/email-delivery.service'
import { SignupProtection } from '@/services/signup-protection'

const dieOnDatabaseError = makeDieOnDatabaseError('newsletter')

const notifyAdmin = (event: 'subscribed' | 'unsubscribed', email: string) =>
  Effect.gen(function* () {
    const config = yield* ConfigService
    const clock = yield* Clock.Clock
    const delivery = yield* EmailDelivery

    const result = yield* Effect.result(
      Effect.gen(function* () {
        const message = yield* buildNewsletterAdminNotificationEmail({
          to: config.adminEmail,
          event,
          email,
          timestamp: new Date(yield* clock.currentTimeMillis).toISOString(),
        })

        return yield* delivery.deliver({
          message,
          emailType: EMAIL_NOTIFICATION_TYPES.SYSTEM,
        })
      }),
    )

    if (Result.isFailure(result)) {
      yield* Effect.logWarning('[newsletter] admin notification was not delivered', {
        event,
        failure: result.failure._tag,
      })
    }
  })

const attemptSubscriptionEmail = (
  build: Effect.Effect<RenderedEmail, EmailRenderError>,
  emailType: 'welcome' | 'unsubscribe-link',
) =>
  Effect.gen(function* () {
    const delivery = yield* EmailDelivery

    const result = yield* Effect.result(
      Effect.gen(function* () {
        const message = yield* build

        return yield* delivery.deliver({
          message,
          emailType: EMAIL_NOTIFICATION_TYPES.SYSTEM,
        })
      }),
    )

    if (Result.isFailure(result)) {
      yield* Effect.logWarning('[newsletter] subscription email was not delivered', {
        emailType,
        failure: result.failure._tag,
      })
    }
  })

export const NewsletterHandlersLive = HttpApiBuilder.group(Api, 'newsletter', (handlers) =>
  handlers
    .handle('subscribe', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const protection = yield* SignupProtection
        yield* protection
          .authorize({
            token: payload.turnstileToken,
            ip: request.headers['cf-connecting-ip'],
            action: 'newsletter-subscribe',
          })
          .pipe(
            Effect.mapError((error) => {
              if (error.reason === 'rate-limit') return new NewsletterRateLimitError()

              if (error.reason === 'unavailable') return new HttpApiError.ServiceUnavailable()

              return new HttpApiError.Forbidden()
            }),
          )
        const db = yield* Database
        const normalizedEmail = payload.email.trim().toLowerCase()

        const result = yield* dieOnDatabaseError(
          Effect.tryPromise({
            try: () =>
              db
                .insert(newsletterSubscribersTable)
                .values({
                  email: normalizedEmail,
                  name: payload.name ? payload.name.trim() : undefined,
                  source: payload.source || 'subscribe_page',
                })
                .onConflictDoNothing({ target: newsletterSubscribersTable.email })
                .returning(),
            catch: (cause) =>
              new DatabaseError({
                message: `Failed to subscribe to newsletter: ${getErrorMessage(cause)}`,
                operation: 'insert',
                table: 'newsletter_subscribers',
              }),
          }),
        )

        if (result.length === 0) return { subscribed: false, email: normalizedEmail }

        const row = result[0]
        const config = yield* ConfigService

        if (row?.unsubscribeToken) {
          yield* attemptSubscriptionEmail(
            buildNewsletterWelcomeEmail({
              to: normalizedEmail,
              unsubscribeUrl: `${config.urls.frontend}/unsubscribe?token=${row.unsubscribeToken}`,
            }),
            'welcome',
          )
        }

        yield* notifyAdmin('subscribed', normalizedEmail)

        return { subscribed: true, email: normalizedEmail }
      }),
    )
    .handle('unsubscribe', ({ payload }) =>
      Effect.gen(function* () {
        const db = yield* Database
        const clock = yield* Clock.Clock
        const unsubscribedAt = new Date(yield* clock.currentTimeMillis)

        const result = yield* dieOnDatabaseError(
          Effect.tryPromise({
            try: () =>
              db
                .update(newsletterSubscribersTable)
                .set({ unsubscribedAt })
                .where(
                  and(
                    eq(newsletterSubscribersTable.unsubscribeToken, payload.token),
                    isNull(newsletterSubscribersTable.unsubscribedAt),
                  ),
                )
                .returning({
                  id: newsletterSubscribersTable.id,
                  email: newsletterSubscribersTable.email,
                  userId: newsletterSubscribersTable.userId,
                }),
            catch: (cause) =>
              new DatabaseError({
                message: `Failed to unsubscribe from newsletter: ${getErrorMessage(cause)}`,
                operation: 'update',
                table: 'newsletter_subscribers',
              }),
          }),
        )

        const transitioned = result[0]

        const subscriber =
          transitioned ??
          (yield* dieOnDatabaseError(
            Effect.tryPromise({
              try: () =>
                db
                  .select({
                    id: newsletterSubscribersTable.id,
                    email: newsletterSubscribersTable.email,
                    userId: newsletterSubscribersTable.userId,
                  })
                  .from(newsletterSubscribersTable)
                  .where(eq(newsletterSubscribersTable.unsubscribeToken, payload.token))
                  .limit(1),
              catch: (cause) =>
                new DatabaseError({
                  message: `Failed to look up newsletter subscriber: ${getErrorMessage(cause)}`,
                  operation: 'select',
                  table: 'newsletter_subscribers',
                }),
            }),
          ))[0]

        if (!subscriber) return yield* new HttpApiError.NotFound()

        const subscriberUserId = subscriber.userId

        if (subscriberUserId) {
          yield* dieOnDatabaseError(
            Effect.tryPromise({
              try: () => globalUnsubscribe(subscriberUserId, db),
              catch: (cause) =>
                new DatabaseError({
                  message: `Failed to propagate newsletter unsubscribe: ${getErrorMessage(cause)}`,
                  operation: 'update',
                  table: 'user_email_preferences',
                }),
            }),
          )
        }

        if (transitioned) yield* notifyAdmin('unsubscribed', subscriber.email)

        return { success: true }
      }),
    )
    .handle('requestUnsubscribe', ({ payload }) =>
      Effect.gen(function* () {
        const db = yield* Database
        const normalizedEmail = payload.email.trim().toLowerCase()

        const [row] = yield* dieOnDatabaseError(
          Effect.tryPromise({
            try: () =>
              db
                .select({ unsubscribeToken: newsletterSubscribersTable.unsubscribeToken })
                .from(newsletterSubscribersTable)
                .where(
                  and(
                    eq(newsletterSubscribersTable.email, normalizedEmail),
                    isNull(newsletterSubscribersTable.unsubscribedAt),
                  ),
                )
                .limit(1),
            catch: (cause) =>
              new DatabaseError({
                message: `Failed to look up newsletter subscriber: ${getErrorMessage(cause)}`,
                operation: 'select',
                table: 'newsletter_subscribers',
              }),
          }),
        )

        if (row?.unsubscribeToken) {
          const config = yield* ConfigService
          yield* attemptSubscriptionEmail(
            buildNewsletterUnsubscribeLinkEmail({
              to: normalizedEmail,
              unsubscribeUrl: `${config.urls.frontend}/unsubscribe?token=${row.unsubscribeToken}`,
            }),
            'unsubscribe-link',
          )
        }

        return { sent: true }
      }),
    ),
)
