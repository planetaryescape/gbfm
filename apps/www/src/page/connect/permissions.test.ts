import { createServer } from 'node:http'

import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { handleConnection } from './server'

afterEach(() => vi.unstubAllEnvs())

const query = new URLSearchParams({
  client_id: 'opencode-local',
  scope: 'posts:read drafts:write offline_access',
  redirect_uri: 'http://127.0.0.1:38479/callback',
  exp: '9999999999',
  sig: 'synthetic-signed-continuation',
})

for (const key of [...query.keys(), 'ba_param']) query.append('ba_param', key)

it('shows requested and unavailable permissions before consent, then permits a fresh upgrade after activation', async () => {
  let enabled = false
  let validMetadata = true
  let policyChanged = false
  let consents = 0

  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')

    if (request.url === '/auth/oauth2/public-client-prelogin')
      response.end(JSON.stringify({ client_name: 'OpenCode' }))
    else if (request.url === '/auth/get-session')
      response.end(JSON.stringify({ user: { name: 'Local Editor', email: 'editor@example.test' } }))
    else if (request.url === '/.well-known/oauth-protected-resource/mcp')
      response.end(
        JSON.stringify(
          validMetadata
            ? { scopes_supported: enabled ? ['posts:read', 'drafts:write'] : ['posts:read'] }
            : {},
        ),
      )
    else if (request.url === '/auth/oauth2/consent') {
      consents++
      response.statusCode = policyChanged ? 400 : 200
      response.end(
        JSON.stringify(
          policyChanged
            ? { error: 'invalid_scope' }
            : { redirect: true, url: 'http://127.0.0.1:38479/callback?code=local-only' },
        ),
      )
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
  vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

  try {
    const blocked = await handleConnection(
      new Request(`https://www.test/connect/gbfm/consent?${query}`),
    )

    const html = await blocked.response.text()
    expect(blocked.response.status).toBe(409)
    expect(html).toContain('Requested permissions are unavailable')
    expect(html).toContain('Not enabled</h2><p>drafts:write')
    expect(html).toContain('Signing in again or refreshing a token cannot enable them')
    expect(html).not.toContain('Allow connection')
    expect(html).not.toContain('synthetic-signed-continuation')
    expect(consents).toBe(0)
    expect(blocked.response.headers.get('cache-control')).toBe('private, no-store')

    enabled = true

    const upgraded = await handleConnection(
      new Request(`https://www.test/connect/gbfm/consent?${query}`),
    )

    expect(upgraded.response.status).toBe(200)
    expect(await upgraded.response.text()).toContain('Read and draft-write access')

    policyChanged = true

    const changed = await handleConnection(
      new Request('https://www.test/connect/gbfm/consent', {
        method: 'POST',
        headers: { origin: 'https://www.test' },
        body: new URLSearchParams({ decision: 'allow', oauth_query: query.toString() }),
      }),
    )

    expect(changed.response.status).toBe(409)
    expect(await changed.response.text()).toContain(
      'check this environment’s policy and the app registration',
    )

    validMetadata = false

    const unavailable = await handleConnection(
      new Request(`https://www.test/connect/gbfm/consent?${query}`),
    )

    expect(unavailable.response.status).toBe(502)
    expect(await unavailable.response.text()).not.toContain('Allow connection')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
