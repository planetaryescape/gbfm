import type { CloudflareOptions } from '@sentry/cloudflare'
import { Option, Schema } from 'effect'

import { routeTemplate } from '../telemetry/privacy'

type Log = Parameters<NonNullable<CloudflareOptions['beforeSendLog']>>[0]

const attributes = Schema.decodeUnknownOption(
  Schema.Struct({
    service: Schema.Literal('www'),
    requestId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
    route: Schema.String,
    method: Schema.Literals(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
    release: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
    status: Schema.Number,
    durationMs: Schema.Number,
    'sentry.trace.parent_span_id': Schema.optional(
      Schema.String.check(Schema.isPattern(/^[a-f0-9]{16}$/)),
    ),
  }),
)

export const sanitizeServerLog = (log: Log): Log | null => {
  if (!['www.request.completed', 'www.request.failed'].includes(String(log.message))) return null
  const decoded = attributes(log.attributes)

  if (Option.isNone(decoded)) return null

  return {
    level: log.level,
    message: log.message,
    attributes: { ...decoded.value, route: routeTemplate(undefined, decoded.value.route) },
  }
}
