import { expect, test } from '@playwright/test'

test('production hydration preserves SSR nodes and starts interaction', async ({ page }) => {
  const errors: Array<string> = []
  const gate = Promise.withResolvers<void>()

  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*.js', async (route) => {
    await gate.promise
    await route.continue()
  })

  try {
    await page.goto('/', { waitUntil: 'commit' })
    const main = page.locator('main')

    await expect(main.getByRole('heading')).toHaveText('Native fixture')
    const original = await main.elementHandle()

    if (!original) throw new Error('Missing SSR main element')

    await expect(page.locator('#root')).not.toHaveAttribute('data-adopted')
    gate.resolve()
    await expect(page.locator('#root')).toHaveAttribute('data-adopted', 'true')
    await expect(page.locator('#root')).toHaveAttribute('data-preserved', 'true')
    expect(await original.evaluate((node) => node.isConnected)).toBe(true)
    await page.getByRole('button', { name: 'Clicks: 0', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Clicks: 1', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
  }
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('production HTML and its stylesheet work without hydration', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Native fixture' })).toBeVisible()
    await expect(page.locator('main p')).toHaveText(['Anonymous', 'Anonymous'])
    await expect(page.locator('#root')).not.toHaveAttribute('data-adopted')
    await expect(page.locator('main')).toHaveCSS('font-family', /JetBrainsMono/)
    expect(
      await page
        .locator('link[rel="stylesheet"]')
        .evaluateAll((links) =>
          links.every((link) => link instanceof HTMLLinkElement && link.sheet !== null),
        ),
    ).toBe(true)
  })
})
