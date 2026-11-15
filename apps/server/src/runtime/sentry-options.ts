import { traceSampleRate } from '@gbfm/core/observability/trace-sampling'
import type { CloudflareOptions } from '@sentry/cloudflare'

import { sanitizeDatabaseSpan } from '@/lib/database-telemetry'
import {
  sanitizeOAuthBreadcrumb,
  sanitizeOAuthEvent,
  sanitizeOAuthSpan,
} from '@/lib/oauth-telemetry'
import { omitUndefined } from '@/lib/omit-undefined'
import { hasLocalSentryContext, shouldEnableSentry } from '@/lib/sentry'

export const workerSentryOptions = (env: {
  readonly SENTRY_DSN?: string
  readonly SENTRY_ENVIRONMENT?: string
}): CloudflareOptions => {
  const dsn = env.SENTRY_DSN ?? ''
  const environment = env.SENTRY_ENVIRONMENT ?? 'development'

  if (!shouldEnableSentry(dsn, environment)) return { enabled: false }

  return {
    dsn,
    environment,
    tracesSampler: ({ inheritOrSampleWith, name, normalizedRequest }) =>
      inheritOrSampleWith(traceSampleRate(omitUndefined({ name, url: normalizedRequest?.url }))),
    sendDefaultPii: false,
    enableLogs: true,
    beforeBreadcrumb: sanitizeOAuthBreadcrumb,
    beforeSendSpan: (span) => sanitizeOAuthSpan(sanitizeDatabaseSpan(span)),
    beforeSend: (event) => (hasLocalSentryContext(event) ? null : sanitizeOAuthEvent(event)),
    beforeSendTransaction: (event) =>
      hasLocalSentryContext(event) ? null : sanitizeOAuthEvent(event),
  }
}
