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

test('newer unread tweets are visible without opening Options and Latest keeps a return point', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  const progress = page.getByRole('region', { name: 'Reading progress', exact: true })
  await expect(progress.getByText('Newer unread tweets available.', { exact: true })).toBeVisible()
  await progress.getByRole('link', { name: 'View latest', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/(?!latest|e2e-archive-one)[^?]+$/)
  await expect(
    progress.getByRole('link', { name: 'Back to where I was', exact: true }),
  ).toBeVisible()
  await progress.getByRole('link', { name: 'Back to where I was', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await expect(page.getByRole('link', { name: 'Back to where I was', exact: true })).toHaveCount(0)
})

test('returning to the app discovers newly published tweets without moving the reader', async ({
  page,
}) => {
  await signIn(page, 'creator')
  await page.goto('/tweet/latest')
  await expect(page.locator('[data-tweet-swipe]')).toHaveAttribute('data-reading-status', 'ready')
  const previous = new URL(page.url()).pathname
  await expect(page.getByRole('link', { name: 'View latest', exact: true })).toHaveCount(0)
  const slug = `e2e-new-since-focus-${crypto.randomUUID()}`

  const created = await page.request.post('/api/content/post', {
    data: {
      type: 'micro',
      title: 'A new disposable signal',
      content: 'Discover this on returning to the reader.',
      slug,
      draft: false,
    },
  })

  expect(created.ok()).toBe(true)

  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith(`${previous.split('/').pop()}/neighbours`),
  )

  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect((await refreshed).ok()).toBe(true)
  await expect(page.getByRole('link', { name: 'View latest', exact: true })).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === previous)
  await page.getByRole('link', { name: 'View latest', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/tweet/${slug}$`))
  await page.getByRole('link', { name: 'Back to where I was', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === previous)
})
