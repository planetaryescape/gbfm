import { expect, test } from '@playwright/test'

import { expectNativeReady } from './fixtures/native-ready'

test('a failed Spotify chunk offers a full reload without replaying authorization', async ({
  page,
}, testInfo) => {
  let failRuntime = true
  let authorizations = 0
  let providerWrites = 0
  await page.route('**/assets/runtime-*.js', (route) =>
    failRuntime ? route.abort('failed') : route.continue(),
  )
  await page.route('https://api.spotify.com/**', (route) => {
    if (route.request().method() !== 'GET') providerWrites++

    return route.abort('blockedbyclient')
  })
  await page.route('https://accounts.spotify.com/authorize?**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('client_id')).toBeTruthy()
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    authorizations++
    await route.fulfill({ contentType: 'text/html', body: 'Disposable authorization fixture' })
  })
  await page.goto('/tweet/e2e-music-thread')
  await expectNativeReady(page)
  const reload = page.getByRole('button', { name: 'Reload page for Spotify', exact: true })
  const connect = page.getByRole('button', { name: 'Connect Spotify', exact: true })
  await expect(reload).toBeVisible()
  await connect.click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Spotify could not load. Reload this page and try again.' }),
  ).toBeVisible()
  expect(authorizations).toBe(0)
  expect(providerWrites).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('spotify-load-recovery.png') })

  failRuntime = false
  await Promise.all([page.waitForEvent('domcontentloaded'), reload.click()])
  await expectNativeReady(page)
  await expect(page).toHaveURL(/\/tweet\/e2e-music-thread$/)
  await expect(connect).toBeEnabled()
  await expect(reload).toHaveCount(0)
  expect(authorizations).toBe(0)
  expect(providerWrites).toBe(0)
  await connect.click()
  await expect(page).toHaveURL(/accounts.spotify.com\/authorize/)
  expect(authorizations).toBe(1)
  expect(providerWrites).toBe(0)
})
