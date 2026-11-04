import type { Breadcrumb, ErrorEvent, SpanJSON, TransactionEvent } from '@sentry/core'
import { Option, Schema } from 'effect'

import { omitUndefined } from './omit-undefined'

const sensitivePath = (pathname: string) =>
  pathname === '/mcp' ||
  pathname.startsWith('/auth/') ||
  pathname.startsWith('/connect/gbfm') ||
  pathname.startsWith('/api/user/mcp-connections')

const editorialUrl = (value: string | undefined) => {
  if (!value) return undefined
  const url = URL.parse(value, 'https://telemetry.invalid')

  return url && sensitivePath(url.pathname) ? url : undefined
}

const capturedString = Schema.decodeUnknownOption(Schema.String)

const capturedNumber = Schema.decodeUnknownOption(Schema.Number)

const safeUrl = (url: URL) =>
  url.origin === 'https://telemetry.invalid' ? url.pathname : `${url.origin}${url.pathname}`

const safeUrlText = (value: string | undefined) =>
  value?.replace(/(?:https?:\/\/|\/)[^\s"'<>]+/g, (candidate) => {
    const url = editorialUrl(candidate)

    return url ? safeUrl(url) : candidate
  })

export function sanitizeOAuthBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data

  const url = [data?.url, data?.['url.full'], data?.to, data?.from]
    .map((target) => editorialUrl(Option.getOrUndefined(capturedString(target))))
    .find((target) => target !== undefined)

  if (!url) return { ...breadcrumb, ...omitUndefined({ message: safeUrlText(breadcrumb.message) }) }

  return omitUndefined({
    category: breadcrumb.category,
    type: breadcrumb.type,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
    message: url.pathname,
    data: omitUndefined({
      url: safeUrl(url),
      method: Option.getOrUndefined(capturedString(data?.method)),
      status_code: Option.getOrUndefined(capturedNumber(data?.status_code)),
    }),
  })
}

export function sanitizeOAuthEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  const url = editorialUrl(event.request?.url)
  const breadcrumbs = event.breadcrumbs?.map(sanitizeOAuthBreadcrumb)

  const exception = event.exception
    ? url
      ? {
          values: event.exception.values?.map((value) => ({
            type: value.type,
            value: 'Editorial request failed',
            stacktrace: value.stacktrace
              ? {
                  frames: value.stacktrace.frames?.map((frame) => ({
                    filename: frame.filename,
                    function: frame.function,
                    lineno: frame.lineno,
                    colno: frame.colno,
                    in_app: frame.in_app,
                  })),
                }
              : undefined,
          })),
        }
      : {
          ...event.exception,
          values: event.exception.values?.map((value) => ({
            ...value,
            value: safeUrlText(value.value),
          })),
        }
    : undefined

  if (!url) return { ...event, breadcrumbs, message: safeUrlText(event.message), exception }
  const trace = event.contexts?.trace

  return {
    ...event,
    message: event.message ? 'Editorial request failed' : undefined,
    exception,
    extra: undefined,
    user: undefined,
    contexts: trace
      ? {
          trace: {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            op: trace.op,
            status: trace.status,
          },
        }
      : undefined,
    breadcrumbs,
    request: {
      url: safeUrl(url),
      method: event.request?.method,
    },
  }
}

export function sanitizeOAuthSpan(span: SpanJSON): SpanJSON {
  const url = [span.data['url.full'], span.data['http.url'], span.data['http.target']]
    .map((target) => editorialUrl(Option.getOrUndefined(capturedString(target))))
    .find((target) => target !== undefined)

  if (!url) return span

  const data = Object.fromEntries(
    Object.entries(span.data).filter(
      ([name]) =>
        !name.startsWith('url.') &&
        !name.startsWith('http.request.header') &&
        !name.startsWith('http.response.header') &&
        ![
          'http.url',
          'http.target',
          'http.query',
          'http.request.body',
          'http.response.body',
        ].includes(name),
    ),
  )

  return {
    ...span,
    description: url.pathname,
    data: { ...data, 'url.full': safeUrl(url) },
  }
}
