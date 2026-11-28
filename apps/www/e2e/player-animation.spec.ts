import { expect, test } from '@playwright/test'

test('player accepts a real collapse click during entry', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/shows/e2e-local-radio')
  await page.addStyleTag({
    content:
      '.native-player-panel[data-open] { transition-duration: 4s !important; transition-timing-function: linear !important; }',
  })
  await page.getByRole('button', { name: 'Play episode 1: Local Frequencies', exact: true }).click()

  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  const panel = player.locator('.native-player-panel')
  const collapse = player.getByRole('button', { name: 'Collapse player', exact: true })
  await expect(panel).toHaveAttribute('data-open', '')
  await expect
    .poll(() =>
      panel.evaluate((panel) =>
        panel.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(true)
  await expect.poll(async () => (await collapse.boundingBox())?.y ?? Infinity).toBeLessThan(800)
  await collapse.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        button.setAttribute(
          'data-clicked-during-entry',
          String(
            Boolean(
              button
                .closest('.native-player-panel')
                ?.getAnimations()
                .some((animation) => animation.playState === 'running'),
            ),
          ),
        )
      },
      { once: true },
    )
  })
  const bounds = await collapse.boundingBox()

  if (!bounds) throw new Error('Expected the collapse player button')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(collapse).toHaveAttribute('data-clicked-during-entry', 'true')
  await expect(player).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .not.toBe('hidden')
})

test('player slides as one opaque panel and releases scroll locking after collapse', async ({
  page,
}) => {
  await page.goto('/mixes')

  const play = page
    .getByRole('article')
    .filter({ hasText: 'Local Frequencies' })
    .getByRole('button', { name: 'Play', exact: true })

  await expect(play).toBeEnabled()

  const frames = await play.evaluate(async (button) => {
    const frames: Array<{ top: number; height: number; opacity: string }> = []

    if (!(button instanceof HTMLElement)) throw new Error('Expected a player button')
    button.click()
    const started = performance.now()

    while (performance.now() - started < 800) {
      await new Promise(requestAnimationFrame)
      const panel = document.querySelector('.native-player-panel')

      if (panel) {
        const bounds = panel.getBoundingClientRect()
        frames.push({
          top: bounds.top,
          height: bounds.height,
          opacity: getComputedStyle(panel).opacity,
        })
      }
    }

    return frames
  })

  expect(frames.length).toBeGreaterThan(2)
  expect(frames[0].top).toBeGreaterThan(frames[0].height * 0.8)
  expect(frames.some((frame) => frame.top > 10 && frame.top < frame.height * 0.8)).toBe(true)
  expect(frames.at(-1)?.top).toBeCloseTo(0)
  expect(frames.every((frame) => frame.opacity === '1')).toBe(true)

  for (let index = 1; index < frames.length; index++) {
    expect(frames[index].top).toBeLessThanOrEqual(frames[index - 1].top + 1)
  }

  const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

  const exitFrames = await player
    .getByRole('button', { name: 'Collapse player', exact: true })
    .evaluate(async (button) => {
      const positions: Array<number> = []

      if (!(button instanceof HTMLElement)) throw new Error('Expected a player button')
      button.click()
      const started = performance.now()

      while (performance.now() - started < 600) {
        await new Promise(requestAnimationFrame)
        const panel = document.querySelector('.native-player-panel')

        if (panel) positions.push(panel.getBoundingClientRect().top)
      }

      return positions
    })

  expect(exitFrames.some((top) => top > 10)).toBe(true)
  await expect(player).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .not.toBe('hidden')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Now playing', exact: true }).click()
  await expect(player).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.native-player-panel')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toBe('0s')
  await player.getByRole('button', { name: 'Collapse player', exact: true }).click()
  await expect(player).not.toBeVisible()
})
