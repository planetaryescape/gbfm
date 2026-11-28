import { afterEach, expect, it, vi } from 'vitest'

import { clientLogoScriptHash } from '../../domain/auth/client-logo'
import {
  connectionCookies,
  connectionQuery,
  renderConnection,
  withConnectionApi,
} from './http.test-support'

afterEach(() => vi.unstubAllEnvs())

const preloginCookie = 'prelogin=synthetic-check; HttpOnly; SameSite=Lax'

const sessionCookie = 'session=synthetic-session; HttpOnly; SameSite=Lax'

const decisionCookie = 'decision=synthetic-receipt; HttpOnly; SameSite=Lax'

const client = (logo = 'https://assets.example.com/client.png?a=1&b=2') =>
  connectionCookies(Response.json({ client_name: '<Native client>', logo_uri: logo }), [
    preloginCookie,
  ])

const session = () =>
  connectionCookies(
    Response.json({ user: { name: '<Native editor>', email: 'editor@example.test' } }),
    [sessionCookie],
  )

const metadata = () => Response.json({ scopes_supported: ['posts:read', 'drafts:write'] })

it.each([false, true])(
  'native entry preserves exact HTTP consent, logo CSP and private-artwork grant boundaries: writes=%s',
  async (writes) => {
    const query = connectionQuery(writes)

    await withConnectionApi(
      ({ path }) => {
        if (path === '/auth/oauth2/public-client-prelogin') return client()

        if (path === '/auth/get-session') return session()

        if (path === '/.well-known/oauth-protected-resource/mcp') return metadata()

        return Response.json(null, { status: 500 })
      },
      async (calls) => {
        const response = await renderConnection(
          new Request(`https://www.test/connect/gbfm/consent?${query}`, {
            headers: { cookie: 'session=synthetic-request' },
          }),
        )

        const html = await response.text()

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('referrer-policy')).toBe('strict-origin')
        expect(response.headers.getSetCookie()).toEqual([preloginCookie, sessionCookie])
        expect(response.headers.get('content-security-policy')).toBe(
          `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' http://127.0.0.1:38479/callback; base-uri 'none'; frame-ancestors 'none'; img-src https://assets.example.com; script-src '${clientLogoScriptHash}'`,
        )
        expect(html).toContain('Connect &#60;Native client&#62;?')
        expect(html).toContain('&#60;Native editor&#62;')
        expect(html).toContain('data-client-logo')
        expect(html).toContain('a=1&#38;b=2')
        expect(html).toContain('action="/connect/gbfm/consent"')
        expect(html).toContain('name="decision" value="allow"')
        expect(html).toContain('name="decision" value="deny"')
        expect(html).toContain('action="/connect/gbfm/account"')
        expect(html.includes('Read and draft-write access')).toBe(writes)
        expect(html.includes('Read-only access')).toBe(!writes)
        expect(
          html.includes(
            'Create and edit your own unpublished editorial drafts, including private artwork',
          ),
        ).toBe(writes)
        expect(html.includes('Cannot publish, delete or edit published posts.')).toBe(writes)
        expect(html.includes('Cannot create, edit, publish or delete.')).toBe(!writes)
        expect(html).not.toContain('Cannot publish, delete, upload files or edit published posts.')
        expect(html).not.toContain('Upload files for your authorized content')
        expect(html).not.toContain('Publish or unpublish your authored content')
        expect(html).not.toContain('Delete your authored content')
        expect(html).not.toContain('synthetic-session')
        expect(html).not.toContain('gbfm-ui-state')
        expect(
          calls.find(({ path }) => path === '/auth/oauth2/public-client-prelogin'),
        ).toMatchObject({
          method: 'POST',
          cookie: 'session=synthetic-request',
          origin: 'https://www.test',
          body: JSON.stringify({ client_id: 'native-http-fixture', oauth_query: query.toString() }),
        })

        const expectedCalls = ['/auth/get-session', '/auth/oauth2/public-client-prelogin']

        if (writes) expectedCalls.push('/.well-known/oauth-protected-resource/mcp')

        expect(calls.map(({ path }) => path).toSorted()).toEqual(expectedCalls.toSorted())
      },
    )
  },
)

it('native entry preserves failed-login status, cookie order and credential isolation', async () => {
  const query = connectionQuery()
  const password = 'synthetic-password-never-rendered'

  await withConnectionApi(
    ({ path }) => {
      if (path === '/auth/oauth2/public-client-prelogin') return client()

      if (path === '/auth/get-session')
        return connectionCookies(Response.json(null), [sessionCookie])

      return connectionCookies(
        Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }),
        [decisionCookie],
      )
    },
    async (calls) => {
      const response = await renderConnection(
        new Request('https://www.test/connect/gbfm/sign-in', {
          method: 'POST',
          headers: { origin: 'https://www.test' },
          body: new URLSearchParams({
            oauth_query: query.toString(),
            email: '<typed>@example.test',
            password,
          }),
        }),
      )

      const html = await response.text()

      expect(response.status).toBe(401)
      expect(response.headers.getSetCookie()).toEqual([
        preloginCookie,
        sessionCookie,
        decisionCookie,
      ])
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(html).toContain('role="alert"')
      expect(html).toContain('value="&#60;typed&#62;@example.test"')
      expect(html).toContain('type="password" name="password" autocomplete="current-password"')
      expect(html).toContain('name="oauth_query"')
      expect(html).toContain('action="/connect/gbfm/cancel"')
      expect(html).not.toContain(password)
      expect(html).not.toContain('synthetic-session')
      expect(html).not.toContain('gbfm-ui-state')
      expect(calls.find(({ path }) => path === '/auth/sign-in/email')?.body).toBe(
        JSON.stringify({ email: '<typed>@example.test', password, oauth_query: query.toString() }),
      )
    },
  )
})

it('native entry preserves the 409 policy refusal without silently reducing requested grants', async () => {
  const query = connectionQuery(true)

  await withConnectionApi(
    ({ path }) => {
      if (path === '/auth/oauth2/public-client-prelogin') return client()

      if (path === '/auth/get-session') return session()

      return Response.json({ scopes_supported: ['posts:read'] })
    },
    async (calls) => {
      const response = await renderConnection(
        new Request(`https://www.test/connect/gbfm/consent?${query}`),
      )

      const html = await response.text()

      expect(response.status).toBe(409)
      expect(response.headers.getSetCookie()).toEqual([preloginCookie, sessionCookie])
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      )
      expect(html).toContain('Not enabled</h2><p>drafts:write')
      expect(html).toContain('No permission upgrade has been approved')
      expect(html).toContain('Signing in again or refreshing a token cannot enable them')
      expect(html).not.toContain('Allow connection')
      expect(html).not.toContain('synthetic-provider-verified-continuation')
      expect(calls.find(({ path }) => path === '/auth/oauth2/public-client-prelogin')?.body).toBe(
        JSON.stringify({ client_id: 'native-http-fixture', oauth_query: query.toString() }),
      )
      expect(calls.some(({ path }) => path === '/auth/oauth2/consent')).toBe(false)
    },
  )
})

it.each(['allow', 'deny'])(
  'native entry preserves the exact %s intent and provider redirect response',
  async (decision) => {
    const query = connectionQuery(true)
    const location = 'http://127.0.0.1:38479/callback?state=native-http-fixture-state'

    await withConnectionApi(
      () => connectionCookies(Response.json({ redirect: true, url: location }), [decisionCookie]),
      async (calls) => {
        const response = await renderConnection(
          new Request('https://www.test/connect/gbfm/consent', {
            method: 'POST',
            headers: { origin: 'https://www.test', cookie: 'session=synthetic-request' },
            body: new URLSearchParams({ oauth_query: query.toString(), decision }),
          }),
        )

        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe(location)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        expect(response.headers.getSetCookie()).toEqual([decisionCookie])
        expect(await response.text()).toBe('')
        expect(calls).toEqual([
          {
            path: '/auth/oauth2/consent',
            method: 'POST',
            body: JSON.stringify({ accept: decision === 'allow', oauth_query: query.toString() }),
            cookie: 'session=synthetic-request',
            origin: 'https://www.test',
          },
        ])
      },
    )
  },
)
