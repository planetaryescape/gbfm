import { expect, test } from '@playwright/test'

import { expectNativeReady } from './fixtures/native-ready'

test('desktop playback uses the mobile pixel glyph without a framed or circular button', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem(
      'gbfm-audio-queue.json',
      JSON.stringify({
        currentIndex: 0,
        tracks: [
          {
            id: 'annotation-preview',
            title: 'Disposable playback preview',
            slug: 'annotation-preview',
            thumbnailUrl: null,
            url: '/not-played.wav',
            type: 'mix',
          },
        ],
      }),
    )
  })
  await page.goto('/tweet/e2e-archive-one')
  await expectNativeReady(page)
  const navigation = page.locator('.station-desktop')
  const play = navigation.getByRole('button', { name: 'Play', exact: true })
  await expect(play).toBeVisible()
  await expect(navigation.getByRole('button', { name: /^Theme:/ })).toHaveCount(0)
  await expect(play.locator('path')).toHaveAttribute('d', 'M6 4V20H10V17H14V14H18V10H14V7H10V4Z')
  await expect(play).toHaveCSS('border-top-width', '0px')
  await expect(play).toHaveCSS('border-radius', '0px')
  const bounds = await play.boundingBox()
  expect(bounds?.width).toBe(44)
  expect(bounds?.height).toBe(44)
  const reader = page.getByRole('navigation', { name: 'Tweet reader', exact: true })
  await expect(reader.getByRole('link', { name: 'View latest', exact: true })).toBeVisible()
  expect((await reader.boundingBox())?.height).toBeLessThanOrEqual(64)
  await expect(page.getByRole('progressbar', { name: 'Reading progress' })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('desktop-reader.png') })
})

test('pending authenticated navigation shows skeletons without login flashes or admin link shifts', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/auth/sign-in')
  await expectNativeReady(page)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('admin@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expectNativeReady(page)
  const navigation = page.locator('.station-desktop')
  await expect(navigation.getByRole('button', { name: 'Account menu' })).toBeVisible()
  const editorial = navigation.getByRole('link', { name: 'Editorial', exact: true })
  const before = await editorial.boundingBox()
  const gate = Promise.withResolvers<void>()
  const prepared = Promise.withResolvers<void>()
  await page.route('**/editorial?__data=1', async (route) => {
    const response = await route.fetch()
    prepared.resolve()
    await gate.promise
    await route.fulfill({ response })
  })

  try {
    await editorial.click()
    await prepared.promise
    await expect(navigation.getByRole('status', { name: 'Checking account' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
    await expect(navigation.getByRole('link', { name: 'Collections', exact: true })).toHaveCount(0)
    await expect(page.locator('main section[aria-label="Loading page"]')).toBeVisible()
    const pending = await editorial.boundingBox()
    expect(pending?.x).toBe(before?.x)
    await page.screenshot({ path: info.outputPath('pending-editorial.png') })
  } finally {
    gate.resolve()
  }

  await expect(page.getByRole('heading', { name: 'Editorial', exact: true })).toBeVisible()
  await expect(navigation.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Collections', exact: true })).toBeVisible()
  expect((await editorial.boundingBox())?.x).toBe(before?.x)
  await page.screenshot({ path: info.outputPath('editorial-ready.png') })
})
