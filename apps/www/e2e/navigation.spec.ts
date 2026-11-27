import { expect, test } from '@playwright/test'

import { expectModalOpen } from './fixtures/native-ready'

test('client navigation replaces structured data and private robots metadata without duplicate canonicals', async ({
  page,
}) => {
  await page.goto('/auth/sign-in')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Menu', exact: true })
    .getByRole('link', { name: 'About', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
  await page.goto('/shows/e2e-local-radio')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await page.getByRole('link', { name: 'Local Frequencies', exact: true }).click()
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'music.song')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://goosebumps.fm/mixes/e2e-local-frequencies',
  )
  await expect
    .poll(() => page.locator('script[type="application/ld+json"]').textContent())
    .toContain('MusicRecording')
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Menu', exact: true })
    .getByRole('link', { name: 'About', exact: true })
    .click()
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website')
  await expect
    .poll(() => page.locator('script[type="application/ld+json"]').textContent())
    .not.toContain('MusicRecording')
})

test('a menu opened during navigation stays open when the page arrives', async ({ page }) => {
  let release = () => {}

  const pending = new Promise<void>((resolve) => {
    release = resolve
  })

  await page.route('**/editorial?__data=1', async (route) => {
    await pending
    await route.continue()
  })
  await page.goto('/privacy')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await page.getByRole('link', { name: 'Editorial', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Loading page' })).toBeVisible()
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Menu', exact: true })
  await expectModalOpen(menu, menu.locator('.menu-sheet'))
  release()
  await expect(page.getByRole('status', { name: 'Loading page' })).toHaveCount(0)
  await expectModalOpen(menu, menu.locator('.menu-sheet'))
})
