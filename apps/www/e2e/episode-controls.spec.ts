import { expect, test } from '@playwright/test'

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
]) {
  test(`${viewport.name} episode controls stay visible and support play/pause`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/shows/e2e-local-radio')

    const control = page.getByRole('button', {
      name: 'Play episode 1: Local Frequencies',
      exact: true,
    })

    await expect(control).toBeEnabled()
    const icon = control.locator('.episode-play-icon')
    await expect(icon).toHaveCSS('opacity', '1')
    await expect(icon).toHaveCSS('width', '44px')
    await expect(icon).toHaveCSS('height', '44px')
    await expect(control.locator('.episode-play-number')).toHaveText('001')

    const pageWidth = await page.evaluate(() => ({
      viewport: innerWidth,
      content: document.documentElement.scrollWidth,
    }))

    expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport)
    await control.click()
    const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
    const panel = page.locator('#fullscreen-player-panel')
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(panel).not.toHaveAttribute('data-transition')
    await player.getByRole('button', { name: 'Collapse player' }).click()

    const pause = page.getByRole('button', {
      name: 'Pause episode 1: Local Frequencies',
      exact: true,
    })

    await expect(pause).toHaveAttribute('aria-pressed', 'true')
    await pause.click()
    await expect(control).toHaveAttribute('aria-pressed', 'false')
    await expect(icon).toHaveCSS('opacity', '1')

    const mini = page.getByRole('region', { name: 'Mini player', exact: true })
    await expect(mini).toBeVisible()
    await expect(mini).toContainText('Local Frequencies')
    await expect(page.locator('.show-compact')).not.toBeVisible()
    const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await expect(mini.getByRole('button', { name: 'Play', exact: true })).toHaveCSS('width', '44px')
    await mini.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(pause).toHaveAttribute('aria-pressed', 'true')
    await mini.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(control).toHaveAttribute('aria-pressed', 'false')
    await expect(mini.getByRole('button', { name: 'Next track', exact: true })).toHaveCount(0)
    await mini.getByRole('button', { name: 'Now playing', exact: true }).click()
    await expect(player).toBeVisible()
    await expect(panel).not.toHaveAttribute('data-transition')
    await player.getByRole('button', { name: 'Collapse player' }).click()
    await expect(player).not.toBeVisible()

    const dock = page.locator('.mobile-dock')
    const showTabs = navigation.locator('.dock-tabs-expand')
    await expect(showTabs).toHaveAttribute('tabindex', '-1')
    await expect(showTabs).toHaveAttribute('aria-hidden', 'true')
    await page.evaluate(() => {
      document.querySelector('main')?.style.setProperty('min-height', '200vh')
      window.scrollTo(0, 0)
    })
    await page.evaluate(() => window.scrollBy(0, 200))
    await expect(dock).toHaveAttribute('data-minimized', '')
    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeHidden()
    await expect(mini).toBeVisible()
    await navigation.getByRole('button', { name: 'Show tabs', exact: true }).click()
    await expect(dock).not.toHaveAttribute('data-minimized')
    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(dock).not.toHaveAttribute('data-minimized')

    await page.reload()
    await expect(mini).toContainText('Local Frequencies')
    await expect(mini.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  })
}

test('restored long titles leave compact playback controls reachable', async ({ page }) => {
  const title = 'Local Frequencies: An Extended Transmission from the Independent Radio Archives'
  await page.setViewportSize({ width: 320, height: 740 })
  await page.addInitScript((title) => {
    localStorage.setItem('vite-ui-theme', 'dark')
    localStorage.setItem(
      'gbfm-audio-queue.json',
      JSON.stringify({
        currentIndex: 0,
        tracks: [
          {
            id: 'long-title-fixture',
            title,
            slug: 'e2e-local-frequencies',
            thumbnailUrl: null,
            url: '/api/e2e-audio.wav',
            type: 'mix',
          },
          {
            id: 'next-title-fixture',
            title: 'Next local transmission',
            slug: 'e2e-local-frequencies',
            thumbnailUrl: null,
            url: '/api/e2e-audio.wav',
            type: 'mix',
          },
        ],
      }),
    )
  }, title)
  await page.goto('/shows/e2e-local-radio')
  const mini = page.getByRole('region', { name: 'Mini player', exact: true })
  const play = mini.getByRole('button', { name: 'Play', exact: true })
  await expect(mini).toContainText(title)
  await expect(play).toBeEnabled()
  await expect(mini.getByRole('button', { name: 'Next track', exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    document.querySelector('main')?.style.setProperty('min-height', '200vh')
    window.scrollBy(0, 200)
  })
  await expect(page.locator('.mobile-dock')).toHaveAttribute('data-minimized', '')
  await expect(play).toHaveCSS('width', '44px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await mini.getByRole('button', { name: 'Now playing', exact: true }).click()
  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await player.getByRole('button', { name: 'Next track', exact: true }).click()
  await expect(player).toContainText('Next local transmission')
})

test('desktop retains episode numbers and reveals playback on keyboard focus', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
  })

  const page = await context.newPage()
  await page.goto(
    `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173'}/shows/e2e-local-radio`,
  )

  const control = page.getByRole('button', {
    name: 'Play episode 1: Local Frequencies',
    exact: true,
  })

  await expect(control).toBeEnabled()
  await page.mouse.move(0, 0)
  await expect(control.locator('.episode-play-number')).toHaveCSS('font-size', '36px')
  await expect(control.locator('.episode-play-icon')).toHaveCSS('opacity', '0')
  await control.focus()
  await expect(control.locator('.episode-play-icon')).toHaveCSS('opacity', '1')
  await context.close()
})
