import type { ErrorEvent, SpanJSON } from '@sentry/core'
import { expect, test } from 'vitest'

import { sanitizeOAuthBreadcrumb, sanitizeOAuthEvent, sanitizeOAuthSpan } from './oauth-telemetry'

test('OAuth request capture excludes authorization queries, headers, cookies and bodies', () => {
  const marker = 'synthetic-private-value'

  const event: ErrorEvent = {
    type: undefined,
    event_id: 'fixture-event',
    request: {
      url: `https://api.example.test/auth/oauth2/authorize?code=${marker}`,
      method: 'POST',
      headers: { authorization: marker },
      cookies: { session: marker },
      data: { token: marker },
      query_string: `code=${marker}`,
    },
  }

  const sanitized = sanitizeOAuthEvent(event)

  expect(sanitized.event_id).toBe('fixture-event')
  expect(sanitized.request).toEqual({
    url: 'https://api.example.test/auth/oauth2/authorize',
    method: 'POST',
  })
  expect(JSON.stringify(sanitized)).not.toContain(marker)
  expect(event.request?.data).toEqual({ token: marker })
})

test('OAuth HTTP span capture excludes signed queries and token or draft bodies', () => {
  const marker = 'synthetic-private-value'

  const span: SpanJSON = {
    span_id: '1234567890abcdef',
    trace_id: '1234567890abcdef1234567890abcdef',
    start_timestamp: 1,
    timestamp: 2,
    description: `POST https://api.example.test/mcp?code=${marker}`,
    data: {
      'url.full': `https://api.example.test/mcp?code=${marker}`,
      'url.query': marker,
      'http.request.header.authorization': marker,
      'http.response.header.set-cookie': marker,
      'http.request.body': marker,
      'http.response.body': marker,
      'http.request.method': 'POST',
      'http.response.status_code': 200,
    },
  }

  const sanitized = sanitizeOAuthSpan(span)

  expect(JSON.stringify(sanitized)).not.toContain(marker)
  expect(sanitized.data['http.response.status_code']).toBe(200)
  expect(sanitized.data['url.full']).toBe('https://api.example.test/mcp')
})

test('sensitive request capture omits payload-bearing exception and context fields', () => {
  const marker = 'synthetic-private-value'

  const event: ErrorEvent = {
    type: undefined,
    request: { url: 'https://api.example.test/mcp' },
    message: marker,
    extra: { body: marker },
    contexts: { request_body: { value: marker } },
    exception: { values: [{ type: 'Error', value: marker }] },
  }

  expect(JSON.stringify(sanitizeOAuthEvent(event))).not.toContain(marker)
})

test('OAuth breadcrumbs are scrubbed even on an unrelated parent event', () => {
  const marker = 'synthetic-private-value'

  const event: ErrorEvent = {
    type: undefined,
    request: { url: 'https://api.example.test/health' },
    breadcrumbs: [
      {
        category: 'http',
        data: {
          url: `https://api.example.test/auth/oauth2/authorize?code=${marker}`,
          body: marker,
        },
      },
    ],
  }

  expect(JSON.stringify(sanitizeOAuthEvent(event))).not.toContain(marker)
})

test('unrelated request telemetry retains its existing behavior', () => {
  const event: ErrorEvent = {
    type: undefined,
    request: { url: 'https://api.example.test/health?ready=true' },
  }

  expect(sanitizeOAuthEvent(event).request).toBe(event.request)
})

test('relative HTTP targets and both navigation endpoints cannot leak OAuth queries', () => {
  const marker = 'synthetic-relative-secret'

  const span: SpanJSON = {
    span_id: '1234567890abcdef',
    trace_id: '1234567890abcdef1234567890abcdef',
    start_timestamp: 1,
    timestamp: 2,
    description: `GET /auth/oauth2/authorize?code=${marker}`,
    data: { 'http.target': `/auth/oauth2/authorize?code=${marker}`, 'http.request.body': marker },
  }

  expect(JSON.stringify(sanitizeOAuthSpan(span))).not.toContain(marker)
  expect(sanitizeOAuthSpan(span).data['url.full']).toBe('/auth/oauth2/authorize')
  expect(
    JSON.stringify(
      sanitizeOAuthBreadcrumb({ message: `GET /auth/oauth2/authorize?code=${marker}` }),
    ),
  ).not.toContain(marker)

  for (const data of [
    { to: `/connect/gbfm?sig=${marker}`, from: '/dashboard' },
    { to: '/dashboard', from: `/connect/gbfm?sig=${marker}` },
    { url: '/health', to: `/auth/oauth2/token?code=${marker}` },
  ]) {
    const result = sanitizeOAuthBreadcrumb({ category: 'navigation', data, message: marker })
    expect(JSON.stringify(result)).not.toContain(marker)
    expect(result.data).not.toHaveProperty('from')
  }
})
