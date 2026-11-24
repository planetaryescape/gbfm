import { expect, test } from '@playwright/test'

test('native micro card is readable, responsive and links to the original note', async ({
  page,
}) => {
  await page.goto('/editorial/e2e-micro-editorial')
  const card = page.locator('.rich-content-micro')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Some records stay with you.')
  await expect(card.locator('strong')).toHaveText('local note')
  await expect(card.locator('.rich-content-micro-author')).not.toBeEmpty()
  await expect(card.locator('iframe')).toHaveCount(0)
  await expect(page.getByText('Before the note.')).toBeVisible()
  await expect(page.getByText('After the note.')).toBeVisible()
  const fits = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect()

    return bounds.left >= 0 && bounds.right <= window.innerWidth
  })
  expect(fits).toBe(true)
  await card.getByRole('link', { name: 'View original note on GBFM' }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-native-micro$/)
  await expect(page.getByText('Some records stay with you.', { exact: false })).toBeVisible()
})
