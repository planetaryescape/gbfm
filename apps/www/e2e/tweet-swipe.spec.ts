import { expect, test, type Page } from '@playwright/test'

const ready = async (page: Page, slug: string) => {
  await expect(page.locator('.site')).toHaveAttribute('data-interactive', 'true')
  await expect(page.locator('[data-tweet-swipe]')).toHaveAttribute('data-tweet-swipe', slug)
  await expect(page.locator('[data-tweet-swipe]')).toHaveAttribute('data-swipe-ready', 'true')
  await expect(page.locator('[data-tweet-motion]')).not.toHaveAttribute('data-swipe-phase', /.+/)
}

const drag = (page: Page, phase: 'start' | 'move' | 'end' | 'cancel', x: number, time: number) =>
  page.evaluate(
    ({ phase, x, time }) => {
      const target = document.querySelector('article')

      if (!target) throw new Error('Missing article')
      const touch = { identifier: 7, target, clientX: x, clientY: 250 }

      const event = new Event(
        { start: 'touchstart', move: 'touchmove', end: 'touchend', cancel: 'touchcancel' }[phase],
        { bubbles: true, cancelable: true },
      )

      Object.defineProperties(event, {
        touches: { value: phase === 'end' || phase === 'cancel' ? [] : [touch] },
        changedTouches: { value: [touch] },
        timeStamp: { value: time },
      })
      target.dispatchEvent(event)
    },
    { phase, x, time },
  )

test('tweet follows the finger and springs back below the slow-drag threshold', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)
  await drag(page, 'move', 190, 300)
  const motion = page.locator('[data-tweet-motion]')
  await expect(motion).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 40, 0)')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await drag(page, 'end', 190, 400)
  await expect(motion).toHaveAttribute('data-swipe-phase', 'returning')
  await expect(motion).not.toHaveAttribute('data-swipe-phase', /.+/)
  await expect(motion).toHaveCSS('transform', 'none')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('a slow swipe keeps the current post visible while the next request is waiting', async ({
  page,
}) => {
  let release = () => {}

  let requested = () => {}

  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })

  const started = new Promise<void>((resolve) => {
    requested = resolve
  })

  await page.route('**/tweet/e2e-archive-two*', async (route) => {
    requested()
    await waiting
    await route.continue()
  })
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)

  for (let step = 1; step <= 12; step++) {
    await drag(page, 'move', 150 + step * 10, step * 120)
    await expect(page.locator('[data-tweet-motion]')).toHaveCSS(
      'transform',
      `matrix(1, 0, 0, 1, ${step === 1 ? 0 : step * 10}, 0)`,
    )
  }

  await drag(page, 'end', 270, 1500)
  await started

  try {
    const motion = page.locator('[data-tweet-motion]')
    await expect(motion).toHaveCSS('opacity', '1')
    await expect(page.locator('[data-tweet-swipe]')).toHaveAttribute(
      'data-tweet-swipe',
      'e2e-archive-one',
    )
    await expect
      .poll(async () => Math.abs((await motion.boundingBox())?.x ?? Infinity))
      .toBeLessThan(80)
    await expect(motion).toHaveCSS('opacity', '1')
    await expect(page.locator('summary[aria-label="Reading options"]')).toBeVisible()
  } finally {
    release()
  }

  await ready(page, 'e2e-archive-two')
})

test('short fast flick commits with exit and entrance motion', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)
  await drag(page, 'move', 190, 40)
  await drag(page, 'end', 190, 50)
  await expect(page.locator('[data-tweet-motion]')).toHaveAttribute('data-swipe-phase', 'exiting')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await ready(page, 'e2e-archive-two')
  await expect(page.locator('[data-tweet-motion]')).toHaveCSS('transform', 'none')
})

test('holding a short flick or reversing a long drag cancels the commit', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)
  await drag(page, 'move', 190, 40)
  await drag(page, 'end', 190, 400)
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 100, 1000)
  await drag(page, 'move', 260, 1300)
  await drag(page, 'move', 210, 1350)
  await drag(page, 'end', 210, 1360)
  await ready(page, 'e2e-archive-one')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('opening reading options during the exit cancels delayed swipe navigation', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)
  await drag(page, 'move', 190, 40)
  await drag(page, 'end', 190, 50)
  await page.locator('summary[aria-label="Reading options"]').evaluate((element) => {
    if (element instanceof HTMLElement) element.click()
  })
  await ready(page, 'e2e-archive-one')
  await expect(page.locator('details[data-tweet-dock]')).toHaveAttribute('open', '')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('cancelled gestures and unavailable neighbours rebound without navigating', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 190, 0)
  await drag(page, 'move', 90, 300)
  await expect(page.locator('[data-tweet-motion]')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, -18, 0)',
  )
  await drag(page, 'end', 90, 400)
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 1000)
  await drag(page, 'move', 270, 1100)
  await drag(page, 'cancel', 270, 1150)
  await ready(page, 'e2e-archive-one')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('adding a second finger immediately releases a dragged tweet', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)
  await drag(page, 'move', 210, 300)
  await page.locator('article').evaluate((target) => {
    const event = new Event('touchstart', { bubbles: true })
    Object.defineProperty(event, 'touches', { value: [{ identifier: 7 }, { identifier: 8 }] })
    target.dispatchEvent(event)
  })
  await expect(page.locator('[data-tweet-motion]')).toHaveAttribute('data-swipe-phase', 'returning')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'end', 210, 400)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('reduced motion preserves thresholds and navigation without spatial animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await drag(page, 'start', 150, 0)
  await drag(page, 'move', 190, 40)
  await expect(page.locator('[data-tweet-motion]')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 0)',
  )
  await drag(page, 'end', 190, 50)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await ready(page, 'e2e-archive-two')
})

const touchSwipe = (page: Page, selector: string, dx: number, dy = 0, originX = 150) =>
  page.evaluate(
    ({ selector, dx, dy, originX }) => {
      const target = document.querySelector(selector)

      if (!target) throw new Error('Missing gesture target')

      const y = target.getBoundingClientRect().top + 10
      const touch = (x: number, y: number) => ({ identifier: 1, target, clientX: x, clientY: y })
      const first = touch(originX, y)
      const last = touch(originX + dx, y + dy)

      for (const [name, touches, changedTouches] of [
        ['touchstart', [first], [first]],
        ['touchmove', [last], [last]],
        ['touchend', [], [last]],
      ] as const) {
        const event = new Event(name, { bubbles: true, cancelable: true })
        Object.defineProperties(event, {
          touches: { value: touches },
          changedTouches: { value: changedTouches },
        })
        target.dispatchEvent(event)
      }
    },
    { selector, dx, dy, originX },
  )

test('touch adapter browses newer and older while preserving keyboard and visible alternatives', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  await touchSwipe(page, 'article', 100)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await ready(page, 'e2e-archive-two')
  await touchSwipe(page, 'article', -100)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await ready(page, 'e2e-archive-one')
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await page.locator('summary[aria-label="Reading options"]').click()
  await expect(page.getByRole('link', { name: 'Older tweet', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Older tweet', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('links, vertical gestures, edge gestures, and open reading options never trigger tweet navigation', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  const path = page.url()
  await touchSwipe(page, 'article a', 100)
  await expect(page).toHaveURL(path)
  await touchSwipe(page, 'article', 100, 120)
  await expect(page).toHaveURL(path)
  await touchSwipe(page, 'article', 100, 0, 16)
  await expect(page).toHaveURL(path)
  await page.locator('summary[aria-label="Reading options"]').click()
  await touchSwipe(page, 'article', 100)
  await expect(page).toHaveURL(path)
})

test('trusted Chromium touch input navigates in both directions', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Trusted touch dispatch uses Chromium CDP; the DOM adapter checks also run in WebKit.',
  )
  await page.goto('/tweet/e2e-archive-one')
  await ready(page, 'e2e-archive-one')
  const cdp = await context.newCDPSession(page)

  const swipe = async (from: number, to: number) => {
    const bounds = await page.locator('article').boundingBox()

    if (!bounds) throw new Error('Missing article bounds')

    const y = bounds.y + bounds.height - 60
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y }],
    })

    for (const fraction of [0.25, 0.5, 0.75, 1])
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from + (to - from) * fraction, y }],
      })

    await expect(page.locator('[data-tweet-motion]')).toHaveCSS(
      'transform',
      `matrix(1, 0, 0, 1, ${to - from}, 0)`,
    )
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  await swipe(100, 240)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await ready(page, 'e2e-archive-two')
  await swipe(240, 100)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await cdp.detach()
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]) {
  test(`reader controls follow shared geometry at ${viewport.width}px without fixed reader chrome`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/tweet/e2e-archive-one')
    await ready(page, 'e2e-archive-one')
    const options = page.locator('summary[aria-label="Reading options"]')
    await expect(options).toHaveCSS('border-radius', '4px')
    await expect(options).toHaveCSS('min-height', '44px')
    await expect(page.locator('.tweet-reader-navigation')).toHaveCSS('position', 'relative')
    await options.click()
    await expect(page.locator('.tweet-reader-options')).toHaveCSS('border-radius', '12px')
    const button = page.getByRole('link', { name: 'Newer tweet', exact: true })
    await expect(button).toHaveCSS('border-radius', '4px')
    await expect(button).toHaveCSS('font-size', '14px')
    await expect(page.getByRole('navigation', { name: 'Tweets per month' })).toHaveCount(0)
    await page.getByText('Visit a month', { exact: true }).click()
    const month = page.getByRole('combobox', { name: 'Choose a month' })
    const target = await month.boundingBox()
    expect(target?.height).toBeGreaterThanOrEqual(44)
    expect(target?.width).toBeGreaterThanOrEqual(44)
    const bounds = await page.locator('.tweet-reader-options').boundingBox()

    if (!bounds) throw new Error('Missing reading options bounds')

    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    )
  })
}

for (const theme of ['light', 'dark']) {
  test(`manual ${theme} theme keeps tweet prose at the semantic foreground color`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript((theme) => localStorage.setItem('vite-ui-theme', theme), theme)
    await page.goto('/tweet/e2e-archive-one')
    await ready(page, 'e2e-archive-one')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

    const foreground = await page
      .locator('[data-tweet-swipe]')
      .evaluate((element) => getComputedStyle(element).color)

    await expect(page.locator('article .prose')).toHaveCSS('color', foreground)
    await expect(page.locator('article .prose p')).toHaveCSS('color', foreground)
  })
}
