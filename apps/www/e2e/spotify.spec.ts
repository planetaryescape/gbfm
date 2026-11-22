import { expect, test } from '@playwright/test'

test('Spotify callback rejects unsolicited codes without exposing them in SSR or exchanging tokens', async ({
  page,
  request,
}) => {
  const response = await request.get('/spotify/callback?code=unsolicited-fixture&state=wrong')
  expect(response.status()).toBe(200)
  expect(await response.text()).not.toContain('unsolicited-fixture')
  let tokenExchanges = 0
  await page.route('https://accounts.spotify.com/api/token', (route) => {
    tokenExchanges += 1
    return route.abort()
  })
  await page.goto('/spotify/callback?code=unsolicited-fixture&state=wrong')
  await expect(page.getByRole('alert')).toContainText(
    'authorization is missing, expired, or invalid',
  )
  await expect(page).toHaveURL(/\/spotify\/callback$/)
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow')
  expect(tokenExchanges).toBe(0)
})

test('Spotify PKCE connects with the current profile response and disconnects using the real browser adapter', async ({
  page,
}) => {
  await page.route('https://accounts.spotify.com/authorize?**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('state')).toBeTruthy()
    const callback = new URL(url.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', 'local-fixture-code')
    callback.searchParams.set('state', url.searchParams.get('state') ?? '')
    // WebKit cannot fulfill an intercepted request with a redirect status.
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(callback.href)})</script>`,
    })
  })
  await page.route('https://accounts.spotify.com/api/token', async (route) => {
    const body = new URLSearchParams(route.request().postData() ?? '')
    expect(body.get('code')).toBe('local-fixture-code')
    expect(body.get('code_verifier')?.length).toBeGreaterThan(40)
    await route.fulfill({
      json: {
        access_token: 'local-fixture-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'local-fixture-refresh',
        scope: 'user-read-private',
      },
    })
  })
  await page.route('https://api.spotify.com/v1/me', (route) =>
    route.fulfill({
      json: {
        id: 'fixture-listener',
        display_name: 'Local Spotify Listener',
        type: 'user',
        uri: 'spotify:user:fixture-listener',
        href: 'https://api.spotify.com/v1/users/fixture-listener',
        external_urls: { spotify: 'https://open.spotify.com/user/fixture-listener' },
        images: [],
      },
    }),
  )
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/dashboard/integrations')
  await page.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
  await expect(page.getByText('Connected as Local Spotify Listener', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/dashboard\/integrations$/)
  await page.getByRole('button', { name: 'Disconnect Spotify', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeEnabled()
})
