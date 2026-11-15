import { expect, test } from 'vitest'

import { sanitizeServerLog } from './server-logs'

const attributes = {
  service: 'www',
  requestId: 'fixture',
  route: '/tweet/synthetic-secret-do-not-export',
  method: 'GET',
  release: 'a'.repeat(40),
  status: 200,
  durationMs: 12,
}

test('server logs retain reviewed correlation fields and discard arbitrary request data', () => {
  const log = sanitizeServerLog({
    level: 'info',
    message: 'www.request.completed',
    attributes: {
      ...attributes,
      cookie: 'synthetic-secret-do-not-export',
      'sentry.trace.parent_span_id': 'b'.repeat(16),
    },
  })

  expect(log?.attributes?.route).toBe('/tweet/:slug')
  expect(log?.attributes?.['sentry.trace.parent_span_id']).toBe('b'.repeat(16))
  expect(JSON.stringify(log)).not.toContain('synthetic-secret-do-not-export')
})

test('unreviewed messages and malformed correlation attributes are not exported', () => {
  expect(
    sanitizeServerLog({ level: 'error', message: 'synthetic-secret-do-not-export', attributes }),
  ).toBeNull()
  expect(
    sanitizeServerLog({
      level: 'info',
      message: 'www.request.completed',
      attributes: { ...attributes, requestId: 'unsafe@example.test' },
    }),
  ).toBeNull()
  expect(
    sanitizeServerLog({
      level: 'info',
      message: 'www.request.completed',
      attributes: { ...attributes, 'sentry.trace.parent_span_id': 'invalid' },
    }),
  ).toBeNull()
})
