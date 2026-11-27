import { expect, test } from '@playwright/test'

import { expectCanvasSource, replaceCanvasSource } from './creator-editor'
import {
  expectBackgroundScrollLocked,
  expectModalOpen,
  expectNativeReady,
} from './fixtures/native-ready'

test('primary tweet and structured metadata are rendered before replies', async ({ request }) => {
  const response = await request.get('/tweet/e2e-music-thread')
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toContain('A tweet with a musical reply.')
  expect(html).toContain('Root Frequency')
  expect(html).not.toContain('Reply Frequency')
  expect(html).toContain('Loading replies')
  expect(html).toContain('application/ld+json')
  expect(html).toContain('datePublished')
  expect(html).toContain('rel="canonical"')
  expect(response.headers()['x-request-id']).toBeTruthy()
})

test('tweet detail highlights Tweets in both navigation menus', async ({ page }) => {
  await page.goto('/tweet/e2e-music-thread')
  await expect(page.locator('nav[aria-label="Primary"] a[href="/tweets"]')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await expect(page.locator('.menu-sheet').getByRole('link', { name: 'Tweets' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('anonymous public navigation hydrates and missing pages return real 404s', async ({
  page,
}) => {
  const errors: Array<string> = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/tweet/e2e-music-thread')
  await expect(page.getByRole('heading', { name: 'Root Frequency' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Reply Frequency' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'bandcamp' })).toHaveAttribute(
    'href',
    'https://example.bandcamp.com/track/e2e-reply',
  )
  await expect(page.locator('summary[aria-label="Reading options"]')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Skip seen' })).toHaveCount(0)
  const response = await page.goto('/not-a-route')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  expect(errors).toEqual([])
})

test('failed replies never masquerade as an empty thread', async ({ page }) => {
  await page.route('**/screen/replies', (route) => route.fulfill({ status: 503 }))
  await page.goto('/tweet/e2e-music-thread')
  await expect(page.getByRole('heading', { name: 'Root Frequency' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Replies are unavailable')
  await expect(page.getByText('No replies yet.')).toHaveCount(0)
})

test('creator profile persists and private SSR avoids a duplicate browser account request', async ({
  page,
}) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  const accountRequests: Array<string> = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/user/profile')
      accountRequests.push(request.method())
  })
  await page.goto('/dashboard/profile')
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue('local-creator')
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  expect(accountRequests).toEqual([])

  const bio = 'Independent frequencies, tested against local D1.'
  await page.getByRole('textbox', { name: 'Bio' }).fill(bio)

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/user/profile') && response.request().method() === 'PATCH',
  )

  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  expect((await saved).status()).toBe(200)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Bio' })).toHaveValue(bio)

  const response = await page.request.get('/dashboard/profile')
  expect(response.headers()['cache-control']).toContain('no-store')
  expect(await response.text()).toContain(bio)
  await expect(page.getByRole('navigation', { name: 'Dashboard sections' })).not.toContainText(
    'People',
  )
  await expect(page.getByRole('navigation', { name: 'Dashboard workspaces' })).toHaveCount(0)
  await page.goto('/dashboard/users')
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible()
})

test('auth forms reject a cross-origin submission', async ({ request }) => {
  const response = await request.post('/auth/sign-in', {
    headers: { origin: 'https://attacker.invalid' },
    form: { email: 'creator@gbfm.local', password: 'LocalTest123!' },
  })

  expect(response.status()).toBe(403)
  expect(response.headers()['set-cookie']).toBeUndefined()
})

test('auth forms accept their authoritative origin and reject a spoofed forwarded origin', async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error('The disposable frontend origin must be configured')

  const response = await request.post('/auth/sign-in', {
    headers: {
      origin: new URL(baseURL).origin,
      'x-forwarded-host': 'gbfm.localhost',
      'x-forwarded-proto': 'https',
    },
    form: { email: 'nobody@invalid.example', password: 'wrong' },
    maxRedirects: 0,
  })

  expect(response.status()).toBe(303)
  expect(response.headers()['location']).toContain('/auth/sign-in?error=credentials')

  const spoofed = await request.post('/auth/sign-in', {
    headers: {
      origin: 'https://gbfm.localhost',
      'x-forwarded-host': 'gbfm.localhost',
      'x-forwarded-proto': 'https',
    },
    form: { email: 'nobody@invalid.example', password: 'wrong' },
    maxRedirects: 0,
  })

  expect(spoofed.status()).toBe(403)
  expect(spoofed.headers()['set-cookie']).toBeUndefined()
})

test('playback advances and persists through client navigation', async ({ page }) => {
  await page.goto('/mixes')

  const recordedPlay = page.waitForResponse(
    (response) =>
      /\/api\/content\/audio\/[^/]+\/play$/.test(response.url()) &&
      response.request().method() === 'POST',
  )

  await page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  expect((await recordedPlay).status()).toBe(200)
  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole('dialog', { name: 'Now playing', exact: true })
          .getByRole('slider', { name: 'Playback position' })
          .inputValue(),
      ),
    )
    .toBeGreaterThan(0.5)
  await page.getByRole('button', { name: 'Collapse player', exact: true }).click()
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Menu', exact: true })
    .getByRole('link', { name: 'About', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Now playing', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await player.getByRole('button', { name: /^Queue \(/ }).click()
  await expect(page.getByRole('dialog', { name: 'Queue', exact: true })).toContainText(
    'Local Frequencies',
  )
  await page
    .getByRole('dialog', { name: 'Queue', exact: true })
    .getByRole('button', { name: 'Close queue', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Queue', exact: true })).not.toBeVisible()
  await expectBackgroundScrollLocked(page)
  await player.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
})

test('creator restores an autosaved draft, publishes it, and reads its public SSR page', async ({
  page,
}) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/new/tweet')
  const slug = `e2e-published-${Date.now()}`

  const source = 'An independent signal from the native composer.'

  await expectNativeReady(page)
  await page.getByRole('button', { name: '+ Add a longer note', exact: true }).click()
  const canvas = page.getByRole('textbox', { name: 'Writing canvas', exact: true })

  await replaceCanvasSource(canvas, { before: '', after: source })
  await page.reload()
  await expectCanvasSource(canvas, source)
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
  await continueButton.focus()
  await page.keyboard.press('Enter')
  const portal = page.getByRole('dialog', { name: 'Publish post', exact: true })
  const review = portal.locator('.creator-review')
  await expectModalOpen(portal, review)
  await page.keyboard.press('Escape')
  await expect(review).not.toBeVisible()
  await expect(continueButton).toBeFocused()
  await continueButton.click()
  await expectModalOpen(portal, review)
  await review.getByRole('textbox', { name: 'Story URL', exact: true }).fill(slug)
  await review.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Published.' })).toBeVisible()
  const published = page.getByRole('link', { name: 'View published content', exact: true })
  await expect(published).toHaveAttribute('href', `/tweet/${slug}`)
  await published.click()
  await expect(page).toHaveURL(new RegExp(`/tweet/${slug}$`))
  const response = await page.request.get(`/tweet/${slug}`)
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain(source)
})

test('bottom navigation search groups results and closes on selection', async ({ page }) => {
  await page.goto('/privacy')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const portal = page.getByRole('dialog', { name: 'Search', exact: true })
  const dialog = portal.locator('.search-dialog')
  await expectModalOpen(portal, dialog)
  await dialog.getByRole('searchbox', { name: 'Search query' }).focus()
  await page.keyboard.press('Enter')
  await expectModalOpen(portal, dialog)
  await dialog.getByRole('searchbox', { name: 'Search query' }).fill('Local Frequencies')
  await expect(dialog.getByRole('heading', { name: 'Mixes', exact: true })).toBeVisible()
  await dialog.getByRole('link', { name: 'Local Frequencies', exact: true }).click()
  await expect(page).toHaveURL(/\/mixes\/e2e-local-frequencies$/)
  await expect(dialog).not.toBeVisible()
  await page.keyboard.press('Control+k')
  await expectModalOpen(portal, dialog)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Menu', exact: true })
  await expectModalOpen(menu, menu.locator('.menu-sheet'))
  await page.getByRole('link', { name: 'Mixes', exact: true }).click()
  await expect(page).toHaveURL(/\/mixes$/)
  await expect(menu.locator('.menu-sheet')).not.toBeVisible()
})

test('appearance persists explicit themes and responds to system changes', async ({ page }) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/dashboard/appearance')
  await page.getByRole('button', { name: 'light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'light', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'system', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Menu', exact: true })
    .getByRole('link', { name: 'About', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('root profile resolves public content and latest tweet navigation follows JSON redirects', async ({
  page,
  request,
}) => {
  const profile = await request.get('/local-creator')
  expect(profile.status()).toBe(200)
  expect(await profile.text()).toContain('Local Frequencies')
  await page.goto('/local-creator')
  await expect(page.getByRole('heading', { name: 'Mixes', exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('link', { name: 'Tweets', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/[^/?]+$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const data = await request.get('/tweet/latest?__data=1')
  expect(data.status()).toBe(200)
  expect(data.headers()['content-type']).toContain('application/json')
})

test('subscription explains its JavaScript requirement while unsubscribe remains available without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/subscribe')
  await expect(
    page.getByRole('navigation', { name: 'Navigation without JavaScript', exact: true }),
  ).toHaveCSS('position', 'fixed')
  await expect(page.locator('body')).toHaveCSS('margin', '0px')
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(`subscriber-${Date.now()}@gbfm.local`)
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeDisabled()
  await expect(
    page.getByText('JavaScript is required to verify your browser and submit this form.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.goto('/unsubscribe?token=invalid-token')
  await expect(page.getByRole('button', { name: 'Confirm unsubscribe' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await context.close()
})

test('show selection survives reload and history, with distinct populated and empty episode lists', async ({
  page,
  request,
}) => {
  const response = await request.get('/e2e-local-radio?__data=1')
  expect(response.status()).toBe(200)
  expect(response.url()).toContain('/shows/e2e-local-radio')
  expect(response.headers()['content-type']).toContain('application/json')
  await page.goto('/shows?show=e2e-local-radio')
  await expect(page.getByRole('heading', { name: 'Local Radio', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Local Frequencies', exact: true })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Shows', exact: true })
    .getByRole('link', { name: 'Quiet Hours' })
    .click()
  await expect(page).toHaveURL(/\/shows\/e2e-quiet-hours$/)
  await expect(page.getByText('No episodes yet.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Quiet Hours', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Local Radio', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play episode 1: Local Frequencies', exact: true }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Now playing', exact: true })
      .getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible()
})
