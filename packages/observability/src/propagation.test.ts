import { expect, test } from 'vitest'

import {
  propagatedHeaders,
  propagatedRequest,
  remoteTraceContext,
  tracePropagationTargets,
} from './propagation'

const traceId = '11111111111111111111111111111111'

const spanId = '2222222222222222'

test('SDK propagation matches complete trusted origins, never lookalikes or third parties', () => {
  const targets = tracePropagationTargets({
    origin: 'https://preview.goosebumps.fm',
    apiUrl: 'http://127.0.0.1:3003',
    development: true,
  })

  const matches = (url: string) => targets.some((pattern) => pattern.test(url))

  for (const url of [
    'https://goosebumps.fm/api/content',
    'https://api.goosebumps.fm/api/content',
    'https://preview.goosebumps.fm/tweets',
    'http://127.0.0.1:3003/api/content',
  ])
    expect(matches(url)).toBe(true)

  for (const url of [
    'https://api.goosebumps.fm.attacker.test/api',
    'https://api.goosebumps.fm@attacker.test/api',
    'https://attacker.test/?next=https://api.goosebumps.fm',
    'https://open.spotify.com/track/example',
    'https://cdn.goosebumps.fm/music/example.mp3',
    'http://127.0.0.1:30030/api',
  ])
    expect(matches(url)).toBe(false)
  expect(
    tracePropagationTargets({ apiUrl: 'http://127.0.0.1:3003', development: false }).some(
      (pattern) => pattern.test('http://127.0.0.1:3003/api'),
    ),
  ).toBe(false)
})

test('Sentry and W3C context agree across Effect, including conflicting B3 input', () => {
  const headers = propagatedHeaders(
    new Headers({
      'sentry-trace': `${traceId}-${spanId}-1`,
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00',
      b3: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-0',
      cookie: 'preserved',
    }),
  )

  expect(headers.get('traceparent')).toBe(`00-${traceId}-${spanId}-01`)
  expect(headers.get('sentry-trace')).toBe(`${traceId}-${spanId}-1`)
  expect(headers.has('b3')).toBe(false)
  expect(headers.get('cookie')).toBe('preserved')
  expect(remoteTraceContext(headers)).toEqual({ traceId, spanId, sampled: true })
})

test('W3C-only callers are continued by Sentry without changing their sampling decision', () => {
  const headers = propagatedHeaders(new Headers({ traceparent: `00-${traceId}-${spanId}-00` }))
  expect(headers.get('sentry-trace')).toBe(`${traceId}-${spanId}-0`)
  expect(remoteTraceContext(headers)).toEqual({ traceId, spanId, sampled: false })
})

test('an undecided Sentry parent does not force the production sampler to record', () => {
  const headers = propagatedHeaders(new Headers({ 'sentry-trace': `${traceId}-${spanId}` }))
  expect(headers.get('sentry-trace')).toBe(`${traceId}-${spanId}`)
  expect(headers.has('traceparent')).toBe(false)
  expect(remoteTraceContext(headers)).toEqual({ traceId, spanId })
})

test('invalid Sentry context falls back to a valid W3C parent', () => {
  const headers = propagatedHeaders(
    new Headers({
      'sentry-trace': `00000000000000000000000000000000-${spanId}-1`,
      traceparent: `00-${traceId}-${spanId}-00`,
    }),
  )

  expect(headers.get('sentry-trace')).toBe(`${traceId}-${spanId}-0`)
})

test('B3 headers cannot bypass normalized or absent parent context', () => {
  for (const sentry of ['invalid', `${traceId}-${spanId}-0`]) {
    const headers = propagatedHeaders(
      new Headers({
        'sentry-trace': sentry,
        b3: `${traceId}-${spanId}-1`,
        'x-b3-traceid': traceId,
        'x-b3-spanid': spanId,
        'x-b3-sampled': '1',
      }),
    )

    expect([...headers.keys()].some((key) => key === 'b3' || key.startsWith('x-b3-'))).toBe(false)
  }
})

test('only bounded reviewed dynamic sampling metadata crosses service boundaries', () => {
  const secret = 'synthetic-secret-do-not-propagate'

  const headers = propagatedHeaders(
    new Headers({
      'sentry-trace': `${traceId}-${spanId}-1`,
      baggage: `customer=${secret},sentry-transaction=${secret},sentry-user_segment=${secret},sentry-trace_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,sentry-sampled=true,sentry-environment=production,sentry-public_key=abc123`,
      tracestate: `vendor=${secret}`,
    }),
  )

  expect(headers.get('baggage')).toBe(
    `sentry-trace_id=${traceId},sentry-sampled=true,sentry-environment=production,sentry-public_key=abc123`,
  )
  expect(JSON.stringify([...headers])).not.toContain(secret)
})

test('malformed or zero trace identifiers cannot create a remote parent', () => {
  for (const value of [
    'invalid',
    `00000000000000000000000000000000-${spanId}-1`,
    `${traceId}-0000000000000000-1`,
  ]) {
    const headers = propagatedHeaders(
      new Headers({ 'sentry-trace': value, baggage: 'sentry-sampled=true' }),
    )

    expect(headers.has('sentry-trace')).toBe(false)
    expect(headers.has('traceparent')).toBe(false)
    expect(headers.has('baggage')).toBe(false)
    expect(remoteTraceContext(headers)).toBeUndefined()
  }
})

test('normalizing a request preserves its method, body, headers and abort ownership', async () => {
  const controller = new AbortController()

  const request = propagatedRequest(
    new Request('https://api.goosebumps.fm/api/example', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sentry-trace': `${traceId}-${spanId}-1` },
      body: '{"fixture":true}',
      signal: controller.signal,
    }),
  )

  expect(request.method).toBe('POST')
  expect(await request.text()).toBe('{"fixture":true}')
  expect(request.headers.get('content-type')).toBe('application/json')
  controller.abort()
  expect(request.signal.aborted).toBe(true)
})
