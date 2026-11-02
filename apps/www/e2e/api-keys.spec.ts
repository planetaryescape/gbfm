import { expect, test, type Page } from '@playwright/test'

const signIn = async (page: Page, role: string) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`${role}@gbfm.local`)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto('/dashboard/profile')
  await page.getByRole('link', { name: 'API keys', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh keys', exact: true })).toBeEnabled()
}

test('creates, displays once, lists and revokes a personal key', async ({ page }) => {
  await signIn(page, 'creator')
  await expect(
    page.getByRole('checkbox', { name: 'Publish and change published posts' }),
  ).toHaveCount(0)
  const name = `Disposable writing agent ${crypto.randomUUID()}`
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByRole('checkbox', { name: 'Read your posts' }).check()
  await page.getByRole('checkbox', { name: 'Create drafts' }).check()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const secret = page.getByRole('textbox', { name: 'New API key secret', exact: true })
  await expect(secret).toBeVisible()
  expect(
    await secret.evaluate(
      (input) => input instanceof HTMLInputElement && input.value.startsWith('gbfm_pat_v1_dev_'),
    ),
  ).toBe(true)

  const key = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })

  await expect(key).toContainText('posts:create')
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'I saved my key', exact: true }).click()
  await expect(secret).toHaveCount(0)
  await page.reload()
  await expect(secret).toHaveCount(0)
  await expect(key).toBeVisible()
  await key.getByRole('button', { name: 'Revoke key', exact: true }).click()
  await key.getByRole('button', { name: 'Keep key', exact: true }).click()
  await expect(key.getByRole('button', { name: 'Confirm revoke', exact: true })).toHaveCount(0)
  await key.getByRole('button', { name: 'Revoke key', exact: true }).click()
  await key.getByRole('button', { name: 'Confirm revoke', exact: true }).click()
  await expect(key).toContainText('Revoked')
  await expect(key.getByRole('button', { name: 'Revoke key', exact: true })).toHaveCount(0)
})

test('listeners can manage keys but cannot create them', async ({ page }) => {
  await signIn(page, 'listener')
  await expect(
    page.getByText('Creator access is required to create API keys.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create key', exact: true })).toHaveCount(0)
})

test('admins can choose publication and invalid permissions are rejected locally', async ({
  page,
}) => {
  await signIn(page, 'admin')
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Invalid publication-only key')
  await page.getByRole('checkbox', { name: 'Publish and change published posts' }).check()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(
    page.getByText('Enter a name of up to 80 characters and select permissions.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'New API key secret', exact: true })).toHaveCount(
    0,
  )
})
