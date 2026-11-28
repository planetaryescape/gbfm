import { once } from 'node:events'
import { createServer } from 'node:http'

import { Predicate } from 'effect'
import { Miniflare, Response as FixtureResponse } from 'miniflare'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { createFixtureApiBinding, parseFixtureBase } from '../scripts/effect-ui-fixture-api'
import { toWebRequest, writeWebResponse } from './effect-ui-node'

const received: Array<{
  readonly target: string
  readonly method: string
  readonly headers: Headers
  readonly bytes: Array<number>
}> = []

const server = createServer((incoming, outgoing) => {
  const url = new URL('http://local.fixture.test')
  const raw = incoming.url ?? '/'
  const query = raw.indexOf('?')
  url.pathname = query < 0 ? raw : raw.slice(0, query)
  url.search = query < 0 ? '' : raw.slice(query)
  const request = toWebRequest(url, incoming, new AbortController().signal)
  void (async () => {
    const bytes = new Uint8Array(await request.arrayBuffer())
    received.push({
      target: raw,
      method: request.method,
      headers: request.headers,
      bytes: [...bytes],
    })

    const headers = new Headers({
      'content-type': 'application/octet-stream',
      'x-fixture-response': 'preserved',
    })

    headers.append('set-cookie', 'fixture-first=one; HttpOnly; Path=/')
    headers.append('set-cookie', 'fixture-second=two; HttpOnly; Path=/')

    if (url.pathname === '/forbidden')
      return writeWebResponse(
        new Response('Fixture authorization failed', { status: 401, headers }),
        outgoing,
      )

    if (url.pathname === '/redirect') {
      headers.set('location', 'https://must-not-fetch.invalid/callback')

      return writeWebResponse(new Response(null, { status: 303, headers }), outgoing)
    }

    return writeWebResponse(
      new Response(bytes, { status: 207, statusText: 'Fixture Multi Status', headers }),
      outgoing,
    )
  })().catch(() => outgoing.destroy())
})

const worker = `import { env } from 'cloudflare:workers'
export default {
  fetch(request) {
    const source = new URL(request.url)
    const target = new URL('https://api.internal')
    target.pathname = source.pathname
    target.search = source.search
    return env.API.fetch(new Request(target, request))
  }
}`

let runtime: Miniflare

let base: string

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  if (!address || Predicate.isString(address)) throw new Error('Missing local fixture address')
  base = `http://127.0.0.1:${address.port}`
  runtime = new Miniflare({
    workers: [
      {
        name: 'ssr',
        modules: true,
        script: worker,
        compatibilityDate: '2026-07-04',
        compatibilityFlags: ['nodejs_compat'],
        serviceBindings: { API: createFixtureApiBinding(base) },
        outboundService: () => new FixtureResponse(null, { status: 502 }),
      },
      {
        name: 'anonymous',
        modules: true,
        script: worker,
        compatibilityDate: '2026-07-04',
        compatibilityFlags: ['nodejs_compat'],
        serviceBindings: { API: createFixtureApiBinding(undefined) },
        outboundService: () => new FixtureResponse(null, { status: 502 }),
      },
    ],
  })
  await runtime.ready
})

afterAll(async () => {
  await runtime?.dispose()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
})

test('workerd forwards fixture path/query, identity headers and multipart bytes without changing the response', async () => {
  const body = new TextEncoder().encode(
    '--fixture-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.bin"\r\nContent-Type: application/octet-stream\r\n\r\nfixture\u0000bytes\r\n--fixture-boundary--\r\n',
  )

  const response = await runtime.dispatchFetch(
    'http://ssr.fixture.test/api/uploads/fixture?item=one&item=two&encoded=%2F',
    {
      method: 'POST',
      headers: {
        cookie: 'session_token=disposable-fixture',
        authorization: 'Bearer disposable-fixture',
        origin: 'http://127.0.0.1:5183',
        'x-request-id': 'workerd-fixture-forwarding',
        'content-type': 'multipart/form-data; boundary=fixture-boundary',
      },
      body,
    },
  )

  expect(response.status).toBe(207)
  expect(response.statusText).toBe('Fixture Multi Status')
  expect(response.headers.get('x-fixture-response')).toBe('preserved')
  expect(response.headers.getSetCookie()).toEqual([
    'fixture-first=one; HttpOnly; Path=/',
    'fixture-second=two; HttpOnly; Path=/',
  ])
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...body])
  const request = received.at(-1)
  expect(request?.target).toBe('/api/uploads/fixture?item=one&item=two&encoded=%2F')
  expect(request?.method).toBe('POST')
  expect(request?.headers.get('host')).toBe(new URL(base).host)
  expect(request?.headers.get('cookie')).toBe('session_token=disposable-fixture')
  expect(request?.headers.get('authorization')).toBe('Bearer disposable-fixture')
  expect(request?.headers.get('origin')).toBe('http://127.0.0.1:5183')
  expect(request?.headers.get('x-request-id')).toBe('workerd-fixture-forwarding')
  expect(request?.headers.get('content-type')).toBe(
    'multipart/form-data; boundary=fixture-boundary',
  )
  expect(request?.bytes).toEqual([...body])
})

test('fixture redirects remain manual, including redirects to a remote origin', async () => {
  const before = received.length

  const response = await runtime.dispatchFetch('http://ssr.fixture.test/redirect', {
    redirect: 'manual',
  })

  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('https://must-not-fetch.invalid/callback')
  expect(response.headers.getSetCookie()).toHaveLength(2)
  expect(received).toHaveLength(before + 1)
})

test('configured fixture authorization errors are preserved rather than becoming anonymous fallbacks', async () => {
  const response = await runtime.dispatchFetch('http://ssr.fixture.test/forbidden', {
    headers: { cookie: 'session_token=disposable-fixture' },
  })

  expect(response.status).toBe(401)
  expect(await response.text()).toBe('Fixture authorization failed')
  expect(response.headers.getSetCookie()).toHaveLength(2)
})

test('protocol-relative path text cannot replace the configured fixture origin', async () => {
  const response = await runtime.dispatchFetch(
    'http://ssr.fixture.test//must-not-fetch.invalid/api/fixture?keep=1',
  )

  expect(response.status).toBe(207)
  expect(received.at(-1)?.target).toBe('//must-not-fetch.invalid/api/fixture?keep=1')
  expect(received.at(-1)?.headers.get('host')).toBe(new URL(base).host)
})

test('an unconfigured API binding is anonymous-only and has no general API fallback', async () => {
  const anonymous = await runtime.getWorker('anonymous')

  const session = await anonymous.fetch('http://anonymous.fixture.test/auth/get-session', {
    headers: { cookie: 'session_token=disposable-fixture' },
  })

  expect(session.status).toBe(200)
  expect(await session.json()).toBeNull()
  expect(session.headers.get('cache-control')).toBe('private, no-store')

  const head = await anonymous.fetch('http://anonymous.fixture.test/auth/get-session', {
    method: 'HEAD',
  })

  expect(head.status).toBe(200)
  expect(await head.text()).toBe('')
  const missing = await anonymous.fetch('http://anonymous.fixture.test/api/content/homepage-mixes')
  expect(missing.status).toBe(404)
  expect(await missing.json()).toEqual({ error: 'Unconfigured local fixture endpoint' })

  const signIn = await anonymous.fetch('http://anonymous.fixture.test/auth/sign-in/email', {
    method: 'POST',
    body: '{}',
  })

  expect(signIn.status).toBe(404)
})

test.each([
  'not a URL',
  'https://goosebumps.fm',
  'http://goosebumps.fm:3013',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:0',
  'http://127.0.0.1',
  'http://user:password@127.0.0.1:3013',
  'http://127.0.0.1:3013/path',
  'http://127.0.0.1:3013?query=value',
  'http://127.0.0.1:3013#fragment',
])('rejects unsafe fixture configuration before requests can be forwarded: %s', (input) => {
  expect(() => createFixtureApiBinding(input)).toThrow()
})

test('accepts only explicit loopback fixture origins, with absent configuration staying absent', () => {
  expect(parseFixtureBase(undefined)).toBeUndefined()
  expect(parseFixtureBase('http://127.0.0.1:3013')?.origin).toBe('http://127.0.0.1:3013')
  expect(parseFixtureBase('http://[::1]:3013')?.origin).toBe('http://[::1]:3013')
})
