import { expect, test } from '@playwright/test'

test('SSR keeps client-only controls disabled while ordinary links remain usable', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })

  try {
    const page = await context.newPage()
    await page.goto('/mixes/e2e-local-frequencies')
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled()
    await page.getByRole('link', { name: 'Sign in to favorite', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeEditable()
  } finally {
    await context.close()
  }
})

test('favorite and subscription controls persist and mutations do not interrupt playback', async ({
  page,
}) => {
  await page.goto('/mixes/e2e-local-frequencies')
  await page.getByRole('link', { name: 'Sign in to favorite', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('listener@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/mixes\/e2e-local-frequencies$/)
  const existingFavorite = page.getByRole('button', { name: 'Remove from favorites', exact: true })

  if (await existingFavorite.isVisible()) await existingFavorite.click()

  await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole('region', { name: 'Now playing' })
          .getByRole('slider', { name: 'Playback position' })
          .inputValue(),
      ),
    )
    .toBeGreaterThan(0.5)
  await page.getByRole('button', { name: 'Collapse player', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Now playing', exact: true })).toBeHidden()
  const timeOrigin = await page.evaluate(() => performance.timeOrigin)
  await page.route('**/api/favorites', (route) => route.fulfill({ status: 403, body: 'Forbidden' }))
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click()
  await expect(page.getByText('Action failed. Please try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeEnabled()
  await expect(page.getByRole('link', { name: 'Sign in to favorite', exact: true })).toHaveCount(0)
  await page.unroute('**/api/favorites')

  await page.route('**/api/favorites', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click()
  await expect(page.getByText('Action failed. Please try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeEnabled()
  await page.unroute('**/api/favorites')
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Remove from favorites', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Now playing', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Now playing' })
      .getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await page.reload()
  await page.getByRole('button', { name: 'Remove from favorites', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeVisible()

  await page.goto('/shows/e2e-local-radio')
  const existingSubscription = page.getByRole('button', { name: 'Unsubscribe', exact: true })

  if (await existingSubscription.isVisible()) await existingSubscription.click()

  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unsubscribe', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
  await page.route('**/api/shows/*/subscribe', (route) =>
    route.fulfill({ status: 401, body: 'Unauthorized' }),
  )
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Sign in to subscribe', exact: true })).toBeVisible()
})

test('sign-in never redirects to an external return URL', async ({ page }) => {
  await page.goto('/auth/sign-in?returnTo=https%3A%2F%2Fexample.com%2Fescape')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})
