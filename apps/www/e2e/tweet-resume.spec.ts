import { expect, test, type Page } from '@playwright/test'

const signIn = async (page: Page, role: string) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`${role}@gbfm.local`)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('a fresh browser session resumes durable progress and shared URLs still win', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/tweet/e2e-archive-one')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gbfm:tweet-checkpoint:anonymous')))
    .toBe('e2e-archive-one')
  const state = await context.storageState()
  await context.close()

  const reopened = await browser.newContext({ baseURL, storageState: state })

  try {
    const restored = await reopened.newPage()
    await restored.goto('/tweets')
    await expect(restored).toHaveURL(/\/tweet\/e2e-archive-one$/)
    await restored.goto('/tweet/e2e-archive-two')
    await expect(restored).toHaveURL(/\/tweet\/e2e-archive-two$/)
    await expect(restored.locator('[data-tweet-swipe]')).toBeVisible()
  } finally {
    await reopened.close()
  }
})

test('different accounts and signed-out reading retain their own places', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-one')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gbfm:tweet-checkpoint:anonymous')))
    .toBe('e2e-archive-one')
  await signIn(page, 'creator')
  await page.goto('/tweet/e2e-archive-two')
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage).some(
          ([key, value]) =>
            key !== 'gbfm:tweet-checkpoint:anonymous' &&
            key.startsWith('gbfm:tweet-checkpoint:') &&
            value === 'e2e-archive-two',
        ),
      ),
    )
    .toBe(true)
  await page.goto('/dashboard/profile')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await signIn(page, 'creator')
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
})
