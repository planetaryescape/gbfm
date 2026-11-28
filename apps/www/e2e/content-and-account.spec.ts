import { expect, test } from '@playwright/test'

test('changelog renders release history without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })

  try {
    const page = await context.newPage()
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'}/changelog`)
    await expect(page.getByRole('heading', { name: 'Changelog', exact: true })).toBeVisible()
    await expect(
      page.locator('.rich-content').getByRole('link', { name: '2.100.2', exact: true }),
    ).toHaveAttribute('href', 'https://github.com/guidefari/gbfm/compare/v2.100.1...v2.100.2')
  } finally {
    await context.close()
  }
})

test('tags link to all matching public post types and handle an empty tag', async ({ page }) => {
  await page.goto('/tags')
  await page.getByRole('link', { name: '#local-music', exact: true }).click()
  await expect(page.getByRole('heading', { name: '#local-music', exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Local listening notes', exact: true }),
  ).toHaveAttribute('href', '/editorial/e2e-listening-notes')
  await expect(
    page.getByRole('link', { name: 'A tweet with a musical reply.', exact: true }),
  ).toHaveAttribute('href', '/tweet/e2e-music-thread')
  await page.getByRole('link', { name: 'Local listening notes', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Local listening notes', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Tags', exact: true })).toContainText(
    '#local-music',
  )
  await page.goto('/tags/e2e-empty-tag')
  await expect(page.getByText('No posts with this tag yet.', { exact: true })).toBeVisible()
})

test('releases show their release date and safe listening links', async ({ page }) => {
  await page.goto('/releases/e2e-local-signals')
  await expect(page.getByRole('heading', { name: 'Local Signals EP', exact: true })).toBeVisible()
  await expect(page.locator('article.content-detail time')).toHaveText('May 14, 2020')
  const link = page.getByRole('link', { name: 'Bandcamp', exact: true })
  await expect(link).toHaveAttribute('href', 'https://example.bandcamp.com/album/signals')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('public writing renders canonical rich content without executing arbitrary markup', async ({
  page,
}) => {
  await page.route('https://w.soundcloud.com/**', (route) => route.abort())
  await page.goto('/mixes/e2e-local-frequencies')
  await expect(page.getByRole('heading', { name: 'Listening notes' })).toBeVisible()
  await expect(page.locator('.rich-content strong')).toHaveText('independent signal')
  await expect(page.getByRole('link', { name: 'Read more' })).toHaveAttribute(
    'href',
    'https://example.com/music',
  )
  await expect(page.locator('.rich-content iframe')).toHaveCount(1)
  await expect(page.locator('.rich-content iframe')).toHaveAttribute(
    'src',
    'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fgbfm%2Flocal-frequencies&visual=false',
  )
  await expect(page.locator('.rich-content a[href^="javascript:"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click()
  await page.getByRole('button', { name: 'Open queue', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Queue', exact: true })).toContainText(
    'Local Frequencies',
  )
})

test('a migrated legacy track renders from the GBFM catalog without client metadata fetches', async ({
  page,
}) => {
  const spotifyRequests: Array<string> = []
  page.on('request', (request) => {
    const hostname = new URL(request.url()).hostname

    if (hostname === 'open.spotify.com' || hostname.endsWith('.spotify.com'))
      spotifyRequests.push(request.url())
  })

  await page.goto('/editorial/e2e-listening-notes')
  const card = page.locator('.rich-content-music-card').filter({ hasText: 'Grapefruit' })
  await expect(card).toContainText('Grapefruit')
  await expect(card).toContainText('Lack')
  await expect(card).toContainText('experimental')
  await expect(card).toContainText('A catalog-backed selection from the original article.')
  await expect(page.locator('.rich-content')).not.toContainText('::track')

  const fallback = page
    .locator('.rich-content-music-card')
    .filter({ hasText: 'A retained playlist without cover artwork' })

  await expect(fallback.locator('img')).toHaveCount(0)
  await expect(
    fallback.getByRole('link', {
      name: 'Listen to A retained playlist without cover artwork on Spotify (opens in a new tab)',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://open.spotify.com/playlist/3m4J7Xt1mA5CqSnXl4zgpZ')

  const copyShare = (music: typeof card) =>
    music.evaluate((element) => {
      const head = element.querySelector('.rich-content-music-head')
      const copy = element.querySelector('.rich-content-music-copy')

      return (copy?.clientWidth ?? 0) / (head?.clientWidth ?? 1)
    })

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await copyShare(fallback)).toBeGreaterThan(0.99)
    await expect(card.locator('img')).toHaveCount(1)
    const withArtwork = await copyShare(card)
    expect(withArtwork).toBeGreaterThan(0.5)
    expect(withArtwork).toBeLessThan(0.95)
  }

  expect(spotifyRequests).toEqual([])
})

test('reset form preserves its token and signing out invalidates the session', async ({ page }) => {
  await page.goto('/auth/reset-password?token=local-test-token')
  await expect(page.locator('input[name="token"]')).toHaveValue('local-test-token')
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveCount(0)
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page
    .getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('link', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('link', { name: 'Player', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Continue through queue' })).toBeChecked()
  await page.getByRole('checkbox', { name: 'Continue through queue' }).uncheck()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gbfm-player-preferences.json')))
    .toBe('{"continueQueue":false,"restorePosition":true}')
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Continue through queue' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Restore listening position' })).toBeChecked()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/dashboard/profile')
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
})
