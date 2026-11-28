import { expect, test } from '@playwright/test'

import { expectNativeReady } from './fixtures/native-ready'

for (const theme of ['light', 'dark']) {
  test(`${theme} mobile dock keeps its fade and active tint while collapsing`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem('vite-ui-theme', theme)
      localStorage.setItem(
        'gbfm-audio-queue.json',
        JSON.stringify({
          currentIndex: 0,
          tracks: [
            {
              id: 'dock-fixture',
              title: 'Disposable dock preview',
              slug: 'dock-fixture',
              thumbnailUrl: null,
              url: '/not-played.wav',
              type: 'mix',
            },
          ],
        }),
      )
    }, theme)
    await page.goto('/')
    await expectNativeReady(page)
    await expect(page.getByRole('button', { name: 'Now playing', exact: true })).toBeEnabled()
    const dock = page.locator('.mobile-dock')
    const navigation = page.locator('nav.dock-tabs')
    const active = navigation.getByRole('link', { name: 'Home', exact: true })
    const expand = navigation.getByRole('button', { name: 'Show tabs', exact: true })
    await expect(active).toHaveAttribute('aria-current', 'page')
    await expect(active).toHaveAttribute('href', '/')
    await expect(navigation.getByRole('link', { name: 'Mixes', exact: true })).toHaveCount(0)
    const activeColor = await active.evaluate((element) => getComputedStyle(element).color)
    expect(await active.evaluate((element) => getComputedStyle(element, '::before').content)).toBe(
      'none',
    )
    const tabAlignment = await navigation
      .locator('.dock-tab:not(.dock-tabs-expand)')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const button = element.getBoundingClientRect()
          const icon = element.querySelector('svg')?.getBoundingClientRect()
          const label = element.querySelector('span')?.getBoundingClientRect()

          return {
            centerOffset: icon ? icon.x + icon.width / 2 - (button.x + button.width / 2) : null,
            iconTop: icon?.top,
            labelTop: label?.top,
          }
        }),
      )
    expect(tabAlignment).toHaveLength(5)
    for (const tab of tabAlignment) {
      expect(tab.centerOffset).not.toBeNull()
      expect(Math.abs(tab.centerOffset ?? Infinity)).toBeLessThanOrEqual(0.5)
      expect(tab.iconTop).toBe(tabAlignment[0]?.iconTop)
      expect(tab.labelTop).toBe(tabAlignment[0]?.labelTop)
    }
    await page.screenshot({ path: testInfo.outputPath('dock-expanded.png') })

    const expandedFadeHeight = await dock.evaluate((element) =>
      parseFloat(getComputedStyle(element, '::before').height),
    )

    await page.evaluate(() => {
      document.querySelector('main')?.style.setProperty('min-height', '300vh')
      window.scrollTo(0, 200)
    })
    await expect(dock).toHaveAttribute('data-minimized', '')
    await expect(expand).toBeVisible()
    await expect(expand).toHaveCSS('color', activeColor)
    await expect(expand).not.toHaveAttribute('aria-hidden', 'true')
    await expect(expand).toHaveText('Nav')

    const glyph = (locator: typeof expand) =>
      locator.locator('svg path').evaluate((path) => path.getAttribute('d'))

    expect(await glyph(expand)).not.toBe(await glyph(active))

    const hitArea = await expand.boundingBox()
    expect(hitArea?.width).toBeGreaterThanOrEqual(44)
    expect(hitArea?.height).toBeGreaterThanOrEqual(44)
    await expect
      .poll(async () => {
        const container = await navigation.boundingBox()
        const button = await expand.boundingBox()

        if (!container || !button) return Infinity

        return Math.abs(button.y + button.height / 2 - (container.y + container.height / 2))
      })
      .toBeLessThanOrEqual(0.5)
    await expect
      .poll(async () => {
        const container = await navigation.boundingBox()

        return container ? Math.abs(container.width - container.height) : Infinity
      })
      .toBeLessThanOrEqual(0.5)
    await page.screenshot({ path: testInfo.outputPath('dock-collapsed.png') })

    const fade = await dock.evaluate((element) => {
      const style = getComputedStyle(element, '::before')

      return {
        height: parseFloat(style.height),
        pointerEvents: style.pointerEvents,
        background: style.backgroundImage,
        selection: getComputedStyle(
          element.querySelector('.dock-tabs-expand') ?? element,
          '::before',
        ).content,
      }
    })

    expect(fade.height).toBeLessThan(expandedFadeHeight)
    expect(fade.pointerEvents).toBe('none')
    expect(fade.background).toContain('linear-gradient')
    expect(fade.selection).toBe('none')
    await expand.focus()
    await page.keyboard.press('Enter')
    await expect(dock).not.toHaveAttribute('data-minimized')
    await expect(active).toBeVisible()
    await expect(navigation.locator('.dock-tabs-expand')).toHaveAttribute('aria-hidden', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
