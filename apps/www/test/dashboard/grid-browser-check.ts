import { chromium, devices, expect, type Page } from '@playwright/test'
import { Schema } from 'effect'

const baseURL = process.env.PLAYWRIGHT_BASE_URL

if (!baseURL) throw new Error('An explicitly configured disposable frontend is required.')

const sourceCss = await Bun.file(
  new URL('../../src/features/dashboard/native.css', import.meta.url),
).text()

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? Bun.which('chromium') ?? undefined,
  headless: true,
})

const context = await browser.newContext({
  ...devices['Pixel 5'],
  colorScheme: 'dark',
  baseURL,
})

const page = await context.newPage()

const measurements: Array<object> = []

page.setDefaultTimeout(8000)

const ready = async (page: Page) => {
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  await page.addStyleTag({ content: sourceCss })
}

const contained = async (label: string, tableName: string) => {
  const table = page.getByRole('table', { name: tableName, exact: true })
  await expect(table).toBeVisible()

  const geometry = await table.evaluate((node) => {
    const wrapper = node.parentElement

    if (!(wrapper instanceof HTMLElement)) throw new Error('Table wrapper missing')

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      wrapperWidth: wrapper.clientWidth,
      localScrollWidth: wrapper.scrollWidth,
      tableWidth: node.getBoundingClientRect().width,
    }
  })

  measurements.push({ label, ...geometry })
  expect(geometry.documentWidth, `${label}: document contains overflow`).toBeLessThanOrEqual(
    geometry.viewportWidth,
  )
  expect(geometry.tableWidth).toBeGreaterThanOrEqual(576)
  expect(geometry.localScrollWidth).toBeGreaterThan(geometry.wrapperWidth)

  return table
}

try {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('admin@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.goto('/dashboard/shows')
  await ready(page)
  const shows = await contained('shows', 'Shows')
  await shows
    .getByRole('row')
    .filter({ hasText: 'e2e-local-radio' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click()
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Local Radio')

  await page.goto('/dashboard/users?search=admin%40gbfm.local')
  await ready(page)
  const users = await contained('users', 'User accounts')
  await users
    .locator('summary')
    .filter({ hasText: /^More$/ })
    .click()
  await expect(users.getByRole('button', { name: 'Invite', exact: true })).toBeVisible()

  await page.goto('/dashboard/playlists')
  await ready(page)
  const playlists = await contained('playlists', 'Playlists')
  const row = playlists.getByRole('row').filter({ hasText: 'e2e-spotify-playlist' })
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Playlist title', exact: true })).toHaveValue(
    'Local playlist',
  )
  await page.getByRole('button', { name: 'Back to list', exact: true }).click()
  await page
    .locator('summary')
    .filter({ hasText: /^Import from Spotify$/ })
    .click()
  await page
    .getByRole('textbox', { name: 'Spotify playlist URL', exact: true })
    .fill('https://example.com/playlist/no')
  await page.getByRole('button', { name: 'Import playlist', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await page.goto('/dashboard/email-logs?recipientEmail=history%40example.test&status=SENT')
  await ready(page)
  await contained('delivery', 'Delivery history')
  const pages = page.getByRole('navigation', { name: 'Delivery history pages' })
  await pages.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/offset=25/)
  await expect(
    page.getByRole('table', { name: 'Delivery history' }).locator('tbody tr'),
  ).toHaveCount(2)

  await page.goto('/dashboard/sessions')
  await ready(page)
  await page.route('**/auth/admin/list-user-sessions', async (route) => {
    const { userId } = Schema.decodeUnknownSync(Schema.Struct({ userId: Schema.String }))(
      route.request().postDataJSON(),
    )

    await route.fulfill({
      json: {
        sessions: [
          {
            id: 'grid-fixture-session',
            userId,
            token: 'synthetic-grid-fixture-not-a-real-session',
            createdAt: '2026-11-27T10:00:00Z',
            expiresAt: '2026-12-04T10:00:00Z',
            userAgent: 'GBFM grid fixture',
            ipAddress: null,
          },
        ],
      },
    })
  })
  await page.getByRole('searchbox', { name: 'Search user by email' }).fill('admin@gbfm.local')
  await page.getByRole('button', { name: 'Search users', exact: true }).click()
  await page
    .getByRole('button', { name: 'View sessions for admin@gbfm.local', exact: true })
    .click()
  const sessions = await contained('sessions', 'Active sessions')
  let intercepted = false
  await page.route('**/auth/admin/revoke-user-session', async (route) => {
    intercepted = true
    await route.fulfill({ status: 503, json: { error: 'Disposable physical-click regression' } })
  })
  const ownSession = sessions.getByRole('row').filter({ hasText: 'GBFM grid fixture' })
  await ownSession
    .getByRole('button', { name: 'Revoke session', exact: true })
    .scrollIntoViewIfNeeded()
  const localScroll = await sessions.evaluate((node) => node.parentElement?.scrollLeft)
  expect(localScroll).toBeGreaterThan(0)
  measurements.push({ label: 'local table scrolling before request re-render', localScroll })
  await ownSession.getByRole('button', { name: 'Revoke session', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not complete the session request.')
  expect(intercepted).toBe(true)

  const scroll = await sessions.evaluate((node) => ({
    local: node.parentElement?.scrollLeft,
    document: window.scrollX,
    visual: visualViewport?.offsetLeft,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))

  expect(scroll.document).toBe(0)
  expect(scroll.visual).toBe(0)
  expect(scroll.documentWidth).toBeLessThanOrEqual(scroll.viewportWidth)
  measurements.push({ label: 'local scroll after physical revoke click', ...scroll })

  const noScript = await browser.newContext({
    ...devices['Pixel 5'],
    colorScheme: 'dark',
    baseURL,
    javaScriptEnabled: false,
    storageState: { cookies: await context.cookies(), origins: [] },
  })

  try {
    const noScriptPage = await noScript.newPage()
    noScriptPage.setDefaultTimeout(8000)
    await noScriptPage.route('**/dashboard/users?search=admin%40gbfm.local', async (route) => {
      const response = await route.fetch()
      const html = await response.text()
      await route.fulfill({
        response,
        body: html.replace('</head>', `<style>${sourceCss}</style></head>`),
      })
    })
    await noScriptPage.goto('/dashboard/users?search=admin%40gbfm.local')
    const accounts = noScriptPage.getByRole('table', { name: 'User accounts', exact: true })

    const geometry = await accounts.evaluate((node) => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      wrapperWidth: node.parentElement?.clientWidth,
      tableWidth: node.getBoundingClientRect().width,
    }))

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.tableWidth).toBeGreaterThanOrEqual(576)
    await accounts
      .locator('summary')
      .filter({ hasText: /^More$/ })
      .click()
    await expect(accounts.getByRole('button', { name: 'Invite', exact: true })).toBeVisible()
    measurements.push({ label: 'no-JavaScript users physical More click', ...geometry })
  } finally {
    await noScript.close()
  }

  console.log(
    'PASS: source Dashboard CSS contains native tables; local scrolling and physical Edit/More/Import/Next/Revoke clicks work.',
  )
} finally {
  if (process.env.GBFM_GRID_PROOF_OUTPUT)
    await Bun.write(process.env.GBFM_GRID_PROOF_OUTPUT, JSON.stringify(measurements, null, 2))
  await context.close()
  await browser.close()
}
