import { expect, test } from '@playwright/test'

import {
  expectBackgroundScrollLocked,
  expectModalOpen,
  expectPopupSettled,
  scrollStyles,
} from './fixtures/native-ready'

test('mobile visitors can return to the front page from the menu', async ({ page }) => {
  await page.goto('/mixes')
  const trigger = page.getByRole('button', { name: 'Menu', exact: true })
  await expect(trigger).toBeEnabled()
  await trigger.click()
  const menu = page.getByRole('dialog', { name: 'Menu', exact: true })
  const home = menu.getByRole('link', { name: 'Home', exact: true })
  await expect(home).toBeInViewport()
  await expect(home).toHaveAttribute('href', '/')
  await expect(home).not.toHaveAttribute('aria-current', 'page')
  await home.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(menu).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .not.toBe('hidden')
  await trigger.click()
  await expect(menu.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('mobile menu contains scrolling and restores the page after dismissal and navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto('/privacy')
  const trigger = page.getByRole('button', { name: 'Menu', exact: true })
  const sheet = page.locator('.menu-sheet')
  const links = page.locator('.menu-sheet-links')
  const originalStyles = await scrollStyles(page)
  await expect(trigger).toBeEnabled()
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expectModalOpen(page.locator('#mobile-menu'), sheet)
  await expectPopupSettled(sheet)
  await expectBackgroundScrollLocked(page)
  const bounds = await sheet.boundingBox()
  expect(bounds?.y).toBeGreaterThanOrEqual(16)
  expect((bounds?.y ?? 600) + (bounds?.height ?? 0)).toBeLessThanOrEqual(600)
  expect(await links.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await links.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(sheet.getByRole('link', { name: 'Log in', exact: true })).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(sheet).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect.poll(() => scrollStyles(page)).toEqual(originalStyles)
  await trigger.click()
  await expect(sheet).toBeVisible()
  await page.mouse.click(195, 8)
  await expect(sheet).not.toBeVisible()
  await expect
    .poll(() =>
      page.locator('#mobile-menu').evaluate((element) => element.matches(':popover-open')),
    )
    .toBe(false)
  await expect.poll(() => scrollStyles(page)).toEqual(originalStyles)
  await trigger.click()
  await sheet.getByRole('link', { name: 'Tweets', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/(?!latest)[^/?]+$/)
  await expect(sheet).not.toBeVisible()
  await expect.poll(() => scrollStyles(page)).toEqual(originalStyles)
})

test('mobile menu slides up with the player timing and respects reduced motion', async ({
  page,
}) => {
  await page.goto('/privacy')
  const trigger = page.getByRole('button', { name: 'Menu', exact: true })
  await expect(trigger).toBeEnabled()

  const frames = await trigger.evaluate(async (button) => {
    if (!(button instanceof HTMLElement)) throw new Error('Expected the menu button')

    const frames: Array<{
      top: number
      height: number
      viewport: number
      duration: string
      easing: string
    }> = []

    button.click()
    const started = performance.now()

    while (performance.now() - started < 800) {
      await new Promise(requestAnimationFrame)
      const sheet = document.querySelector('.menu-sheet')

      if (sheet) {
        const bounds = sheet.getBoundingClientRect()
        const style = getComputedStyle(sheet)
        frames.push({
          top: bounds.top,
          height: bounds.height,
          viewport: innerHeight,
          duration: style.transitionDuration,
          easing: style.transitionTimingFunction,
        })
      }
    }

    return frames
  })

  expect(frames.length).toBeGreaterThan(2)
  expect(frames[0].top).toBeGreaterThanOrEqual(frames[0].viewport - 2)
  expect(frames.at(-1)?.top).toBeCloseTo(frames[0].viewport - frames[0].height)
  expect(frames[0].duration).toBe('0.36s')
  expect(frames[0].easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)')

  for (let index = 1; index < frames.length; index++)
    expect(frames[index].top).toBeLessThanOrEqual(frames[index - 1].top + 1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).not.toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await trigger.click()
  const sheet = page.locator('.menu-sheet')
  await expect(sheet).toBeVisible()
  expect(await sheet.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s')
  await page.keyboard.press('Escape')
  await expect(sheet).not.toBeVisible()
})

test('pulling the mobile menu follows the pointer, snaps back, and dismisses past the threshold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/privacy')
  const trigger = page.getByRole('button', { name: 'Menu', exact: true })
  const sheet = page.locator('.menu-sheet')
  await expect(trigger).toBeEnabled()
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expectPopupSettled(sheet)
  const restingY = (await sheet.boundingBox())?.y ?? 0
  const handle = sheet.locator('header')
  const bounds = await handle.boundingBox()

  if (!bounds) throw new Error('Expected the menu drag handle')
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(sheet).toHaveAttribute('data-dragging')
  await page.mouse.move(x, y + 80, { steps: 5 })
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBeCloseTo(restingY + 80)
  await page.mouse.up()
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBeCloseTo(restingY)
  await expect(sheet).toBeVisible()
  await sheet
    .getByRole('link', { name: 'Tweets', exact: true })
    .dispatchEvent('pointerdown', { pointerId: 4, button: 0, clientY: 100 })
  await expect(sheet).not.toHaveAttribute('data-dragging')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(sheet).toHaveAttribute('data-dragging')
  await page.mouse.move(x, y + 200, { steps: 10 })
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBeCloseTo(restingY + 200)
  await page.mouse.up()
  await expect(sheet).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .not.toBe('hidden')
})
