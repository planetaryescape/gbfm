import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

const longAudio = () => {
  const sampleRate = 8000
  const samples = sampleRate * 7200
  const audio = Buffer.alloc(44 + samples, 128)
  audio.write('RIFF', 0)
  audio.writeUInt32LE(36 + samples, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(sampleRate, 24)
  audio.writeUInt32LE(sampleRate, 28)
  audio.writeUInt16LE(1, 32)
  audio.writeUInt16LE(8, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(samples, 40)
  return audio
}

const openLongMix = async (page: Page) => {
  const audio = longAudio()
  await page.route('**/api/e2e-audio.wav', async (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '')
    const start = Number(range?.[1] ?? 0)
    const end = Math.min(Number(range?.[2] || audio.length - 1), audio.length - 1)
    const headers = {
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0) {
      await route.fulfill({ status: 416, headers, body: '' })
      return
    }
    await route.fulfill({
      status: range ? 206 : 200,
      headers: range
        ? { ...headers, 'content-range': `bytes ${start}-${end}/${audio.length}` }
        : headers,
      body: audio.subarray(start, end + 1),
    })
  })
  await page.goto('/mixes')
  await page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await player.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.locator('#fullscreen-player-panel')).not.toHaveAttribute('data-transition')
  const slider = page.locator('.hill-scrubber-input')
  await expect(slider).toHaveAttribute('max', '7200')
  return { player, slider, hill: page.locator('.hill-scrubber') }
}

test('holding shows the exact time and fine dragging commits the displayed second', async ({
  page,
}, testInfo) => {
  const { player, slider, hill } = await openLongMix(page)
  const bounds = await hill.boundingBox()
  if (!bounds) throw new Error('Expected the hill')
  const x = bounds.x + bounds.width / 2
  expect(Number.isInteger(x)).toBe(true)
  const y = bounds.y + 40
  await page.mouse.move(x, y)
  await page.mouse.down()
  const bubble = hill.locator('.hill-scrubber-preview')
  await expect(bubble).toBeVisible()
  await expect(bubble.locator('.hill-scrubber-preview-time')).toHaveText('1:00:00')
  await expect(bubble.locator('.hill-scrubber-preview-mode')).toHaveText('Fine seeking')
  await expect(slider).toHaveValue('3600')
  const initialBubble = await bubble.boundingBox()
  if (!initialBubble) throw new Error('Expected the preview bubble')
  await page.mouse.move(x + 40, y, { steps: 8 })
  await expect(bubble.locator('.hill-scrubber-preview-time')).toHaveText('1:00:10')
  await expect(slider).toHaveValue('3610')
  const movedBubble = await bubble.boundingBox()
  if (!movedBubble) throw new Error('Expected the moved preview bubble')
  expect(movedBubble.x - initialBubble.x).toBeCloseTo(40, 0)
  await page.screenshot({ path: testInfo.outputPath('fine-seeking-hour-mix.png') })
  await testInfo.attach('Fine seeking a two-hour mix', {
    path: testInfo.outputPath('fine-seeking-hour-mix.png'),
    contentType: 'image/png',
  })
  await page.mouse.up()
  await expect(bubble).toHaveCount(0)
  await expect(slider).toHaveAttribute('value', '3610')
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(3610.5)
  expect(Number(await slider.inputValue())).toBeLessThan(3615)
})

test('movement re-arms the hold and no late bubble survives release', async ({ page }) => {
  const { hill } = await openLongMix(page)
  const bounds = await hill.boundingBox()
  if (!bounds) throw new Error('Expected the hill')
  const y = bounds.y + 40
  await page.mouse.move(bounds.x + bounds.width / 2, y)
  await page.mouse.down()
  const mode = hill.locator('.hill-scrubber-preview-mode')
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(bounds.x + bounds.width / 2 + step * 8, y)
    await expect(mode).toHaveText('Hold to fine-seek')
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
  await expect(hill.locator('.hill-scrubber-preview')).toHaveCount(0)
})

test('playback ticks do not overwrite a held fine preview or its reference time', async ({
  page,
}) => {
  const { player, hill } = await openLongMix(page)
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  const bounds = await hill.boundingBox()
  if (!bounds) throw new Error('Expected the hill')
  const x = bounds.x + bounds.width / 2
  expect(Number.isInteger(x)).toBe(true)
  await page.mouse.move(x, bounds.y + 40)
  await page.mouse.down()
  const bubble = hill.locator('.hill-scrubber-preview')
  await expect(bubble.locator('.hill-scrubber-preview-mode')).toHaveText('Fine seeking')
  const delta = await bubble.locator('.hill-scrubber-preview-delta').innerText()
  await page.waitForTimeout(1100)
  await expect(bubble.locator('.hill-scrubber-preview-time')).toHaveText('1:00:00')
  await expect(bubble.locator('.hill-scrubber-preview-delta')).toHaveText(delta)
  await page.mouse.up()
})

test('touch cancellation in fine mode rolls back without a late hold callback', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Native touch dispatch uses Chromium CDP')
  const { hill, slider } = await openLongMix(page)
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('value', '0')
  const bounds = await hill.boundingBox()
  if (!bounds) throw new Error('Expected the hill')
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + 40 }],
  })
  await expect(hill.locator('.hill-scrubber-preview-mode')).toHaveText('Fine seeking')
  await expect(slider).toHaveValue('3600')
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(slider).toHaveValue('0')
  await expect(hill).not.toHaveAttribute('data-pressed')
  await page.waitForTimeout(600)
  await expect(hill.locator('.hill-scrubber-preview')).toHaveCount(0)
  await session.detach()
})

test('hour-aware preview stays above the finger and inside a narrow viewport at both ends', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { hill, slider } = await openLongMix(page)
  for (const endpoint of [
    { key: 'Home', x: 56, time: '0:00:00' },
    { key: 'End', x: 264, time: '2:00:00' },
  ]) {
    await slider.focus()
    await page.keyboard.press(endpoint.key)
    await expect(slider).toHaveAttribute('aria-valuetext', `${endpoint.time} of 2:00:00`)
    const bounds = await hill.boundingBox()
    if (!bounds) throw new Error('Expected the hill')
    const y = bounds.y + 40
    await page.mouse.move(bounds.x + (endpoint.x / 320) * bounds.width, y)
    await page.mouse.down()
    const bubble = hill.locator('.hill-scrubber-preview')
    await expect(bubble.locator('.hill-scrubber-preview-time')).toHaveText(endpoint.time)
    const bubbleBounds = await bubble.boundingBox()
    if (!bubbleBounds) throw new Error('Expected the preview bubble')
    expect(bubbleBounds.x).toBeGreaterThanOrEqual(0)
    expect(bubbleBounds.x + bubbleBounds.width).toBeLessThanOrEqual(320)
    expect(bubbleBounds.y + bubbleBounds.height).toBeLessThanOrEqual(y - 50)
    await expect(bubble).toHaveCSS('transition-duration', '0s')
    await page.screenshot({ path: testInfo.outputPath(`preview-${endpoint.key}-320px.png`) })
    await testInfo.attach(`Preview at ${endpoint.time}`, {
      path: testInfo.outputPath(`preview-${endpoint.key}-320px.png`),
      contentType: 'image/png',
    })
    await page.mouse.up()
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(hill).toBeHidden()
  await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible()
})
