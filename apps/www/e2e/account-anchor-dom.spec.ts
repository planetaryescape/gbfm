import { expect, test } from '@playwright/test'

test('account trigger identity and popup anchor survive parent renders and repeated opening', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('listener@gbfm.local')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true })
  await expect(trigger).toBeEnabled()
  const originalId = await trigger.getAttribute('id')
  expect(originalId).toBeTruthy()
  const original = await trigger.elementHandle()

  if (!original) throw new Error('Expected account trigger')
  const menu = page.getByRole('navigation', { name: 'Account', exact: true })

  for (let cycle = 0; cycle < 3; cycle++) {
    await trigger.click()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused()
    await expect(trigger).toHaveAttribute('id', originalId ?? '')
    expect(
      await original.evaluate(
        (node) =>
          node.isConnected && node === document.querySelector('button[aria-label="Account menu"]'),
      ),
    ).toBe(true)

    const positioner = page.locator(
      'dialog:has(nav[aria-label="Account"]) [role="presentation"][data-side]',
    )

    await expect
      .poll(() =>
        positioner.evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).getPropertyValue('--anchor-width')),
        ),
      )
      .toBeGreaterThan(0)
    const bounds = await menu.boundingBox()
    const anchor = await trigger.boundingBox()

    if (!bounds || !anchor) throw new Error('Expected visible popup and anchor boxes')
    expect(bounds.x).toBeGreaterThan(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y)
    expect(Math.abs(bounds.x + bounds.width - anchor.x - anchor.width)).toBeLessThanOrEqual(1)
    await page
      .locator('.station-desktop')
      .getByRole('button', { name: /^Theme:/ })
      .click()
    await expect(menu).not.toBeVisible()
    await expect(trigger).toHaveAttribute('id', originalId ?? '')
  }
})
