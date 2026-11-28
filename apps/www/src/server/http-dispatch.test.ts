import { once } from 'node:events'
import { createServer } from 'node:http'

import { Predicate } from 'effect'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { toWebRequest, writeWebResponse } from '../../plugins/effect-ui-node'
import { parseRoute, Route } from '../route'
import { dispatchHttp, type PageHandler } from './http-dispatch'
import { Responded } from './http-result'
import { preparePageResponse } from './prepare-page-response'

const received: Array<{
  readonly pathname: string
  readonly method: string
  readonly headers: Headers
  readonly body: string
}> = []

const fixtureResponse = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const body = await request.text()
  received.push({
    pathname: url.pathname,
    method: request.method,
    headers: request.headers,
    body,
  })

  if (url.pathname === '/auth/get-session') {
    const cookie = request.headers.get('cookie') ?? ''

    if (cookie.includes('identity-unavailable'))
      return Response.json(
        { error: 'Fixture identity unavailable' },
        { status: 503, headers: { 'set-cookie': 'identity-unavailable=1; HttpOnly' } },
      )

    if (cookie.includes('identity-malformed'))
      return new Response('not-json', { headers: { 'content-type': 'application/json' } })

    if (cookie.includes('creator-fixture')) {
      const headers = new Headers()
      headers.append('set-cookie', 'rotation=identity; HttpOnly; Path=/')
      headers.append('set-cookie', 'identity-only=present; HttpOnly; Path=/')

      return Response.json(
        {
          user: {
            id: 'fixture-author',
            name: 'Creator',
            username: 'creator',
            role: 'creator',
          },
        },
        { headers },
      )
    }

    return Response.json({
      user: { id: 'fixture-user', name: 'Listener', username: 'listener', role: 'user' },
    })
  }

  if (url.pathname === '/api/content/post') {
    const headers = new Headers()
    headers.append('set-cookie', 'rotation=content; HttpOnly; Path=/')
    headers.append('set-cookie', 'save-only=present; HttpOnly; Path=/')

    return Response.json({ slug: 'saved-editorial' }, { headers })
  }

  if (url.pathname === '/api/content/posts/conflicted-editorial')
    return Response.json({ error: 'Fixture revision conflict' }, { status: 409 })

  if (url.pathname === '/api/content/posts/micro/latest')
    return Response.json({ slug: 'fixture-latest' })

  if (url.pathname === '/auth/oauth2/authorize')
    return new Response(null, {
      status: 303,
      headers: {
        location: 'https://client.fixture.test/callback?code=fixture',
        'set-cookie': 'oauth-flow=fixture; HttpOnly',
      },
    })

  if (url.pathname === '/api/favorites')
    return Response.json({ success: true, total: 0, favorites: [] })

  if (url.pathname === '/api/echo') {
    const headers = new Headers({ 'content-type': 'text/plain' })
    headers.append('set-cookie', 'api-first=1; HttpOnly')
    headers.append('set-cookie', 'api-second=2; HttpOnly')

    return new Response(body || url.search, { status: 202, headers })
  }

  return new Response('Fixture not found', { status: 404 })
}

const previousTarget = process.env.VPS_PROXY_TARGET

const server = createServer((incoming, outgoing) => {
  void fixtureResponse(
    toWebRequest(
      new URL(incoming.url ?? '/', 'http://api.fixture.test'),
      incoming,
      new AbortController().signal,
    ),
  )
    .then((response) => writeWebResponse(response, outgoing))
    .catch(() => outgoing.destroy())
})

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  if (!address || Predicate.isString(address)) throw new Error('Missing API fixture address')
  process.env.VPS_PROXY_TARGET = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  if (previousTarget === undefined) delete process.env.VPS_PROXY_TARGET
  else process.env.VPS_PROXY_TARGET = previousTarget
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
})

const refusePage: PageHandler<Responded> = async () => {
  throw new Error('This HTTP response must not render the application')
}

const nativeData: PageHandler<Responded> = async (request, dataRequest, startedAt, page) => {
  const prepared = await preparePageResponse(request, startedAt, page)

  return Responded(
    Response.json(
      {
        dataRequest,
        origin: page.url.origin,
        pathname: page.url.pathname,
        search: page.url.search,
        requestId: request.headers.get('x-request-id'),
        document: prepared.document,
      },
      { status: prepared.status, headers: prepared.headers },
    ),
  )
}

test('dispatches normalized page requests and JSON navigation to the supplied renderer', async () => {
  const result = await dispatchHttp(
    new Request('https://www.fixture.test/about?__data=1&keep=value', {
      headers: { 'x-request-id': 'owned-dispatch-fixture' },
    }),
    nativeData,
  )

  expect(result.response.status).toBe(200)
  expect(result.response.headers.get('cache-control')).toBe('private, no-store')
  expect(await result.response.json()).toMatchObject({
    dataRequest: true,
    pathname: '/about',
    search: '?keep=value',
    requestId: 'owned-dispatch-fixture',
    document: { status: 200, principal: null, principalKnown: true },
  })
})

test('native dispatch does not replace the request origin with unvalidated forwarding headers', async () => {
  const result = await dispatchHttp(
    new Request('https://www.fixture.test/about?__data=1', {
      headers: {
        host: 'untrusted.example',
        'x-forwarded-host': 'untrusted.example',
        'x-forwarded-proto': 'http',
      },
    }),
    nativeData,
  )

  expect(result.response.status).toBe(200)
  expect(await result.response.json()).toMatchObject({
    origin: 'https://www.fixture.test',
    pathname: '/about',
    dataRequest: true,
  })
})

test('keeps an adapter-validated origin authoritative over forwarded development headers', async () => {
  const url = new URL('https://www.fixture.test/about?__data=1')

  const result = await dispatchHttp(
    new Request(url, {
      headers: {
        host: 'untrusted.example',
        'x-forwarded-host': 'untrusted.example',
        'x-forwarded-proto': 'http',
      },
    }),
    nativeData,
    { url, route: parseRoute(url.pathname) },
  )

  expect(result.response.status).toBe(200)
  expect(await result.response.json()).toMatchObject({
    document: { url: 'https://www.fixture.test/about' },
  })
})

test.each(['/dashboard/users', '/dashboard/users?__data=1'])(
  'renders administrator denial without changing the existing page HTTP contract for %s',
  async (path) => {
    const before = received.length

    const result = await dispatchHttp(
      new Request(`https://www.fixture.test${path}`, {
        headers: { cookie: 'session_token=creator-fixture' },
      }),
      nativeData,
    )

    expect(result.response.status).toBe(200)
    expect(result.response.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.response.json()).toMatchObject({
      dataRequest: path.includes('__data=1'),
      document: {
        status: 200,
        principal: { id: 'fixture-author', role: 'creator' },
        dashboard: { rows: [], fields: {}, toggles: {} },
      },
    })
    expect(received.slice(before).map(({ pathname }) => pathname)).toEqual(['/auth/get-session'])
  },
)

test('classifies the callback alias before loading a private dashboard or login redirect', async () => {
  const url = new URL(
    'https://www.fixture.test/dashboard/spotify-callback?code=synthetic-code&state=synthetic-state',
  )

  const result = await dispatchHttp(new Request(url), nativeData, {
    url,
    route: Route.cases.Static.make({ page: 'spotify-callback' }),
  })

  expect(result.response.status).toBe(200)
  expect(result.response.headers.get('location')).toBeNull()
  expect(await result.response.json()).toMatchObject({
    document: { principal: null, principalKnown: true, dashboard: null },
  })
})

test.each([
  ['/tweet', '/tweets'],
  ['/tweet?__data=1', '/tweets?__data=1'],
  ['/tweet?visit=fixture-saved', '/tweet/fixture-saved'],
  ['/tweet?visit=latest', '/tweets'],
  ['/tweets?q=archive', '/tweets'],
  ['/tweet/new', '/new/tweet'],
  ['/tweet/latest?__data=1', '/tweet/fixture-latest?__data=1'],
])('preserves the redirect contract for %s', async (path, location) => {
  const result = await dispatchHttp(new Request(`https://www.fixture.test${path}`), refusePage)
  expect(result.response.status).toBe(303)
  expect(result.response.headers.get('location')).toBe(location)
  expect(result.response.headers.get('cache-control')).toBe('private, no-store')
})

test('forwards API bodies, credentials, request IDs and multiple response cookies', async () => {
  const result = await dispatchHttp(
    new Request('https://www.fixture.test/api/echo?keep=value', {
      method: 'POST',
      headers: {
        cookie: 'session_token=fixture',
        'x-request-id': 'forwarded-dispatch-fixture',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'body=streamed%20form',
    }),
    refusePage,
  )

  expect(result.response.status).toBe(202)
  expect(await result.response.text()).toBe('body=streamed%20form')
  expect(result.response.headers.getSetCookie()).toEqual([
    'api-first=1; HttpOnly',
    'api-second=2; HttpOnly',
  ])
  const forwarded = received.find((request) => request.pathname === '/api/echo')
  expect(forwarded?.method).toBe('POST')
  expect(forwarded?.headers.get('cookie')).toBe('session_token=fixture')
  expect(forwarded?.headers.get('x-request-id')).toBe('forwarded-dispatch-fixture')
})

test('cross-origin form actions remain forbidden before any API write', async () => {
  const before = received.length

  const result = await dispatchHttp(
    new Request('https://www.fixture.test/actions/admin/remove-user', {
      method: 'POST',
      headers: {
        origin: 'https://other.fixture.test',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'userId=fixture-user',
    }),
    refusePage,
  )

  expect(result.response.status).toBe(403)
  expect(received).toHaveLength(before)
})

test('OAuth authorization redirects remain manual and preserve their response cookie', async () => {
  const result = await dispatchHttp(
    new Request(
      'https://www.fixture.test/auth/oauth2/authorize?redirect_uri=https%3A%2F%2Fclient.fixture.test%2Fcallback',
    ),
    refusePage,
  )

  expect(result.response.status).toBe(303)
  expect(result.response.headers.get('location')).toBe(
    'https://client.fixture.test/callback?code=fixture',
  )
  expect(result.response.headers.getSetCookie()).toEqual(['oauth-flow=fixture; HttpOnly'])
})

test('connection errors retain the standalone document and restrictive security policy', async () => {
  const result = await dispatchHttp(
    new Request('https://www.fixture.test/connect/gbfm'),
    refusePage,
  )

  expect(result.response.status).toBe(400)
  expect(result.response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(result.response.headers.get('cache-control')).toBe('private, no-store')
  expect(result.response.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(result.response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
})

test('mosaic routing retains its own method and origin checks before generic form actions', async () => {
  const before = received.length

  const get = await dispatchHttp(new Request('https://www.fixture.test/actions/mosaic'), refusePage)

  expect(get.response.status).toBe(405)
  expect(get.response.headers.get('allow')).toBe('POST')

  const crossOrigin = await dispatchHttp(
    new Request('https://www.fixture.test/actions/mosaic', {
      method: 'POST',
      headers: { origin: 'https://other.fixture.test', 'content-type': 'application/json' },
      body: '{"content":"fixture"}',
    }),
    refusePage,
  )

  expect(crossOrigin.response.status).toBe(403)
  expect(received).toHaveLength(before)
})

test('authenticated account pages retain safe-return redirects', async () => {
  const result = await dispatchHttp(
    new Request('https://www.fixture.test/auth/sign-in?returnTo=%2Fdashboard', {
      headers: { cookie: 'session_token=fixture' },
    }),
    refusePage,
  )

  expect(result.response.status).toBe(303)
  expect(result.response.headers.get('location')).toBe('/dashboard')
})

test('non-admin requests never load an administrator dashboard endpoint', async () => {
  const before = received.length

  const result = await dispatchHttp(
    new Request('https://www.fixture.test/dashboard/users', {
      headers: { cookie: 'session_token=fixture' },
    }),
    nativeData,
  )

  expect(result.response.status).toBe(200)
  expect(await result.response.json()).toMatchObject({
    document: {
      principal: { role: 'user' },
      dashboard: { rows: [], fields: {}, toggles: {} },
    },
  })
  expect(received.slice(before).map((request) => request.pathname)).toEqual(['/auth/get-session'])
})

test('development telemetry and social-image responses bypass page rendering', async () => {
  const telemetry = await dispatchHttp(
    new Request('https://www.fixture.test/telemetry/browser', { method: 'POST' }),
    refusePage,
  )

  expect(telemetry.response.status).toBe(204)

  const social = await dispatchHttp(
    new Request('https://www.fixture.test/social/cards/fixture'),
    refusePage,
  )

  expect(social.response.status).toBe(404)
})

test.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])(
  'ordinary page requests still refuse unsupported %s methods',
  async (method) => {
    const result = await dispatchHttp(
      new Request('https://www.fixture.test/about', { method }),
      refusePage,
    )

    expect(result.response.status).toBe(405)
  },
)

const draftFields = {
  kind: 'post',
  title: 'Fixture editorial',
  slug: 'fixture-editorial',
  content: 'Fixture draft body',
  tags: 'fixture',
  intent: 'draft',
}

const creatorRequest = (
  fields: Readonly<Record<string, string>> = draftFields,
  cookie = 'session_token=creator-fixture',
  origin = 'https://www.fixture.test',
) =>
  new Request('https://www.fixture.test/actions/creator/save', {
    method: 'POST',
    headers: { origin, cookie, 'x-request-id': 'creator-dispatch-fixture' },
    body: new URLSearchParams(fields),
  })

test('creator registration refuses anonymous form submissions without an API write', async () => {
  const before = received.length
  const result = await dispatchHttp(creatorRequest(draftFields, ''), refusePage)
  expect(result.response.status).toBe(403)
  expect(received).toHaveLength(before)
})

test('creator registration refuses external origins before identity lookup or form consumption', async () => {
  const before = received.length

  const result = await dispatchHttp(
    creatorRequest(draftFields, 'session_token=creator-fixture', 'https://other.fixture.test'),
    refusePage,
  )

  expect(result.response.status).toBe(403)
  expect(received).toHaveLength(before)
})

test('creator registration cannot promote an authenticated non-creator from submitted fields', async () => {
  const before = received.length

  const result = await dispatchHttp(
    creatorRequest({ ...draftFields, role: 'admin' }, 'session_token=fixture'),
    refusePage,
  )

  expect(result.response.status).toBe(403)
  expect(received.slice(before).map((request) => request.pathname)).toEqual(['/auth/get-session'])
})

test('creator registration forwards a role-allowed draft once and orders identity cookies before save cookies', async () => {
  const before = received.length
  const result = await dispatchHttp(creatorRequest(), refusePage)
  expect(result.response.status).toBe(303)
  expect(result.response.headers.get('location')).toBe('/new/editorial?edit=saved-editorial')
  expect(result.response.headers.get('cache-control')).toBe('private, no-store')
  expect(result.response.headers.getSetCookie()).toEqual([
    'rotation=identity; HttpOnly; Path=/',
    'identity-only=present; HttpOnly; Path=/',
    'rotation=content; HttpOnly; Path=/',
    'save-only=present; HttpOnly; Path=/',
  ])
  const calls = received.slice(before)
  expect(calls.map((request) => [request.method, request.pathname])).toEqual([
    ['GET', '/auth/get-session'],
    ['POST', '/api/content/post'],
  ])
  expect(calls[1]?.headers.get('cookie')).toBe('session_token=creator-fixture')
  expect(calls[1]?.headers.get('origin')).toBe('https://www.fixture.test')
  expect(calls[1]?.headers.get('x-request-id')).toBe('creator-dispatch-fixture')
  expect(JSON.parse(calls[1]?.body ?? 'null')).toMatchObject({
    type: 'post',
    title: 'Fixture editorial',
    slug: 'fixture-editorial',
    content: 'Fixture draft body',
    draft: true,
    tags: ['fixture'],
    creatorIds: ['fixture-author'],
  })
})

test('creator registration preserves backend revision conflicts and submitted writing', async () => {
  const before = received.length

  const result = await dispatchHttp(
    creatorRequest({
      ...draftFields,
      editSlug: 'conflicted-editorial',
      expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
    }),
    refusePage,
  )

  expect(result.response.status).toBe(409)
  expect(result.response.headers.get('cache-control')).toBe('private, no-store')
  expect(await result.response.text()).toContain('Fixture draft body')
  const write = received.slice(before).find((request) => request.method === 'PATCH')
  expect(write?.pathname).toBe('/api/content/posts/conflicted-editorial')
  expect(JSON.parse(write?.body ?? 'null')).toMatchObject({
    expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
    draft: true,
  })
})

test('creator registration requires explicit publish confirmation before any content write', async () => {
  const before = received.length

  const result = await dispatchHttp(
    creatorRequest({ ...draftFields, intent: 'publish' }),
    refusePage,
  )

  expect(result.response.status).toBe(422)
  expect(await result.response.text()).toContain('Confirm that this content should be public.')
  expect(received.slice(before).map((request) => request.pathname)).toEqual(['/auth/get-session'])
})

test.each(['identity-unavailable', 'identity-malformed'])(
  'creator registration fails closed when identity lookup fails: %s',
  async (identity) => {
    const before = received.length

    const result = await dispatchHttp(
      creatorRequest(draftFields, `session_token=${identity}`),
      refusePage,
    )

    expect(result.response.status).toBe(503)
    expect(result.response.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.response.text()).not.toContain('Fixture draft body')
    expect(received.slice(before).map((request) => request.pathname)).toEqual(['/auth/get-session'])
  },
)
