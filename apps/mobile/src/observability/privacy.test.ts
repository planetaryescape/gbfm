import { expect, test } from 'vitest'

import { safeBreadcrumb, safeMetric, safeSpan, sanitizeError, sanitizeTransaction } from './privacy'

const secret = 'synthetic-secret-do-not-export'

test('JS errors retain authored stack locations but discard request, identity, nested values and locals', () => {
  const event = sanitizeError({
    type: undefined,
    event_id: 'event-one',
    release: 'fm.goosebumps.gbfm@1.0.0+1',
    user: { email: secret },
    request: { url: `https://api.test/?key=${secret}`, headers: { authorization: secret } },
    extra: { cause: { token: secret } },
    contexts: { private: { value: secret } },
    message: secret,
    exception: {
      values: [
        {
          type: 'TypeError',
          value: secret,
          stacktrace: {
            frames: [
              {
                filename: `app:///index.js?token=${secret}`,
                function: 'readPost',
                lineno: 10,
                vars: { token: secret },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', message: secret },
      {
        category: 'gbfm.journey',
        message: 'reader.open',
        data: { outcome: 'succeeded', token: secret },
      },
    ],
  })

  expect(JSON.stringify(event)).not.toContain(secret)
  expect(event.exception?.values?.[0]?.stacktrace?.frames).toEqual([
    { filename: 'app:///index.js', function: 'readPost', lineno: 10 },
  ])
  expect(event.breadcrumbs).toEqual([
    {
      category: 'gbfm.journey',
      message: 'reader.open',
      level: 'info',
      data: { outcome: 'succeeded' },
    },
  ])
})

test('automatic span and transaction metadata cannot export raw paths, SQL, or arbitrary context', () => {
  const span = safeSpan({
    description: `/tweets/${secret}`,
    data: { 'db.query.text': secret, 'http.url': secret },
  })

  const transaction = sanitizeTransaction({
    type: 'transaction',
    transaction: secret,
    request: { url: secret },
    extra: { value: secret },
    contexts: {
      trace: { trace_id: 'trace-one', span_id: 'span-one', data: { token: secret } },
      custom: { value: secret },
    },
  })

  expect(JSON.stringify({ span, transaction })).not.toContain(secret)
  expect(transaction.contexts?.trace?.trace_id).toBe('trace-one')
  expect(safeBreadcrumb({ category: 'navigation', data: { to: secret } })).toBeNull()
  expect(
    safeBreadcrumb({ category: 'gbfm.journey', message: secret, data: { outcome: secret } }),
  ).toMatchObject({ message: 'mobile.operation', data: { outcome: 'unknown' } })
})

test('behavior metrics keep bounded dimensions and drop ambient identity and other metric names', () => {
  const metric = safeMetric({
    name: 'gbfm.journey.completed',
    value: 1,
    type: 'counter',
    attributes: {
      operation: 'reader.open',
      outcome: 'succeeded',
      'user.id': secret,
      token: secret,
    },
  })

  expect(metric?.attributes).toEqual({ operation: 'reader.open', outcome: 'succeeded' })
  expect(JSON.stringify(metric)).not.toContain(secret)
  expect(safeMetric({ name: secret, value: 1, type: 'counter' })).toBeNull()
})
