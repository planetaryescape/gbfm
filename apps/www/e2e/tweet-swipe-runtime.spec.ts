import { expect, test } from '@playwright/test'

import type * as Swipe from '../src/page/tweet/swipe'
import type * as SwipeMotion from '../src/page/tweet/swipe-motion'

test.beforeEach(async ({ page }) => {
  await page.goto('/@vite/client')
  await page.setContent(
    '<main data-tweet-swipe="a" data-swipe-ready="true"><div data-tweet-motion>Disposable reader fixture</div></main>',
  )
})

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`hands outgoing motion to the destination and releases incoming motion with ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion })

    const result = await page.evaluate(async () => {
      const source = '/src/page/tweet/swipe-motion.ts'

      const { createSwipeMotion }: typeof SwipeMotion = await import(source)

      const surface = document.querySelector('[data-tweet-swipe]')
      const target = surface?.querySelector('[data-tweet-motion]')

      if (!(surface instanceof HTMLElement) || !(target instanceof HTMLElement))
        throw new Error('Missing fixture')

      const finish = async () => {
        const animations = target.getAnimations()
        animations.forEach((animation) => animation.finish())
        await Promise.all(animations.map((animation) => animation.finished))
      }

      const motion = createSwipeMotion()
      let navigations = 0
      motion.drag(surface, -90)
      const dragging = target.dataset.swipePhase
      motion.commit(surface, 'a', 'older', () => {
        navigations += 1
      })
      const exiting = motion.busy()
      await finish()
      const awaiting = motion.busy()
      surface.dataset.tweetSwipe = 'b'
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      await finish()

      const completed = {
        busy: motion.busy(),
        phase: target.dataset.swipePhase,
        transform: target.style.transform,
      }

      motion.dispose()

      return { dragging, exiting, awaiting, navigations, completed }
    })

    expect(result).toEqual({
      dragging: 'dragging',
      exiting: true,
      awaiting: true,
      navigations: 1,
      completed: { busy: false, phase: undefined, transform: '' },
    })
  })
}

test('cancels superseded animations and recovers when destination navigation fails', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const result = await page.evaluate(async () => {
    const source = '/src/page/tweet/swipe-motion.ts'

    const { createSwipeMotion }: typeof SwipeMotion = await import(source)

    const surface = document.querySelector('[data-tweet-swipe]')
    const target = surface?.querySelector('[data-tweet-motion]')

    if (!(surface instanceof HTMLElement) || !(target instanceof HTMLElement))
      throw new Error('Missing fixture')
    const motion = createSwipeMotion()
    let navigations = 0
    motion.commit(surface, 'a', 'older', () => {
      navigations += 1
    })
    const cancelled = target.getAnimations().map((animation) => animation.finished)
    motion.reset()
    await Promise.allSettled(cancelled)
    const afterCancellation = { navigations, busy: motion.busy() }
    motion.commit(surface, 'a', 'older', () => {
      navigations += 1
    })
    const outgoing = target.getAnimations()
    outgoing.forEach((animation) => animation.finish())
    await Promise.all(outgoing.map((animation) => animation.finished))
    motion.navigationEnded()
    const afterFailure = { navigations, busy: motion.busy(), phase: target.dataset.swipePhase }
    motion.dispose()

    return { afterCancellation, afterFailure }
  })

  expect(result).toEqual({
    afterCancellation: { navigations: 0, busy: false },
    afterFailure: { navigations: 1, busy: false, phase: undefined },
  })
})

test('rejects vertical and cancelled touches, coalesces rapid swipes, and retries after navigation failure', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const result = await page.evaluate(async () => {
    history.replaceState(null, '', '/tweet/a')
    const source = '/src/page/tweet/swipe.ts'
    const { startTweetSwipes }: typeof Swipe = await import(source)
    const surface = document.querySelector('[data-tweet-swipe]')

    if (!(surface instanceof HTMLElement)) throw new Error('Missing fixture')
    const link = document.createElement('a')
    link.id = 'tweet-older'
    link.href = '/tweet/b'
    document.body.append(link)
    let navigations = 0
    link.addEventListener('click', (event) => {
      event.preventDefault()
      navigations += 1
    })
    const dispose = startTweetSwipes()

    const touch = (type: string, x: number, y: number) => {
      const value = { identifier: 1, target: surface, clientX: x, clientY: y }
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [value] },
        changedTouches: { value: [value] },
      })
      surface.dispatchEvent(event)
    }

    touch('touchstart', 300, 100)
    touch('touchmove', 280, 180)
    touch('touchend', 50, 180)
    touch('touchstart', 300, 100)
    touch('touchmove', 100, 100)
    touch('touchcancel', 100, 100)
    touch('touchend', 50, 100)
    const cancelled = navigations

    const swipe = () => {
      touch('touchstart', 300, 100)
      touch('touchmove', 100, 100)
      touch('touchend', 50, 100)
    }

    swipe()
    swipe()
    const rapid = navigations
    window.dispatchEvent(new Event('gbfm:navigation-end'))
    swipe()
    const retried = navigations
    dispose()
    swipe()

    return { cancelled, rapid, retried, disposed: navigations }
  })

  expect(result).toEqual({ cancelled: 0, rapid: 1, retried: 2, disposed: 2 })
})
