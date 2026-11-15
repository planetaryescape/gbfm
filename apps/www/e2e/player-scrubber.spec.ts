import { expect, test, type Page } from '@playwright/test'

const openPausedPlayer = async (page: Page) => {
  await page.goto('/mixes')
  await page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await player.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.locator('#fullscreen-player-panel')).not.toHaveAttribute('data-transition')
}

test('closing during a held preview cancels the mounted gesture before the leave animation ends', async ({
  page,
}) => {
  await openPausedPlayer(page)
  const hill = page.locator('.hill-scrubber')
  const slider = hill.getByRole('slider')
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('value', '0')
  const bounds = await hill.boundingBox()
  if (!bounds) throw new Error('Expected a mobile scrubber')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20)
  await page.mouse.down()
  await expect(slider).toHaveValue('15')
  await page.keyboard.press('Escape')
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + 20)
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: 'Now playing', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Now playing', exact: true }).click()
  await expect(slider).toHaveValue('0')
  await expect(hill).not.toHaveAttribute('data-pressed')
  await expect(hill.locator('.hill-scrubber-preview')).toHaveCount(0)
})

test('the full hill target seeks, acknowledges press, drags outside bounds and settles', async ({
  page,
}, testInfo) => {
  await openPausedPlayer(page)
  const hill = page.locator('.hill-scrubber')
  const slider = hill.getByRole('slider', { name: 'Playback position' })
  await expect(slider).toBeEnabled()
  await expect(slider).toHaveAttribute('max', '30')
  const bounds = await slider.boundingBox()
  if (!bounds) throw new Error('Expected a mobile scrubber')
  expect(bounds.height).toBeGreaterThanOrEqual(64)
  const y = bounds.y + 8
  await page.mouse.move(bounds.x + bounds.width / 2, y)
  await page.mouse.down()
  await expect.poll(() => slider.inputValue()).toBe('15')
  await expect
    .poll(() => hill.locator('circle').evaluate((el) => getComputedStyle(el).r))
    .toBe('7px')
  await expect
    .poll(() => hill.locator('svg').evaluate((el) => getComputedStyle(el).transform))
    .not.toBe('none')
  await expect(page.locator('#fullscreen-player-panel')).not.toHaveAttribute('data-dragging')
  await page.screenshot({ path: testInfo.outputPath('hill-pressed.png') })
  await testInfo.attach('Hill pressed', {
    path: testInfo.outputPath('hill-pressed.png'),
    contentType: 'image/png',
  })
  await page.mouse.move(bounds.x + bounds.width * 0.75, y + 20, { steps: 8 })
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(22)
  await page.mouse.move(bounds.x - 30, y, { steps: 8 })
  await expect.poll(() => slider.inputValue()).toBe('0')
  await page.mouse.move(bounds.x + bounds.width + 30, y, { steps: 8 })
  await expect.poll(() => slider.inputValue()).toBe('30')
  await page.mouse.move(bounds.x + bounds.width / 2, y, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => hill.locator('circle').evaluate((el) => getComputedStyle(el).r))
    .toBe('6px')
  await expect.poll(() => slider.inputValue()).toBe('15')
  await page.screenshot({ path: testInfo.outputPath('hill-resting.png') })
  await testInfo.attach('Hill resting', {
    path: testInfo.outputPath('hill-resting.png'),
    contentType: 'image/png',
  })
  await page
    .getByRole('dialog', { name: 'Now playing', exact: true })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(15.5)
  expect(Number(await slider.inputValue())).toBeLessThan(20)
})

test('keyboard seeking, reduced motion and desktop presentation are preserved', async ({
  page,
}) => {
  await openPausedPlayer(page)
  const hill = page.locator('.hill-scrubber')
  const slider = hill.getByRole('slider', { name: 'Playback position' })
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveValue('0')
  await expect(slider).toHaveAttribute('value', '0')
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveValue('0.1')
  await page.keyboard.press('End')
  await expect(slider).toHaveValue('30')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect
    .poll(() => hill.locator('svg').evaluate((el) => getComputedStyle(el).transitionDuration))
    .toBe('0s')
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(hill).toBeHidden()
  const desktop = page.getByRole('slider', { name: 'Playback position' })
  await expect(desktop).toBeVisible()
  await desktop.focus()
  await page.keyboard.press('Home')
  await expect(desktop).toHaveValue('0')
})

test('touch drags seek without dismissing the sheet and cancellation releases feedback', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Native touch dispatch uses Chromium CDP')
  await openPausedPlayer(page)
  const slider = page.locator('.hill-scrubber-input')
  const bounds = await slider.boundingBox()
  if (!bounds) throw new Error('Expected a mobile scrubber')
  const session = await page.context().newCDPSession(page)
  const y = bounds.y + 10
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width * 0.25, y }],
  })
  for (const ratio of [0.35, 0.5, 0.65, 0.75]) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: bounds.x + bounds.width * ratio, y }],
    })
  }
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(22)
  await expect
    .poll(() => page.locator('.hill-scrubber-thumb').evaluate((el) => getComputedStyle(el).r))
    .toBe('7px')
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect
    .poll(() => page.locator('.hill-scrubber-thumb').evaluate((el) => getComputedStyle(el).r))
    .toBe('6px')
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(1)
  await expect(page.getByRole('dialog', { name: 'Now playing', exact: true })).toBeVisible()
  await expect(page.locator('#fullscreen-player-panel')).not.toHaveAttribute('data-dragging')
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('value', '0')
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + (24 / 320) * bounds.width, y }],
  })
  await expect(slider).toHaveValue('0')
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: bounds.x + (128 / 320) * bounds.width, y }],
  })
  await expect(slider).toHaveValue('15')
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(slider).toHaveAttribute('value', '15')
  await page
    .getByRole('dialog', { name: 'Now playing', exact: true })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(15.5)
  expect(Number(await slider.inputValue())).toBeLessThan(20)
  await session.detach()
})

test('seeking is unavailable until the audio duration is known', async ({ page }) => {
  await page.route('**/api/e2e-audio.wav', (route) => route.abort())
  await page.goto('/mixes')
  await page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  const slider = page.locator('.hill-scrubber-input')
  await expect(slider).toBeVisible()
  await expect(slider).toBeDisabled()
  await expect(slider).toHaveValue('0')
  await expect(slider).toHaveAttribute('max', '0')
})

test('the full hill is visible before pressing and its shoulders drag without jumping', async ({
  page,
}, testInfo) => {
  await openPausedPlayer(page)
  const hill = page.locator('.hill-scrubber')
  const slider = hill.getByRole('slider')
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('value', '0')
  const dot = hill.locator('circle')
  await expect(dot).toHaveAttribute('cx', '56')
  await expect(dot).toHaveAttribute('cy', '44')
  await expect(hill.locator('.hill-scrubber-played')).toHaveAttribute(
    'd',
    'M 12 44 L 12 44 C 36.2 44 36.2 18 56 18',
  )
  await expect(hill).not.toHaveAttribute('data-pressed')
  await expect(dot).toHaveCSS('stroke', 'none')
  await slider.blur()
  await page.screenshot({ path: testInfo.outputPath('hill-initial.png') })
  await testInfo.attach('Hill before any press', {
    path: testInfo.outputPath('hill-initial.png'),
    contentType: 'image/png',
  })
  const bounds = await hill.boundingBox()
  if (!bounds) throw new Error('Expected the hill touch target')
  const shoulder = bounds.x + (24 / 320) * bounds.width
  const y = bounds.y + 36
  await page.mouse.move(shoulder, y)
  await page.mouse.down()
  await expect(hill).toHaveAttribute('data-pressed')
  await expect(slider).toHaveValue('0')
  await page.mouse.move(shoulder + (104 / 320) * bounds.width, y, { steps: 10 })
  await expect(slider).toHaveValue('15')
  await page.mouse.up()
  await expect(hill).not.toHaveAttribute('data-pressed')
  await expect(slider).toHaveValue('15')
  await slider.focus()
  await page.keyboard.press('End')
  await expect(slider).toHaveAttribute('value', '30')
  await expect(dot).toHaveAttribute('cx', '264')
  await expect(hill.locator('.hill-scrubber-track')).toHaveAttribute(
    'd',
    /C 283\.8 18 283\.8 44 308 44 L 308 44$/,
  )
  await expect(dot).toHaveAttribute('cy', '44')
})
