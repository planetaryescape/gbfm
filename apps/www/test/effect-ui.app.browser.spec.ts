import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { expect, type Page, test, type TestInfo } from '@playwright/test'

const pages = [
  { path: '/about', heading: 'About' },
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Service' },
]

const screenshot = async (page: Page, info: TestInfo, name: string) => {
  const directory = process.env.GBFM_EFFECT_EVIDENCE_DIR
  const path = directory ? resolve(directory, name) : info.outputPath(name)
  await mkdir(dirname(path), { recursive: true })
  await page.screenshot({ path, fullPage: true })
  await info.attach(name, { path, contentType: 'image/png' })
}

test('real static routes deliver server-rendered headings and hydrate cleanly', async ({
  page,
  request,
}, info) => {
  const errors: Array<string> = []
  page.on('pageerror', (error) => errors.push(error.message))

  for (const route of pages) {
    const response = await request.get(route.path)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    const html = await response.text()
    expect(html).toContain(`<h1>${route.heading}</h1>`)
    expect(html).toContain('id="gbfm-ui-state"')
    expect(html).toContain('id="gbfm-ui-props"')
    await page.goto(route.path)
    await expect(
      page.getByRole('heading', { level: 1, name: route.heading, exact: true }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
    await expect(page.locator('.site')).toHaveCount(1)

    if (route.path === '/about') await screenshot(page, info, 'about-native-desktop.png')
  }

  expect(errors).toEqual([])
})

test('real application hydration adopts its existing server nodes', async ({ page }) => {
  const gate = Promise.withResolvers<void>()
  const errors: Array<string> = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*.js', async (route) => {
    await gate.promise
    await route.continue()
  })

  try {
    await page.goto('/about', { waitUntil: 'commit' })
    const heading = page.getByRole('heading', { name: 'About', level: 1, exact: true })
    await expect(heading).toBeVisible()
    const originalHeading = await heading.elementHandle()
    const originalSite = await page.locator('.site').elementHandle()

    if (!originalHeading || !originalSite) throw new Error('Missing real application SSR nodes')
    await expect(page.locator('html')).not.toHaveAttribute('data-gbfm-hydrated')
    gate.resolve()
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
    expect(await originalHeading.evaluate((node) => node.isConnected)).toBe(true)
    expect(await originalSite.evaluate((node) => node.isConnected)).toBe(true)
    await expect(page.locator('.site')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
  }
})

test('real theme control cycles, persists across reloads and follows system preference', async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/about')
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  await page.getByRole('button', { name: 'Theme: system', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Theme: light', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('vite-ui-theme'))).toBe('light')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Theme: light', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Theme: light', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Theme: dark', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('vite-ui-theme'))).toBe('dark')
  await screenshot(page, info, 'about-native-dark.png')
  await page.getByRole('button', { name: 'Theme: dark', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Theme: system', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('vite-ui-theme'))).toBe('system')
})

test('real static navigation follows the visible links between documents', async ({ page }) => {
  await page.goto('/about')

  for (const route of [
    { ...pages[1], label: 'Privacy' },
    { ...pages[2], label: 'Terms' },
    { ...pages[0], label: 'About' },
  ]) {
    if (!route.path || !route.heading) throw new Error('Missing static navigation fixture')
    const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
    const link = navigation.getByRole('link', { name: route.label, exact: true })
    await expect(link).toHaveAttribute('href', route.path)
    await Promise.all([page.waitForURL(`**${route.path}`), link.click()])
    await expect(
      page.getByRole('heading', { level: 1, name: route.heading, exact: true }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  }
})

test.describe('real application without JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  test('all static pages remain styled and readable on mobile', async ({ page }, info) => {
    for (const route of pages) {
      await page.goto(route.path)
      const heading = page.getByRole('heading', { level: 1, name: route.heading, exact: true })
      await expect(heading).toBeVisible()
      await expect(page.locator('html')).not.toHaveAttribute('data-gbfm-hydrated')
      expect(
        await heading.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
      ).toBeGreaterThan(24)
      expect(await page.locator('html').evaluate((node) => node.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(
        await page
          .locator('link[rel="stylesheet"]')
          .evaluateAll(
            (links) =>
              links.length > 0 &&
              links.every((link) => link instanceof HTMLLinkElement && link.sheet !== null),
          ),
      ).toBe(true)

      if (route.path === '/privacy') await screenshot(page, info, 'privacy-native-nojs-mobile.png')
    }
  })
})
