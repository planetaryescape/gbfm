import { expect, test } from '@playwright/test'

test('audio detail content and metadata render without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })

  try {
    const page = await context.newPage()
    const response = await page.goto('/mixes/e2e-local-frequencies')
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole('heading', { name: 'Local Frequencies', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Listening notes', exact: true })).toBeVisible()
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'music.song')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://goosebumps.fm/mixes/e2e-local-frequencies',
    )
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Sign in to favorite', exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('audio detail transition stays client-side and updates metadata', async ({ page }) => {
  const errors: Array<string> = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/shows/e2e-local-radio')
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  const timeOrigin = await page.evaluate(() => performance.timeOrigin)

  const loaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/mixes/e2e-local-frequencies' &&
      new URL(response.url()).searchParams.has('__data'),
  )

  await page.getByRole('link', { name: 'Local Frequencies', exact: true }).click()
  expect((await loaded).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Listening notes', exact: true })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'music.song')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('missing audio returns 404 for both HTML and navigation data', async ({ request }) => {
  const html = await request.get('/mixes/e2e-missing-audio-page')
  const data = await request.get('/mixes/e2e-missing-audio-page?__data=1')
  expect(html.status()).toBe(404)
  expect(data.status()).toBe(404)
  expect(await html.text()).toContain('Page not found')
  expect(await data.json()).toMatchObject({
    status: 404,
    principal: null,
    items: [],
    publicAction: null,
  })
})

test('signed-in audio SSR contains listener identity and current favorite state', async ({
  request,
  baseURL,
}) => {
  const login = await request.post('/auth/sign-up/email', {
    headers: {
      origin: baseURL ?? 'http://127.0.0.1:5173',
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
      'cf-connecting-ip': '127.0.0.1',
    },
    data: {
      name: 'Audio page test listener',
      email: `audio-page-${crypto.randomUUID()}@gbfm.local`,
      password: 'LocalTest123!',
    },
  })

  expect(login.ok()).toBe(true)
  const response = await request.get('/mixes/e2e-local-frequencies?__data=1')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(await response.json()).toMatchObject({
    status: 200,
    principal: { name: 'Audio page test listener' },
    publicAction: { target: { kind: 'audio' }, state: 'inactive' },
  })
})
