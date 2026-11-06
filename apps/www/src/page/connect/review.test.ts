import { createServer } from 'node:http'

import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { handleConnection } from './server'

afterEach(() => vi.unstubAllEnvs())

const query = new URLSearchParams({
  client_id: 'review-client',
  scope: 'posts:read',
  redirect_uri: 'https://client.example.test/callback',
  exp: '9999999999',
  sig: 'provider-verified-test-signature',
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
