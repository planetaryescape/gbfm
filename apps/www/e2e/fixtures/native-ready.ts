import { expect, type Locator, type Page } from '@playwright/test'

export const expectNativeReady = async (page: Page) => {
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  await expect(page.locator('.station-navigation')).toHaveAttribute('data-interactive', 'true')
}

export const expectPopupSettled = async (popup: Locator) => {
  await expect(popup).toBeVisible()
  await expect(popup).not.toHaveAttribute('data-starting-style')
  await expect(popup).not.toHaveAttribute('data-ending-style')
  await expect
    .poll(() =>
      popup.evaluate((element) =>
        element.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false)
}

export const scrollStyles = (page: Page) =>
  page.evaluate(() =>
    [document.documentElement, document.body].map((element) => ({
      overflowX: element.style.overflowX,
      overflowY: element.style.overflowY,
      scrollbarGutter: element.style.scrollbarGutter,
      position: element.style.position,
      width: element.style.width,
      height: element.style.height,
      boxSizing: element.style.boxSizing,
    })),
  )

export const expectModalOpen = async (portal: Locator, popup: Locator) => {
  await expect(popup).toBeVisible()
  await expect.poll(() => portal.evaluate((element) => element.matches(':popover-open'))).toBe(true)
  await expect
    .poll(() => popup.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
}

export const expectBackgroundScrollLocked = async (page: Page) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [document.documentElement, document.body].some((element) =>
          /hidden|clip/.test(getComputedStyle(element).overflowY),
        ),
      ),
    )
    .toBe(true)
  const top = await page.evaluate(() => window.scrollY)
  await page.mouse.move(2, 2)
  await page.mouse.wheel(0, 400)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  expect(await page.evaluate(() => window.scrollY)).toBe(top)
}
