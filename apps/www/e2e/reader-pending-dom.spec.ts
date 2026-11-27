import { expect, test } from '@playwright/test'

import { expectNativeReady } from './fixtures/native-ready'

test('a pending reader neighbour is visible but inert and cannot record an early or duplicate visit', async ({
  page,
}) => {
  const release = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  const seen: Array<string> = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/seen'))
      seen.push(new URL(request.url()).pathname)
  })
  await page.goto('/tweet/e2e-archive-one')
  await expectNativeReady(page)
  const source = page.locator('[data-tweet-swipe="e2e-archive-one"]')
  await expect(source).toHaveAttribute('data-swipe-ready', 'true')
  await expect.poll(() => seen.filter((path) => path.includes('/e2e-archive-one/')).length).toBe(1)
  await page.route('**/tweet/e2e-archive-two?__data=1', async (route) => {
    requested.resolve()
    await release.promise
    await route.continue()
  })

  try {
    await page.getByRole('link', { name: 'Newer tweet', exact: true }).click()
    await requested.promise
    await expect(source).toBeVisible()
    await expect(source).toHaveAttribute('data-swipe-ready', 'false')
    await expect(page.locator('[inert] [data-tweet-swipe="e2e-archive-one"]')).toBeVisible()
    expect(seen.filter((path) => path.includes('/e2e-archive-two/'))).toHaveLength(0)
    release.resolve()
    await expect(page.locator('[data-tweet-swipe="e2e-archive-two"]')).toHaveAttribute(
      'data-swipe-ready',
      'true',
    )
    await expect
      .poll(() => seen.filter((path) => path.includes('/e2e-archive-two/')).length)
      .toBe(1)
    expect(seen.filter((path) => path.includes('/e2e-archive-one/'))).toHaveLength(1)
  } finally {
    release.resolve()
  }
})
