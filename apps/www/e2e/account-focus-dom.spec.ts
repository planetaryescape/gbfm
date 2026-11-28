import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    ownedAccountFocusEvents: Array<{ type: string; target: string | null; active: string | null }>
  }
}

test('account focus survives immediate reopen and sequential keyboard navigation', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const events: Array<{ type: string; target: string | null; active: string | null }> = []
    window.ownedAccountFocusEvents = events

    for (const type of ['focusin', 'focusout', 'keydown', 'pointerdown', 'click']) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target

          if (!(target instanceof Element) || target.matches('input')) return
          events.push({
            type,
            target:
              target.getAttribute('href') ?? target.getAttribute('aria-label') ?? target.tagName,
            active:
              document.activeElement?.getAttribute('href') ??
              document.activeElement?.tagName ??
              null,
          })
        },
        true,
      )
    }
  })

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/auth/sign-in')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('creator@gbfm.local')
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    const trigger = page.getByRole('button', { name: 'Account menu', exact: true })
    const menu = page.getByRole('navigation', { name: 'Account', exact: true })
    await expect(trigger).toBeEnabled()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await trigger.click()
    await expect(menu).not.toBeVisible()
    await trigger.click()
    const backdrop = await page.locator('.account-menu-backdrop').boundingBox()

    if (!backdrop) throw new Error('Expected account backdrop')
    await page.mouse.click(backdrop.x + backdrop.width - 20, backdrop.y + 20)
    await expect(menu).not.toBeVisible()
    await trigger.click()
    await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(menu.getByRole('link', { name: 'Listening pile', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(menu.getByRole('link', { name: 'Edit profile', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/dashboard\/profile$/)
    await expect(menu).not.toBeVisible()
  } finally {
    await info.attach('account-focus-events', {
      body: JSON.stringify(await page.evaluate(() => window.ownedAccountFocusEvents), null, 2),
      contentType: 'application/json',
    })
  }
})
