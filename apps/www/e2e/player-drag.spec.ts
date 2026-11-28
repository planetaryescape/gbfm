import { expect, test } from '@playwright/test'

test('pulling the player follows the pointer, snaps back, and dismisses past the threshold', async ({
  page,
}) => {
  await page.goto('/mixes')
  await page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  const panel = player.locator('.native-player-panel')
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(player).toBeVisible()
  const dialogBounds = await player.boundingBox()

  const viewport = page.viewportSize()

  if (!viewport) throw new Error('Expected a viewport for the fullscreen player')

  expect(dialogBounds?.width).toBeGreaterThanOrEqual(viewport.width)
  expect(dialogBounds?.height).toBeGreaterThanOrEqual(viewport.height)
  expect(await player.evaluate((element) => element.matches(':popover-open'))).toBe(true)
  await expect(panel).not.toHaveAttribute('data-starting-style')
  await expect
    .poll(() =>
      panel.evaluate((panel) =>
        panel.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false)
  const handle = player.locator('.player-drag-surface').first()
  const bounds = await handle.boundingBox()

  if (!bounds) throw new Error('Expected the player drag handle')
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(panel).toHaveAttribute('data-dragging')
  await page.mouse.move(x, y + 80, { steps: 5 })
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(80)
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(0)
  await expect(player).toBeVisible()
  expect(await player.evaluate((element) => element.matches(':popover-open'))).toBe(true)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(panel).toHaveAttribute('data-dragging')
  await page.mouse.move(x, y + 60, { steps: 3 })
  await handle.dispatchEvent('pointercancel', { bubbles: true })
  await page.mouse.up()
  await expect(panel).not.toHaveAttribute('data-dragging')
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(0)
  await expect(player).toBeVisible()
  expect(await player.evaluate((element) => element.matches(':popover-open'))).toBe(true)
  const artwork = player.locator('.player-drag-surface').nth(1)
  const artworkBounds = await artwork.boundingBox()

  if (!artworkBounds) throw new Error('Expected the player artwork')
  const artworkY = artworkBounds.y + 30
  await page.mouse.move(x, artworkY)
  await page.mouse.down()
  await expect(panel).toHaveAttribute('data-dragging')
  await page.mouse.move(x, artworkY + 200, { steps: 10 })
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(200)
  await page.mouse.up()
  await expect(player).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .not.toBe('hidden')
  await page.getByRole('button', { name: 'Now playing', exact: true }).click()
  await expect(panel).not.toHaveAttribute('data-starting-style')
  await expect
    .poll(() =>
      panel.evaluate((panel) =>
        panel.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false)
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(0)
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await player
    .getByRole('slider', { name: 'Playback position' })
    .dispatchEvent('pointerdown', { pointerId: 4, button: 0, clientY: 100 })
  await expect(panel).not.toHaveAttribute('data-dragging')
  const grip = player.getByRole('button', { name: 'Collapse player', exact: true })
  await expect(grip.locator('svg')).toHaveCount(0)
  await grip.tap()
  await expect(player).not.toBeVisible()
  await page.getByRole('button', { name: 'Now playing', exact: true }).click()
  await expect(player).toBeVisible()
  await expect(panel).not.toHaveAttribute('data-starting-style')
  await expect
    .poll(() =>
      panel.evaluate((panel) =>
        panel.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false)
  await grip.focus()
  await page.keyboard.press('Enter')
  await expect(player).not.toBeVisible()
})

test('mobile touch pull dismisses the player', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch dragging uses Chromium CDP')
  await page.goto('/mixes')
  await page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  const panel = page.locator('.native-player-panel')
  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveAttribute('data-starting-style')
  await expect
    .poll(() =>
      panel.evaluate((panel) =>
        panel.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false)
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 190, y: 30 }],
  })
  await expect(panel).toHaveAttribute('data-dragging')

  for (const y of [60, 100, 160, 240]) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 190, y }],
    })
  }

  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(210)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('dialog', { name: 'Now playing', exact: true })).not.toBeVisible()
  await session.detach()
})
