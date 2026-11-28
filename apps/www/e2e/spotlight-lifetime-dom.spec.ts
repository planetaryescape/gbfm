import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { expect, test } from '@playwright/test'
import { Schema } from 'effect'

import { ContentItem } from '../src/domain/content-item'
import { pageFixture } from '../src/server/page-fixture.test-support'

test('a pending Spotlight position keeps its owned stage and never steals later foreign focus', async ({
  page,
}) => {
  const path = '/editorial/owned-spotlight-fixture'
  const gate = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()

  const richDocument = Schema.decodeUnknownSync(RichContentDocument)({
    ...parseRichContent(
      'Intro.\n\n## Chapter\n\n### First record\n\nFirst.\n\n### Second record\n\nSecond.',
    ).document,
    layout: 'spotlight',
  })

  const item = ContentItem.make({
    id: 'owned-spotlight-fixture',
    slug: 'owned-spotlight-fixture',
    title: 'Owned Spotlight',
    description: 'Disposable fixture',
    imageUrl: null,
    href: path,
    meta: null,
    content: '',
    richContent: richDocument,
    draft: false,
    audioUrl: null,
    audioType: null,
    show: null,
    creators: [],
    tags: [],
    streamingLinks: [],
  })

  await page.route(`**${path}?*`, async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.delete('__data')

    if (url.searchParams.get('at') === '1.2') {
      requested.resolve()
      await gate.promise
    }

    await route.fulfill({ json: { ...pageFixture(path).flags, url: url.href, items: [item] } })
  })

  try {
    await page.goto('/about')
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
    await page.evaluate((href) => {
      const link = document.createElement('a')
      link.href = href
      link.textContent = 'Open owned Spotlight'
      document.body.append(link)
    }, `${path}?at=1.1`)
    await page.getByRole('link', { name: 'Open owned Spotlight', exact: true }).click()
    const stage = page.getByRole('region', { name: 'Current editorial entry', exact: true })
    await expect(stage.getByRole('heading', { name: 'First record', exact: true })).toBeVisible()
    const original = await stage.elementHandle()

    if (!original) throw new Error('Missing stage')
    await stage.focus()
    await page.keyboard.press('ArrowRight')
    await requested.promise
    await expect(stage).toBeFocused()
    expect(await original.evaluate((node) => node.isConnected)).toBe(true)
    await page.evaluate(() => {
      const button = document.createElement('button')
      button.textContent = 'Foreign focus owner'
      document.body.append(button)
      button.focus()
    })
    const completed = page.waitForResponse((response) => response.url().includes(`${path}?at=1.2`))
    gate.resolve()
    await completed
    await expect(stage.getByRole('heading', { name: 'Second record', exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Foreign focus owner', exact: true }),
    ).toBeFocused()
    expect(await original.evaluate((node) => node.isConnected)).toBe(true)
  } finally {
    gate.resolve()
  }
})
