import { expect, type Page, test } from '@playwright/test'

const mixPath = '/mixes/e2e-local-frequencies'

const nowPlaying = (page: Page) => page.getByRole('region', { name: 'Now playing' })

const openPlayer = (page: Page) =>
  page.getByRole('button', { name: 'Now playing', exact: true }).click()

const collapse = (page: Page) =>
  page.getByRole('button', { name: 'Collapse player', exact: true }).click()

test('signed-out listeners get a sign-in link that returns to the current page', async ({
  page,
}) => {
  await page.goto(mixPath)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const signIn = nowPlaying(page).getByRole('link', { name: 'Sign in to favorite', exact: true })
  await expect(signIn).toHaveAttribute(
    'href',
    `/auth/sign-in?returnTo=${encodeURIComponent(mixPath)}`,
  )
  await expect(nowPlaying(page).getByRole('button', { name: 'Add to favorites' })).toHaveCount(0)
})

test('the player heart saves the queued track only after the server acknowledges', async ({
  page,
}) => {
  await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(mixPath)}`)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('listener@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${mixPath}$`))
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  const leftover = page.getByRole('button', { name: 'Remove from favorites', exact: true })

  if (await leftover.isVisible()) {
    await leftover.click()
    await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Play', exact: true }).click()

  const add = nowPlaying(page).getByRole('button', { name: 'Add to favorites', exact: true })

  const remove = nowPlaying(page).getByRole('button', {
    name: 'Remove from favorites',
    exact: true,
  })

  await expect(add).toHaveAttribute('aria-pressed', 'false')
  await expect
    .poll(() =>
      page
        .locator('.player-panel')
        .evaluate((panel) => Math.round(panel.getBoundingClientRect().top)),
    )
    .toBe(0)
  const heartBounds = await add.boundingBox()
  const playback = nowPlaying(page).getByRole('slider', { name: 'Playback position' })
  const playbackBounds = await playback.boundingBox()

  await page.route('**/api/favorites', (route) => route.fulfill({ status: 403, body: 'Forbidden' }))
  await add.click()
  await expect(nowPlaying(page).getByText('Favorite could not be saved. Try again.')).toBeVisible()
  await expect(add).toBeEnabled()
  await expect(add).toHaveAttribute('aria-pressed', 'false')
  await expect(
    nowPlaying(page).getByRole('link', { name: 'Sign in to favorite', exact: true }),
  ).toHaveCount(0)
  await nowPlaying(page).getByRole('button', { name: 'Dismiss favorite notice' }).click()
  await page.unroute('**/api/favorites')

  await page.route('**/api/favorites', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await add.click()
  await expect(nowPlaying(page).getByText('Favorite could not be saved. Try again.')).toBeVisible()
  const dismissNotice = nowPlaying(page).getByRole('button', { name: 'Dismiss favorite notice' })
  await expect(dismissNotice).toBeVisible()
  const dismissBounds = await dismissNotice.boundingBox()
  expect(dismissBounds?.width).toBeGreaterThanOrEqual(44)
  expect(dismissBounds?.height).toBeGreaterThanOrEqual(44)

  for (const [actual, previous] of [
    [await add.boundingBox(), heartBounds],
    [await playback.boundingBox(), playbackBounds],
  ]) {
    if (!actual || !previous) throw new Error('Player controls must remain measurable')

    expect(actual.x).toBeCloseTo(previous.x, 1)
    expect(actual.y).toBeCloseTo(previous.y, 1)
    expect(actual.width).toBeCloseTo(previous.width, 1)
    expect(actual.height).toBeCloseTo(previous.height, 1)
  }

  await dismissNotice.click()
  await expect(nowPlaying(page).getByText('Favorite could not be saved. Try again.')).toHaveCount(0)
  await add.click()
  await expect(nowPlaying(page).getByText('Favorite could not be saved. Try again.')).toBeVisible()
  await expect(dismissNotice).toHaveCount(0, { timeout: 6000 })
  await expect(add).toHaveAttribute('aria-pressed', 'false')
  await expect(add).toBeEnabled()
  await page.unroute('**/api/favorites')

  let release = () => {}

  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  await page.route('**/api/favorites', async (route) => {
    await held
    await route.continue()
  })
  await add.click()
  await expect(add).toBeDisabled()
  await expect(add).toHaveAttribute('aria-pressed', 'false')
  release()
  await expect(remove).toHaveAttribute('aria-pressed', 'true')
  await page.unroute('**/api/favorites')

  await collapse(page)
  await expect(
    page.getByRole('button', { name: 'Remove from favorites', exact: true }),
  ).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .getByRole('link', { name: 'Editorial', exact: true })
    .click()
  await expect(page).toHaveURL(/\/editorial$/)
  await openPlayer(page)
  await expect(remove).toHaveAttribute('aria-pressed', 'true')
  await collapse(page)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${mixPath}$`))
  const pageRemove = page.getByRole('button', { name: 'Remove from favorites', exact: true })
  await expect(pageRemove).toBeVisible()
  await pageRemove.click()
  await expect(page.getByRole('button', { name: 'Add to favorites', exact: true })).toBeVisible()
  await openPlayer(page)
  await expect(add).toHaveAttribute('aria-pressed', 'false')
  await collapse(page)

  await page.route('**/api/content/audio/mix/e2e-local-frequencies/page', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await page.reload()
  await openPlayer(page)
  await expect(nowPlaying(page).getByText('Favorite status could not be loaded.')).toBeVisible()
  await page.unroute('**/api/content/audio/mix/e2e-local-frequencies/page')
  await nowPlaying(page)
    .getByRole('button', { name: 'Retry loading favorite', exact: true })
    .click()
  await expect(add).toHaveAttribute('aria-pressed', 'false')
  await page.route('**/api/favorites', (route) =>
    route.fulfill({ status: 401, body: 'Unauthorized' }),
  )
  await add.click()
  await expect(
    nowPlaying(page).getByRole('link', { name: 'Sign in to favorite', exact: true }),
  ).toBeVisible()
})
