import { expect, test, type Page } from '@playwright/test'

const title = 'Unpublished listening notes'

const path = '/editorial/e2e-private-listening-notes'

const signIn = async (page: Page, email: string) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('authors discover drafts in editorial and read them in the normal article layout', async ({
  page,
}) => {
  await signIn(page, 'creator@gbfm.local')
  await page.goto('/editorial')
  const card = page.locator('main article').filter({ hasText: title })
  await expect(card.getByText('Draft', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: title, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Private draft' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit draft', exact: true })).toHaveAttribute(
    'href',
    '/new/editorial?edit=e2e-private-listening-notes',
  )
  await expect(page.locator('.rich-content strong')).toHaveText('private listening notes')
  await expect(page.locator('.rich-content-music-card')).toContainText('Grapefruit')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('link', { name: 'Edit draft', exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.getByRole('link', { name: 'Edit draft', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
    await page.goto(path)
  }

  const reload = await page.reload()
  expect(reload?.status()).toBe(200)
  expect(reload?.headers()['cache-control']).toBe('private, no-store')
  expect(reload?.headers()['x-robots-tag']).toBe('noindex, nofollow')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await page.getByRole('link', { name: 'Editorial', exact: true }).last().click()
  await page.getByRole('link', { name: 'Local listening notes', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Private draft' })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
})

test('anonymous readers cannot discover or read drafts, including data requests', async ({
  page,
}) => {
  await page.goto('/editorial')
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
  const response = await page.goto(path)
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  const data = await page.request.get(`${path}?__data=1`)
  expect(data.status()).toBe(404)
  expect(await data.text()).not.toContain('private listening notes')
})

test('other signed-in readers, including admins, cannot read someone else’s draft', async ({
  page,
}) => {
  for (const email of ['listener@gbfm.local', 'admin@gbfm.local']) {
    await signIn(page, email)
    await page.goto('/editorial')
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
    const data = await page.request.get(`${path}?__data=1`)
    expect(data.status()).toBe(404)
    expect(await data.text()).not.toContain('private listening notes')
    await page.request.post('/auth/sign-out', { headers: { origin: new URL(page.url()).origin } })
  }
})
