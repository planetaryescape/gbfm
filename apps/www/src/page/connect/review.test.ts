import { createServer } from 'node:http'

import { Match, Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { renderResponse } from '../../server/request-dispatch'
import { handleConnection } from './server'

afterEach(() => vi.unstubAllEnvs())

const query = new URLSearchParams({
  client_id: 'review-client',
  scope: 'posts:read',
  redirect_uri: 'https://client.example.test/callback',
  exp: '9999999999',
  sig: 'provider-verified-test-signature',
  state: 'original-review-state',
})

for (const key of [...query.keys(), 'ba_param']) query.append('ba_param', key)

const post = (path: string, fields: Readonly<Record<string, string>> = {}) =>
  new Request(`https://www.test/connect/gbfm/${path}`, {
    method: 'POST',
    headers: { origin: 'https://www.test' },
    body: new URLSearchParams({ oauth_query: query.toString(), ...fields }),
  })

const withApi = async (
  respond: (path: string, body: string) => Response | Promise<Response>,
  verify: (calls: Array<{ path: string; body: string }>) => Promise<void>,
) => {
  const calls: Array<{ path: string; body: string }> = []

  const server = createServer(async (request, reply) => {
    let body = ''

    for await (const chunk of request) body += chunk
    const path = request.url ?? ''
    calls.push({ path, body })
    const response = await respond(path, body)
    reply.statusCode = response.status
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') reply.setHeader(name, value)
    })
    const cookies = response.headers.getSetCookie()

    if (cookies.length) reply.setHeader('set-cookie', cookies)
    reply.end(await response.text())
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
  vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

  try {
    await verify(calls)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

const client = () => Response.json({ client_name: 'Review app' })

const signedOut = () => Response.json(null)

it('applies the connection referrer policy to legacy sign-in continuations', async () => {
  const result = await renderResponse(
    new Request(
      `https://www.test/auth/sign-in?${new URLSearchParams({ returnTo: `/connect/gbfm?${query}` })}`,
    ),
  )

  const response = Match.value(result).pipe(
    Match.tag('Responded', (value) => value.response),
    Match.orElse(() => {
      throw new Error('Expected a connection redirect')
    }),
  )

  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe(`/connect/gbfm?${query}`)
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

const signedIn = () =>
  Response.json({ user: { name: 'Review Editor', email: 'editor@example.test' } })

const withCookies = (response: Response, cookies: ReadonlyArray<string>) => {
  for (const cookie of cookies) response.headers.append('set-cookie', cookie)

  return response
}

it('uses the provider denial path when cancellation has a session', async () => {
  await withApi(
    (path) => {
      if (path === '/auth/oauth2/public-client-prelogin') return client()

      if (path === '/auth/get-session') return signedIn()

      return Response.json({
        redirect: true,
        url: 'https://client.example.test/callback?error=access_denied&state=original-review-state',
      })
    },
    async (calls) => {
      const result = await handleConnection(post('cancel'))

      expect(result.response.status).toBe(303)
      expect(calls.find(({ path }) => path === '/auth/oauth2/consent')?.body).toBe(
        JSON.stringify({ accept: false, oauth_query: query.toString() }),
      )
      expect(calls.some(({ path }) => path.startsWith('/.well-known/'))).toBe(false)
    },
  )
})

it('uses the configured issuer for signed-out cancellation without a discovery request', async () => {
  vi.stubEnv('EDITORIAL_OAUTH_ISSUER', 'https://configured-api.example.test/auth')
  await withApi(
    (path) => (path === '/auth/get-session' ? signedOut() : client()),
    async (calls) => {
      const result = await handleConnection(post('cancel'))
      const target = new URL(result.response.headers.get('location') ?? '')

      expect(result.response.status).toBe(303)
      expect(target.origin).toBe('https://client.example.test')
      expect(target.searchParams.get('iss')).toBe('https://configured-api.example.test/auth')
      expect(target.searchParams.get('error')).toBe('access_denied')
      expect(target.searchParams.get('state')).toBe('original-review-state')
      expect(target.searchParams.has('code')).toBe(false)
      expect(calls.map(({ path }) => path).toSorted()).toEqual([
        '/auth/get-session',
        '/auth/oauth2/public-client-prelogin',
      ])
    },
  )
})

it('rejects unsupported signed-out response modes rather than treating them as query responses', async () => {
  vi.stubEnv('EDITORIAL_OAUTH_ISSUER', 'https://configured-api.example.test/auth')
  const unsupported = new URLSearchParams(query)
  unsupported.set('response_mode', 'fragment')
  unsupported.append('ba_param', 'response_mode')

  await withApi(
    (path) => (path === '/auth/get-session' ? signedOut() : client()),
    async () => {
      const result = await handleConnection(post('cancel', { oauth_query: unsupported.toString() }))

      expect(result.response.status).toBe(400)
      expect(result.response.headers.has('location')).toBe(false)
    },
  )
})

it.each(['', 'https://configured-api.example.test/wrong-path'])(
  'fails closed when signed-out cancellation issuer configuration is invalid: %s',
  async (issuer) => {
    vi.stubEnv('EDITORIAL_OAUTH_ISSUER', issuer)
    await withApi(
      (path) => (path === '/auth/get-session' ? signedOut() : client()),
      async () => {
        const result = await handleConnection(post('cancel'))

        expect(result.response.status).toBe(502)
        expect(result.response.headers.has('location')).toBe(false)
      },
    )
  },
)

it('rejects unknown actions and malformed form values before making API requests', async () => {
  await withApi(
    () => Response.json(null, { status: 500 }),
    async (calls) => {
      for (const [request, status] of [
        [post('unknown'), 404],
        [post(''), 404],
        [post('consent', { decision: 'perhaps' }), 400],
        [post('sign-in', { email: 'editor@example.test' }), 400],
      ] satisfies Array<[Request, number]>) {
        expect((await handleConnection(request)).response.status).toBe(status)
      }

      expect(calls).toEqual([])
    },
  )
})

it.each(['sign-in', 'consent'])(
  'forwards valid %s directly to the provider without loading page data',
  async (action) => {
    await withApi(
      () => Response.json({ redirect: true, url: 'https://client.example.test/callback' }),
      async (calls) => {
        const request =
          action === 'sign-in'
            ? post(action, { email: 'editor@example.test', password: 'disposable' })
            : post(action, { decision: 'deny' })

        const result = await handleConnection(request)

        expect(result.response.status).toBe(303)
        expect(calls.map(({ path }) => path)).toEqual([
          action === 'sign-in' ? '/auth/sign-in/email' : '/auth/oauth2/consent',
        ])
      },
    )
  },
)

it('starts session lookup while prelogin verification is still pending', async () => {
  const sessionStarted = Promise.withResolvers<void>()

  await withApi(
    async (path) => {
      if (path === '/auth/get-session') {
        sessionStarted.resolve()

        return signedOut()
      }

      await sessionStarted.promise

      return client()
    },
    async () => {
      const result = await handleConnection(new Request(`https://www.test/connect/gbfm?${query}`))

      expect(result.response.status).toBe(200)
      expect(await result.response.text()).toContain('Connect Review app')
    },
  )
})

it('preserves a successful sign-in session when the provider does not return a continuation', async () => {
  await withApi(
    (path) => {
      if (path === '/auth/oauth2/public-client-prelogin') return client()

      if (path === '/auth/get-session') return signedOut()

      return withCookies(Response.json({ token: 'disposable-session', user: { name: 'Editor' } }), [
        'session_token=signed-in; HttpOnly; SameSite=Lax',
      ])
    },
    async () => {
      const result = await handleConnection(
        post('sign-in', { email: 'editor@example.test', password: 'disposable' }),
      )

      expect(result.response.status).toBe(502)
      expect(result.response.headers.getSetCookie()).toEqual([
        'session_token=signed-in; HttpOnly; SameSite=Lax',
      ])
      expect(result.response.headers.get('cache-control')).toBe('private, no-store')
    },
  )
})

it.each(['login', 'consent', 'continue'])(
  'forwards prelogin and session refresh cookies on the %s page',
  async (screen) => {
    await withApi(
      (path) => {
        if (path === '/auth/oauth2/public-client-prelogin')
          return withCookies(client(), ['provider_check=refreshed; HttpOnly'])

        if (path === '/auth/get-session')
          return withCookies(screen === 'login' ? signedOut() : signedIn(), [
            'session_token=refreshed; HttpOnly',
          ])

        return withCookies(Response.json({ redirect: true, url: `/connect/gbfm?${query}` }), [
          'provider_flow=renewed; HttpOnly',
        ])
      },
      async () => {
        const path = screen === 'consent' ? '/connect/gbfm/consent' : '/connect/gbfm'
        const result = await handleConnection(new Request(`https://www.test${path}?${query}`))
        const expected = ['provider_check=refreshed; HttpOnly', 'session_token=refreshed; HttpOnly']

        if (screen === 'continue') expected.push('provider_flow=renewed; HttpOnly')
        expect(result.response.headers.getSetCookie()).toEqual(expected)
      },
    )
  },
)

it('keeps sign-out deletion cookies after earlier session-refresh cookies', async () => {
  await withApi(
    (path) => {
      if (path === '/auth/oauth2/public-client-prelogin') return client()

      if (path === '/auth/get-session')
        return withCookies(signedIn(), ['session_token=refreshed; HttpOnly'])

      return withCookies(Response.json({ success: true }), ['session_token=; Max-Age=0; HttpOnly'])
    },
    async () => {
      const result = await handleConnection(post('account'))

      expect(result.response.headers.getSetCookie()).toEqual([
        'session_token=refreshed; HttpOnly',
        'session_token=; Max-Age=0; HttpOnly',
      ])
    },
  )
})

it.each(['BANNED_USER', 'ORIGIN_NOT_ALLOWED'])(
  'does not describe sign-in denial %s as an editorial role failure',
  async (code) => {
    await withApi(
      (path) => {
        if (path === '/auth/oauth2/public-client-prelogin') return client()

        if (path === '/auth/get-session') return signedOut()

        return Response.json({ code }, { status: 403 })
      },
      async () => {
        const result = await handleConnection(
          post('sign-in', { email: 'editor@example.test', password: 'disposable' }),
        )

        const html = await result.response.text()

        expect(result.response.status).toBe(403)
        expect(html).toContain('role="alert"')
        expect(html).not.toContain('This account cannot connect')
        expect(html).not.toContain('Use another account')
      },
    )
  },
)

it('shows the eligibility explanation only for the explicit editorial permission code', async () => {
  await withApi(
    (path) => {
      if (path === '/auth/oauth2/public-client-prelogin') return client()

      if (path === '/auth/get-session') return signedOut()

      return Response.json({ code: 'EDITORIAL_PERMISSION_REQUIRED' }, { status: 403 })
    },
    async () => {
      const result = await handleConnection(
        post('sign-in', { email: 'listener@example.test', password: 'disposable' }),
      )

      expect(result.response.status).toBe(403)
      expect(await result.response.text()).toContain('This account cannot connect')
    },
  )
})

it.each(['/auth/oauth2/public-client-prelogin', '/auth/get-session'])(
  'does not describe a 403 from %s as an account eligibility failure',
  async (rejected) => {
    await withApi(
      (path) =>
        path === rejected ? Response.json({ code: 'FORBIDDEN' }, { status: 403 }) : client(),
      async () => {
        const result = await handleConnection(new Request(`https://www.test/connect/gbfm?${query}`))

        expect([400, 502]).toContain(result.response.status)
        expect(await result.response.text()).not.toContain('This account cannot connect')
      },
    )
  },
)
