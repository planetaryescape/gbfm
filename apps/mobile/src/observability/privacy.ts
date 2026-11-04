import type {
  Breadcrumb,
  ErrorEvent,
  Exception,
  Metric,
  StackFrame,
  TransactionEvent,
} from '@sentry/react-native'
import { flow, Option, Schema } from 'effect'

const safeJourneyName = flow(
  Schema.decodeUnknownOption(Schema.Literals(['reader.open', 'playback.start'])),
  Option.getOrElse(() => 'mobile.operation'),
)

const safeOutcome = flow(
  Schema.decodeUnknownOption(Schema.Literals(['succeeded', 'failed', 'canceled', 'empty'])),
  Option.getOrElse(() => 'unknown'),
)

const safeOperation = flow(
  Schema.decodeUnknownOption(
    Schema.Literals(['gbfm.journey', 'ui.load', 'navigation', 'app.start', 'http.client']),
  ),
  Option.getOrElse(() => 'mobile.operation'),
)

const errorTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'ReaderOpenFailed',
  'PlaybackStartFailed',
])

const metricIdentity = Schema.decodeUnknownOption(
  Schema.Struct({
    'sentry.release': Schema.optional(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^gbfm-mobile@[a-f0-9]{40}$/))),
    ),
    'sentry.environment': Schema.optional(
      Schema.Literals(['development', 'preview', 'production']),
    ),
  }),
)

const routes = new Set([
  '/',
  '/profile',
  '/archive',
  '/tweet/[slug]',
  '/replies/[slug]',
  '/show/[slug]',
  '/compose',
  '/sign-in',
  '/music-reminders',
  '/now-playing',
  '/expo-sharing',
])

const safeSpanName = (value: string | undefined) => {
  const route = value?.replace(/\/\([^/]+\)/g, '')

  return route && routes.has(route) ? route : safeJourneyName(value)
}

const safeFrame = (frame: StackFrame): StackFrame => {
  const clean: StackFrame = {}
  const filename = frame.filename?.split(/[?#]/)[0]

  if (filename) clean.filename = filename

  if (frame.function) clean.function = frame.function

  if (frame.lineno !== undefined) clean.lineno = frame.lineno

  if (frame.colno !== undefined) clean.colno = frame.colno

  if (frame.in_app !== undefined) clean.in_app = frame.in_app

  return clean
}

const safeException = (exception: Exception): Exception => {
  const clean: Exception = {
    type: errorTypes.has(exception.type ?? '') ? (exception.type ?? 'Error') : 'Error',
    value: 'Unexpected application error',
  }

  if (exception.mechanism?.handled !== undefined)
    clean.mechanism = { type: 'generic', handled: exception.mechanism.handled }

  if (exception.stacktrace?.frames)
    clean.stacktrace = { frames: exception.stacktrace.frames.map(safeFrame) }

  return clean
}

export const safeBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb | null => {
  if (breadcrumb.category !== 'gbfm.journey') return null

  const clean: Breadcrumb = {
    category: 'gbfm.journey',
    message: safeJourneyName(breadcrumb.message),
    level: 'info',
    data: { outcome: safeOutcome(breadcrumb.data?.outcome) },
  }

  if (breadcrumb.timestamp !== undefined) clean.timestamp = breadcrumb.timestamp

  return clean
}

const identity = (event: ErrorEvent | TransactionEvent): ErrorEvent => {
  const clean: ErrorEvent = { type: undefined }

  if (event.event_id !== undefined) clean.event_id = event.event_id

  if (event.timestamp !== undefined) clean.timestamp = event.timestamp

  if (event.platform !== undefined) clean.platform = event.platform

  if (event.release !== undefined) clean.release = event.release

  if (event.dist !== undefined) clean.dist = event.dist

  if (event.environment !== undefined) clean.environment = event.environment

  if (event.level !== undefined) clean.level = event.level

  if (event.sdk !== undefined) clean.sdk = event.sdk

  if (event.debug_meta !== undefined) clean.debug_meta = event.debug_meta

  const trace = event.contexts?.trace

  if (trace) {
    const context: NonNullable<NonNullable<ErrorEvent['contexts']>['trace']> = {
      trace_id: trace.trace_id,
      span_id: trace.span_id,
      op: safeOperation(trace.op),
      data: {
        'gbfm.operation': safeJourneyName(event.transaction),
        'gbfm.outcome': safeOutcome(trace.data?.['gbfm.outcome']),
      },
    }

    if (trace.parent_span_id) context.parent_span_id = trace.parent_span_id
    clean.contexts = { trace: context }
  }

  return clean
}

export const sanitizeError = (event: ErrorEvent): ErrorEvent => ({
  ...identity(event),
  exception: { values: (event.exception?.values ?? []).map(safeException) },
  breadcrumbs: (event.breadcrumbs ?? []).flatMap((breadcrumb) => {
    const safe = safeBreadcrumb(breadcrumb)

    return safe ? [safe] : []
  }),
})

export const sanitizeTransaction = (event: TransactionEvent): TransactionEvent => {
  const clean: TransactionEvent = {
    ...identity(event),
    type: 'transaction',
    transaction: safeSpanName(event.transaction),
  }

  if (event.start_timestamp !== undefined) clean.start_timestamp = event.start_timestamp

  if (event.spans) clean.spans = event.spans.map(safeSpan)

  if (event.measurements) clean.measurements = event.measurements

  return clean
}

export const safeSpan = <T extends { description?: string; data: Record<string, unknown> }>(
  span: T,
): T => ({
  ...span,
  description: safeSpanName(span.description),
  data: {
    'gbfm.operation': safeJourneyName(span.data['gbfm.operation']),
    'gbfm.outcome': safeOutcome(span.data['gbfm.outcome']),
  },
})

export const safeMetric = (metric: Metric): Metric | null => {
  if (!['gbfm.journey.completed', 'gbfm.journey.duration'].includes(metric.name)) return null

  return {
    ...metric,
    attributes: {
      ...Option.getOrElse(metricIdentity(metric.attributes), () => ({})),
      operation: safeJourneyName(metric.attributes?.operation),
      outcome: safeOutcome(metric.attributes?.outcome),
    },
  }
}
