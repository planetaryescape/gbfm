import { expect, it } from 'vitest'

import { forwardOAuthAuthorization } from './oauth-authorization'

const callback = 'http://127.0.0.1:49152/callback'

const authorize = new URLSearchParams({
  client_id: 'disposable-client',
  redirect_uri: callback,
  scope: 'posts:read offline_access',
  response_type: 'code',
})

const signedQuery = () => {
  const query = new URLSearchParams(authorize)
  query.set('sig', 'disposable-signature')
  query.set('exp', '9999999999')
  query.append('resource', 'https://api.example.test/mcp')
  query.append('resource', 'https://second.example.test/mcp')

  for (const key of [...query.keys(), 'ba_param']) query.append('ba_param', key)

  return query
}

const navigation = (cookie = '') =>
  new Request(`https://www.example.test/auth/oauth2/authorize?${authorize}`, {
    headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie },
  })

it('turns signed-out and signed-in provider JSON continuations into same-origin browser redirects', async () => {
  const query = signedQuery()
  const forwarded: Array<{ cookie: string | null; redirect: RequestRedirect }> = []

  for (const cookie of ['', 'session_token=disposable']) {
    const path = cookie ? '/connect/gbfm/consent' : '/connect/gbfm'

    const result = await forwardOAuthAuthorization(navigation(cookie), async (request) => {
      forwarded.push({ cookie: request.headers.get('cookie'), redirect: request.redirect })

      return Response.json(
        { redirect: true, url: `${path}?${query}` },
        {
          headers: { 'set-cookie': 'session_token=disposable; HttpOnly; SameSite=Lax' },
        },
      )
    })

    expect(result.status).toBe(303)
    expect(result.headers.get('location')).toBe(`${path}?${query}`)
    expect(result.headers.getSetCookie()).toEqual([
      'session_token=disposable; HttpOnly; SameSite=Lax',
    ])
    expect(result.headers.get('referrer-policy')).toBe('no-referrer')
  }

  expect(forwarded).toEqual([
    { cookie: '', redirect: 'manual' },
    { cookie: 'session_token=disposable', redirect: 'manual' },
  ])
})

it('preserves fetch-client JSON even when its Accept header includes HTML', async () => {
  const payload = { redirect: true, url: `/connect/gbfm?${signedQuery()}` }

  const result = await forwardOAuthAuthorization(
    new Request(navigation(), {
      headers: { accept: 'text/html', 'sec-fetch-mode': 'cors' },
    }),
    async () => Response.json(payload),
  )

  expect(result.status).toBe(200)
  expect(await result.json()).toEqual(payload)
  expect(result.headers.has('location')).toBe(false)
})

it('preserves ordinary provider HTTP redirects and error responses', async () => {
  const redirect = new Response(null, {
    status: 302,
    headers: { location: `/connect/gbfm?${signedQuery()}` },
  })

  const error = Response.json({ error: 'invalid_request' }, { status: 400 })

  expect(await forwardOAuthAuthorization(navigation(), async () => redirect)).toBe(redirect)
  expect(await forwardOAuthAuthorization(navigation(), async () => error)).toBe(error)
})

it('normalizes only the requested callback, never an unrelated origin or unsigned continuation', async () => {
  const result = await forwardOAuthAuthorization(navigation(), async () =>
    Response.json({
      redirect: true,
      url: `${callback}?code=disposable`,
    }),
  )

  expect(result.status).toBe(303)
  expect(result.headers.get('location')).toBe(`${callback}?code=disposable`)

  for (const url of [
    'https://unrelated.example.test/callback',
    '/connect/gbfm?client_id=unsigned',
    `https://unrelated.example.test/connect/gbfm?${signedQuery()}`,
  ]) {
    const rejected = await forwardOAuthAuthorization(navigation(), async () =>
      Response.json({ redirect: true, url }),
    )

    expect(rejected.status).toBe(502)
    expect(rejected.headers.has('location')).toBe(false)
  }
})

it('supports a provider-approved native callback and HTML navigation without fetch metadata', async () => {
  const query = new URLSearchParams(authorize)
  query.set('redirect_uri', 'com.example.editor:/callback')

  const request = new Request(`https://www.example.test/auth/oauth2/authorize?${query}`, {
    headers: { accept: 'text/html' },
  })

  const result = await forwardOAuthAuthorization(request, async () =>
    Response.json({
      redirect: true,
      url: 'com.example.editor:/callback?code=disposable',
    }),
  )

  expect(result.status).toBe(303)
  expect(result.headers.get('location')).toBe('com.example.editor:/callback?code=disposable')
})
