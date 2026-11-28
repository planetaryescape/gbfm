import { expect, test, type Page } from '@playwright/test'
import { Effect } from 'effect'

import {
  type mountReaderRuntime,
  readerRuntimeNeighbours,
  renderReaderRuntime,
} from './fixtures/native-reader-runtime'

test.beforeEach(async ({ page }) => {
  await page.route('**/@vite/client', (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Native reader fixture</title>',
        })
      : route.continue(),
  )
  await page.route('**/api/content/posts/micro/**', (route) => {
    const url = new URL(route.request().url())
    const slug = url.pathname.split('/')[5] ?? 'a'

    if (url.pathname.endsWith('/seen')) return route.fulfill({ json: { recorded: true } })

    if (url.pathname.endsWith('/neighbours'))
      return route.fulfill({ json: readerRuntimeNeighbours(slug) })

    return route.fulfill({ json: [] })
  })
  await page.goto('/@vite/client')
  const rendered = await Effect.runPromise(renderReaderRuntime(new URL(page.url())))
  await page.setContent(`<div id="reader-runtime-container">${rendered.html}</div>`)
  await expect(page.getByRole('heading', { name: 'Tweet a', exact: true })).toBeVisible()

  const recorded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/content/posts/micro/a/seen' &&
      response.request().method() === 'POST',
  )

  await Promise.all([
    recorded,
    page.evaluate(async () => {
      const source = '/e2e/fixtures/native-reader-runtime.ts'
      const fixture: { mountReaderRuntime: typeof mountReaderRuntime } = await import(source)
      fixture.mountReaderRuntime()
    }),
  ])
  await expect(page.locator('#reader-runtime-container')).toHaveAttribute('data-mounted', 'true')
  await expect(page.locator('[data-reader-active]')).toHaveAttribute('data-reader-active', 'true')
  await expect(page.locator('[data-tweet-swipe]')).toHaveAttribute('data-swipe-ready', 'true')
})

const touch = (
  page: Page,
  phase: 'start' | 'move' | 'end' | 'cancel',
  x: number,
  time: number,
  y = 100,
) =>
  page.evaluate(
    ({ phase, x, y, time }) => {
      const target = document.querySelector('[data-reader-article]')

      if (!(target instanceof HTMLElement)) throw new Error('Missing native Reader article')
      const value = { identifier: 1, target, clientX: x, clientY: y }

      const event = new Event(
        { start: 'touchstart', move: 'touchmove', end: 'touchend', cancel: 'touchcancel' }[phase],
        { bubbles: true, cancelable: true },
      )

      Object.defineProperties(event, {
        touches: { value: phase === 'end' || phase === 'cancel' ? [] : [value] },
        changedTouches: { value: [value] },
        timeStamp: { value: time },
      })
      target.dispatchEvent(event)
    },
    { phase, x, time, y },
  )

const finishAnimations = (page: Page) =>
  page.evaluate(async () => {
    const target = document.querySelector('[data-reader-motion]')

    if (!(target instanceof HTMLElement)) throw new Error('Missing native Reader motion surface')
    const animations = target.getAnimations()
    animations.forEach((animation) => animation.finish())
    await Promise.all(animations.map((animation) => animation.finished))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })

const lifecycle = async (page: Page, state: 'Live' | 'Paused') => {
  const fixture = page.locator('#reader-runtime')
  const version = Number(await fixture.getAttribute('data-view-version'))
  await page.evaluate((state) => {
    window.dispatchEvent(new Event(state === 'Live' ? 'fixture:live' : 'fixture:pause'))
  }, state)
  await expect(fixture).toHaveAttribute('data-view-version', String(version + 1))
  await expect(fixture).toHaveAttribute('data-view-state', state)
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`hands outgoing motion to the destination and releases incoming motion with ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion })
    const target = page.locator('[data-reader-motion]')
    await target.evaluate((element) => {
      element.dataset.fixtureIdentity = 'original'
    })
    await touch(page, 'start', 300, 0)
    await touch(page, 'move', 210, 100)
    const dragging = await target.evaluate((element) => element.dataset.swipePhase)
    await touch(page, 'end', 50, 150)
    const exiting = await target.evaluate((element) => element.dataset.swipePhase === 'exiting')
    await finishAnimations(page)

    const awaiting =
      (await page.locator('#reader-runtime').getAttribute('data-navigation-pending')) === 'true'

    const navigations = Number(
      await page.locator('#reader-runtime').getAttribute('data-navigation-count'),
    )

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('fixture:destination', { detail: 'b' }))
    })
    await expect(page.getByRole('heading', { name: 'Tweet b', exact: true })).toBeVisible()
    await finishAnimations(page)

    const completed = await target.evaluate((element) => ({
      busy: element.getAnimations().some((animation) => animation.playState === 'running'),
      phase: element.dataset.swipePhase,
      transform: element.style.transform,
    }))

    expect({ dragging, exiting, awaiting, navigations, completed }).toEqual({
      dragging: 'dragging',
      exiting: true,
      awaiting: true,
      navigations: 1,
      completed: { busy: false, phase: undefined, transform: '' },
    })
    await expect(target).toHaveAttribute('data-fixture-identity', 'original')
    await page.evaluate(() => window.dispatchEvent(new Event('fixture:dispose')))
    await expect(page.locator('#reader-runtime-container')).toHaveAttribute('data-disposed', 'true')
  })
}

test('cancels superseded animations and recovers when destination navigation fails', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await touch(page, 'start', 300, 0)
  await touch(page, 'move', 100, 100)
  await touch(page, 'end', 50, 150)
  await lifecycle(page, 'Paused')

  const afterCancellation = await page.locator('#reader-runtime').evaluate((element) => ({
    navigations: Number(element.getAttribute('data-navigation-count')),
    busy:
      element.getAttribute('data-navigation-pending') === 'true' ||
      element
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === 'running'),
  }))

  await lifecycle(page, 'Live')
  await touch(page, 'start', 300, 1000)
  await touch(page, 'move', 100, 1100)
  await touch(page, 'end', 50, 1150)
  await finishAnimations(page)
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:navigation-failed')))
  await expect(page.locator('#reader-runtime')).toHaveAttribute('data-navigation-pending', 'false')

  const afterFailure = await page.locator('#reader-runtime').evaluate((element) => ({
    navigations: Number(element.getAttribute('data-navigation-count')),
    busy: element
      .getAnimations({ subtree: true })
      .some((animation) => animation.playState === 'running'),
    phase: element.querySelector<HTMLElement>('[data-reader-motion]')?.dataset.swipePhase,
  }))

  await expect(page.locator('[data-reader-motion]')).toHaveCSS('transform', 'none')

  expect({ afterCancellation, afterFailure }).toEqual({
    afterCancellation: { navigations: 0, busy: false },
    afterFailure: { navigations: 1, busy: false, phase: undefined },
  })
})

test('rejects vertical and cancelled touches, coalesces rapid swipes, and retries after navigation failure', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const result = await page.evaluate(async () => {
    const surface = document.querySelector('[data-reader-article]')
    const link = document.querySelector('a[data-reader-older]')
    const container = document.getElementById('reader-runtime-container')

    if (!(surface instanceof HTMLElement) || !(link instanceof HTMLAnchorElement) || !container)
      throw new Error('Missing native Reader fixture')
    let navigations = 0
    link.addEventListener('click', () => {
      navigations += 1
    })
    let time = 0

    const touch = (type: string, x: number, y: number) => {
      const value = { identifier: 1, target: surface, clientX: x, clientY: y }
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [value] },
        changedTouches: { value: [value] },
        timeStamp: { value: (time += 50) },
      })
      surface.dispatchEvent(event)
    }

    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const finish = async () => {
      const animations = document.querySelector('[data-reader-motion]')?.getAnimations() ?? []
      animations.forEach((animation) => animation.finish())
      await Promise.all(animations.map((animation) => animation.finished))
      await frame()
    }

    touch('touchstart', 300, 100)
    touch('touchmove', 280, 180)
    touch('touchend', 50, 180)
    touch('touchstart', 300, 100)
    touch('touchmove', 100, 100)
    touch('touchcancel', 100, 100)
    touch('touchend', 50, 100)
    await finish()
    const cancelled = navigations

    const swipe = () => {
      touch('touchstart', 300, 100)
      touch('touchmove', 100, 100)
      touch('touchend', 50, 100)
    }

    swipe()
    swipe()
    await finish()
    const rapid = navigations
    window.dispatchEvent(new Event('fixture:navigation-failed'))
    await frame()
    swipe()
    await finish()
    const retried = navigations

    const disposed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (container.dataset.disposed !== 'true') return
        observer.disconnect()
        resolve()
      })

      observer.observe(container, { attributes: true })
    })

    window.dispatchEvent(new Event('fixture:dispose'))
    await disposed
    swipe()
    await finish()

    return { cancelled, rapid, retried, disposed: navigations }
  })

  expect(result).toEqual({ cancelled: 0, rapid: 1, retried: 2, disposed: 2 })
})

test('preserves Reader DOM identities and positions through pause/resume and clears cancelled transforms', async ({
  page,
}) => {
  const reader = page.locator('[data-reader-active]')
  const article = page.locator('[data-reader-article]')
  const motion = page.locator('[data-reader-motion]')

  const identities = await Promise.all([
    reader.elementHandle(),
    article.elementHandle(),
    motion.elementHandle(),
  ])

  const frame = await article.boundingBox()
  await touch(page, 'start', 300, 0)
  await touch(page, 'move', 200, 100)
  await expect(motion).not.toHaveCSS('transform', 'none')
  await lifecycle(page, 'Paused')
  await expect(motion).toHaveCSS('transform', 'none')
  await touch(page, 'start', 300, 200)
  await touch(page, 'move', 100, 300)
  await touch(page, 'end', 50, 350)
  await expect(page.locator('#reader-runtime')).toHaveAttribute('data-navigation-count', '0')
  await lifecycle(page, 'Live')
  await expect(article).toBeVisible()
  expect(await article.boundingBox()).toEqual(frame)

  for (const [index, selector] of [
    '[data-reader-active]',
    '[data-reader-article]',
    '[data-reader-motion]',
  ].entries()) {
    const original = identities[index]

    if (!original) throw new Error('Missing Reader DOM identity')
    expect(
      await original.evaluate(
        (element, selector) => element === document.querySelector(selector),
        selector,
      ),
    ).toBe(true)
  }

  await touch(page, 'start', 300, 1000)
  await touch(page, 'move', 200, 1100)
  await expect(motion).not.toHaveCSS('transform', 'none')
  await article.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'touch' })
  await expect(motion).toHaveCSS('transform', 'none')
  await touch(page, 'end', 50, 1150)
  await expect(page.locator('#reader-runtime')).toHaveAttribute('data-navigation-count', '0')
  await touch(page, 'start', 300, 2000)
  await touch(page, 'move', 200, 2100)
  const outgoing = await motion.elementHandle()

  if (!outgoing) throw new Error('Missing motion surface before disposal')
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:dispose')))
  await expect(page.locator('#reader-runtime-container')).toHaveAttribute('data-disposed', 'true')
  expect(await outgoing.evaluate((element) => element.style.transform)).toBe('')
})
