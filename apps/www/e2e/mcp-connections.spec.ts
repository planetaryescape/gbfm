import { createServer } from 'node:http'

import { expect, test } from '@playwright/test'
import { Schema } from 'effect'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('malformed connection links cannot redirect the browser to a supplied callback', async ({
  page,
}) => {
  const response = await page.goto('/connect/gbfm?redirect_uri=https://evil.example.test')

  expect(response?.status()).toBe(400)
  await expect(page).toHaveURL(/\/connect\/gbfm\?/)
  await expect(page.getByText('This request expired. Start again from your app.')).toBeVisible()
})

test('an author signs in, denies, allows and disconnects a disposable read-only app', async ({
  page,
  request,
}) => {
  const resource = process.env.GBFM_MCP_E2E_RESOURCE
  test.skip(!resource, 'Requires an explicitly configured disposable MCP fixture environment')

  if (!resource) return

  const ownerEmail = process.env.GBFM_MCP_E2E_OWNER_EMAIL
  const ownerPassword = process.env.GBFM_MCP_E2E_OWNER_PASSWORD

  if (!ownerEmail || !ownerPassword)
    throw new Error('Explicit disposable MCP owner credentials are required')

  const name = 'OpenCode'

  const callbackServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<h1>Disposable app callback</h1>')
  })

  await new Promise<void>((resolve, reject) => {
    callbackServer.once('error', reject)
    callbackServer.listen(0, '127.0.0.1', resolve)
  })

  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
    callbackServer.address(),
  )

  const callback = `http://127.0.0.1:${address.port}/callback`

  const closeCallback = () =>
    new Promise<void>((resolve, reject) => {
      callbackServer.close((error) => (error ? reject(error) : resolve()))
    })

  try {
    const registration = await request.post('/auth/oauth2/register', {
      data: {
        client_name: name,
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'posts:read offline_access',
      },
    })

    expect(registration.ok()).toBe(true)

    const client = Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }))(
      await registration.json(),
    )

    const authorize = () =>
      `/auth/oauth2/authorize?${new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'posts:read offline_access',
        resource,
        state: 'disposable-browser-state',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
      })}`

    try {
      const loginPage = await page.goto(authorize())
      expect(loginPage?.headers()['referrer-policy']).toBe('strict-origin')
      await expect(page).toHaveURL(/\/connect\/gbfm\?/)
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill(ownerEmail)
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill(ownerPassword)
      await page.getByRole('button', { name: 'Sign in and continue', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: `Connect ${name}?`, exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('Read your posts, including drafts and private posts'),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Disposable app callback' })).toBeVisible()
      expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied')
      expect(new URL(page.url()).searchParams.has('code')).toBe(false)

      await page.goto(authorize())
      await expect(
        page.getByRole('heading', { name: `Connect ${name}?`, exact: true }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Allow connection', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Disposable app callback' })).toBeVisible()
      expect(new URL(page.url()).searchParams.has('code')).toBe(true)

      await page.goto('/dashboard/connections')

      const connection = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name, exact: true }) })

      await expect(connection).toContainText('posts:read')
      await connection.getByRole('button', { name: `Disconnect ${name}`, exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'App disconnected.' })).toBeVisible()
      await expect(connection).toHaveCount(0)
    } finally {
      const cleanup = await page.request.post(
        `/api/user/mcp-connections/${encodeURIComponent(client.client_id)}/revoke`,
        { headers: { origin: new URL(resource).origin } },
      )

      expect(cleanup.ok(), `Disposable grant cleanup returned ${cleanup.status()}`).toBe(true)
    }
  } finally {
    await closeCallback()
  }
})
