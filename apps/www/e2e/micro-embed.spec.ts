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
  await expect(card.getByRole('link', { name: 'View original note on GBFM' })).toContainText(
    /\w+ \d+, \d{4}/,
  )
  const avatar = card.getByRole('img', { name: "Local Creator's avatar" })
  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('sizes', /^(36|40)px$/)
  await expect
    .poll(() =>
      avatar.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0),
    )
    .toBe(true)
  await expect(card.getByRole('link', { name: 'Local Creator', exact: true })).toHaveAttribute(
    'href',
    '/profile/local-creator',
  )
  await expect(card.locator('footer')).toHaveCount(0)
  await expect(card).not.toContainText('GBFM note')
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

test('micro card keeps its photo, text and date readable across narrow and wide layouts', async ({
  page,
}) => {
  await page.goto('/editorial/e2e-micro-editorial')
  const card = page.locator('.rich-content-micro')
  await expect(card).toBeVisible()

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await card.evaluate((element) => {
      const body = element.querySelector('.rich-content-micro-body p')
      const link = element.querySelector('a[aria-label="View original note on GBFM"]')
      const avatar = element.querySelector('img')
      if (!body || !link || !avatar) throw new Error('Expected note body, photo and permalink')
      const bounds = element.getBoundingClientRect()
      const linkBounds = link.getBoundingClientRect()

      return {
        fits: bounds.left >= 0 && bounds.right <= window.innerWidth,
        width: bounds.width,
        noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
        linkFits: linkBounds.left >= bounds.left && linkBounds.right <= bounds.right,
        bodyFontSize: Number.parseFloat(getComputedStyle(body).fontSize),
        dateFontSize: Number.parseFloat(getComputedStyle(link).fontSize),
        avatarWidth: avatar.getBoundingClientRect().width,
      }
    })
    expect(layout.fits).toBe(true)
    expect(layout.noHorizontalOverflow).toBe(true)
    expect(layout.linkFits).toBe(true)
    expect(layout.bodyFontSize).toBeGreaterThanOrEqual(14)
    expect(layout.dateFontSize).toBeLessThan(layout.bodyFontSize)
    expect(layout.avatarWidth).toBeGreaterThanOrEqual(32)
    expect(layout.avatarWidth).toBeLessThanOrEqual(40)
    if (width === 1280) expect(layout.width).toBeLessThanOrEqual(600)
  }
})
