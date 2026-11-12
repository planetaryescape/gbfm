import { readFile, readdir } from 'node:fs/promises'

import {
  MusicSnapshot,
  type RichContentBlock,
  RichContentDocument,
} from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { expect, test } from '@playwright/test'
import { Data, Effect, Schema } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { richContentView } from '../src/view/rich-content/render'

const { MusicEmbed } = Data.taggedEnum<RichContentBlock>()

const render = async () => {
  const document = Schema.decodeUnknownSync(RichContentDocument)({
    version: 1,
    blocks: [
      ...Array.from({ length: 80 }, (_, index) =>
        MusicEmbed({
          music: Schema.decodeUnknownSync(MusicSnapshot)({
            entityType: 'track',
            entityId: `fixture-${index}`,
            title: `Fixture track ${index}`,
            artists: ['Fixture artist'],
            description: null,
            imageUrl: `https://artwork.fixture.test/cover-${index}.svg`,
            canonicalUrl: `https://example.com/track/${index}`,
            links: [{ platform: 'spotify', url: `https://example.com/listen/${index}` }],
            tracks: [],
          }),
          genres: [],
          blurb: null,
          showTracks: false,
        }),
      ),
      ...parseRichContent('[Watch the session](https://youtu.be/example)').document.blocks,
    ],
  })

  const rendered = await Effect.runPromise(
    Server.renderToString(
      {
        init: () => ({ model: document }),
        view: (model: RichContentDocument, h) => ({
          title: 'Long music article fixture',
          body: richContentView(model, h),
        }),
      },
      { isHydratable: false },
    ),
  )

  const assets = new URL('../dist/client/assets/', import.meta.url)
  const styles = (await readdir(assets)).filter((name) => name.endsWith('.css'))
  expect(styles.length).toBeGreaterThan(0)

  const css = (
    await Promise.all(styles.map((name) => readFile(new URL(name, assets), 'utf8')))
  ).join('\n')

  return `<style>${css}</style><main style="width:600px;max-width:100%;margin:auto">${rendered.html}</main>`
}

test('long music articles defer distant artwork while keeping metadata and links accessible', async ({
  page,
}) => {
  const requested = new Set<string>()
  await page.route('https://artwork.fixture.test/**', async (route) => {
    requested.add(route.request().url())
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>',
    })
  })
  await page.setContent(await render())
  const cards = page.locator('.rich-content-music-card')
  await expect(cards).toHaveCount(80)
  await expect(cards.first()).toHaveCSS('content-visibility', 'auto')
  await expect.poll(() => requested.has('https://artwork.fixture.test/cover-0.svg')).toBe(true)
  expect(requested.has('https://artwork.fixture.test/cover-79.svg')).toBe(false)
  expect(await cards.last().textContent()).toContain('Fixture track 79')
  expect(await cards.last().textContent()).toContain('Fixture artist')

  await cards.last().scrollIntoViewIfNeeded()
  await expect.poll(() => requested.has('https://artwork.fixture.test/cover-79.svg')).toBe(true)

  const title = cards.last().getByRole('link', {
    name: 'Fixture track 79 by Fixture artist (opens in a new tab)',
    exact: true,
  })

  await title.focus()
  await expect(title).toBeFocused()
  await expect(cards.last().getByRole('img')).toHaveAttribute(
    'alt',
    'Artwork for Fixture track 79 by Fixture artist',
  )
  const video = page.getByRole('link', { name: 'Watch the session', exact: true })
  await expect(video.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  await page.emulateMedia({ media: 'print' })
  await expect(cards.last()).toHaveCSS('content-visibility', 'visible')
})
