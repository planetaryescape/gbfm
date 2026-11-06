import { createServer } from 'node:http'

import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { handleFormAction } from '../../server/form-actions'
import { safeReturnPath } from '../auth/links'
import { handleConnection } from './server'

afterEach(() => vi.unstubAllEnvs())

const query = new URLSearchParams({
  client_id: 'disposable-client',
  scope: 'posts:read offline_access',
  redirect_uri: 'https://client.example.test/callback',
  exp: '9999999999',
  sig: 'disposable-signature',
})

for (const key of [...query.keys(), 'ba_param']) query.append('ba_param', key)

it('rejects unsigned continuations without weakening auth return paths', async () => {
  expect(
    safeReturnPath('/auth/oauth2/authorize?redirect_uri=https://evil.test', 'https://www.test'),
  ).toBe('/dashboard')
  expect(
    (
      await handleConnection(
        new Request('https://www.test/connect/gbfm?redirect_uri=https://evil.test'),
      )
    ).response.status,
  ).toBe(400)
})

it('keeps consent server-only, preserves provider state, and forwards login and decisions with cookies', async () => {
  const received: Array<{
    path: string
    body: string
    cookie: string | undefined
    origin: string | undefined
  }> = []

  const server = createServer(async (request, response) => {
    let body = ''

    for await (const chunk of request) body += chunk
    received.push({
      path: request.url ?? '',
      body,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
    })
    response.setHeader('content-type', 'application/json')

    if (request.url?.startsWith('/auth/oauth2/public-client'))
      response.end(JSON.stringify({ client_name: '<Disposable app>' }))
    else if (request.url === '/auth/get-session')
      response.end(
        JSON.stringify({ user: { name: 'Disposable Editor', email: 'editor@example.test' } }),
      )
    else if (request.url === '/auth/sign-in/email') {
      response.setHeader('set-cookie', 'session_token=disposable; HttpOnly')
      response.end(
        JSON.stringify({
          redirect: true,
          url: `http://127.0.0.1:${address.port}/connect/gbfm/consent?${query}`,
        }),
      )
    } else
      response.end(
        JSON.stringify({
          redirect: true,
          url: 'https://client.example.test/callback?state=disposable',
        }),
      )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
  vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

  try {
    const page = await handleConnection(
      new Request(`https://www.test/connect/gbfm/consent?${query}`, {
        headers: { cookie: 'session_token=disposable' },
      }),
    )

    const html = await page.response.text()

    expect(html).toContain('Connect &#60;Disposable app&#62;?')
    expect(html).toContain('including your own editorial drafts and private posts')
    expect(html).toContain('editor@example.test')
    expect(html).toContain('client.example.test')
    expect(html).toContain('not verified by Goosebumps FM')
    expect(html).toContain('value="deny"')
    expect(html).not.toContain('<script')
    expect(page.response.headers.get('cache-control')).toBe('private, no-store')
    expect(page.response.headers.get('referrer-policy')).toBe('strict-origin')
    expect(html).toContain('<meta name="referrer" content="strict-origin">')
    expect(page.response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' https://client.example.test/callback; base-uri 'none'; frame-ancestors 'none'",
    )

    const login = await handleFormAction(
      new Request('https://www.test/auth/sign-in', {
        method: 'POST',
        headers: { origin: 'https://www.test' },
        body: new URLSearchParams({
          email: 'disposable@example.test',
          password: 'disposable',
          returnTo: `/connect/gbfm?${query}`,
        }),
      }),
    )

    expect(login.response.status).toBe(303)
    expect(login.response.headers.get('location')).toBe(`/connect/gbfm/consent?${query}`)
    expect(login.response.headers.getSetCookie()).toEqual(['session_token=disposable; HttpOnly'])
    expect(
      JSON.parse(received.find(({ path }) => path === '/auth/sign-in/email')?.body ?? '{}'),
    ).toMatchObject({ oauth_query: query.toString() })

    for (const decision of ['allow', 'deny']) {
      const result = await handleConnection(
        new Request('https://www.test/connect/gbfm/consent', {
          method: 'POST',
          headers: { origin: 'https://www.test', cookie: 'session_token=disposable' },
          body: new URLSearchParams({ decision, oauth_query: query.toString() }),
        }),
      )

      expect(result.response.status).toBe(303)
      expect(result.response.headers.get('location')).toBe(
        'https://client.example.test/callback?state=disposable',
      )
    }

    expect(
      received
        .values()
        .filter(({ path }) => path === '/auth/oauth2/consent')
        .map((request) => ({ ...request, body: JSON.parse(request.body) }))
        .toArray(),
    ).toEqual([
      {
        path: '/auth/oauth2/consent',
        body: { accept: true, oauth_query: query.toString() },
        cookie: 'session_token=disposable',
        origin: 'https://www.test',
      },
      {
        path: '/auth/oauth2/consent',
        body: { accept: false, oauth_query: query.toString() },
        cookie: 'session_token=disposable',
        origin: 'https://www.test',
      },
    ])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

it('rejects cross-origin decisions and write scopes before any provider request', async () => {
  const opaqueLogin = await handleFormAction(
    new Request('https://www.test/auth/sign-in', {
      method: 'POST',
      headers: { origin: 'null' },
      body: new URLSearchParams(),
    }),
  )

  expect(opaqueLogin.response.status).toBe(403)

  const crossOrigin = await handleConnection(
    new Request('https://www.test/connect/gbfm/consent', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
      body: new URLSearchParams({ decision: 'allow', oauth_query: query.toString() }),
    }),
  )

  expect(crossOrigin.response.status).toBe(403)
  const writeQuery = new URLSearchParams(query)
  writeQuery.set('scope', 'posts:read posts:create')
  expect(
    (await handleConnection(new Request(`https://www.test/connect/gbfm/consent?${writeQuery}`)))
      .response.status,
  ).toBe(400)
})

it('does not render consent when the provider rejects tampered or expired state', async () => {
  const paths: Array<string> = []

  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_signature' }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
  vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

  try {
    for (const [key, value] of [
      ['sig', 'tampered'],
      ['exp', '1'],
    ]) {
      const rejected = new URLSearchParams(query)
      rejected.set(key ?? '', value ?? '')

      const result = await handleConnection(
        new Request(`https://www.test/connect/gbfm/consent?${rejected}`),
      )

      expect(result.response.status).toBe(400)
      expect(await result.response.text()).not.toContain('Allow connection')
      expect(result.response.headers.has('location')).toBe(false)
    }

    expect(paths).toEqual([
      '/auth/oauth2/public-client-prelogin',
      '/auth/oauth2/public-client-prelogin',
    ])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
