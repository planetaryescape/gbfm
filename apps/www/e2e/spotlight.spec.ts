import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'

import type { Flags } from '../src/model'

const path = '/editorial/review-fixture'
const storageKey = `gbfm:spotlight:${path}`
const richContent = Schema.decodeUnknownSync(RichContentDocument)({
  version: 1,
  blocks: [
    ...parseRichContent(
      'A synthetic introduction.\n\n## First chapter\n\nAn opener.\n\n### First record\n\nA listening note.\n\n### Second record\n\nAnother note.',
    ).document.blocks,
    {
      _tag: 'MusicEmbed',
      music: {
        entityType: 'track',
        entityId: 'fixture-track',
        title: 'Synthetic track',
        artists: ['Fixture artist'],
        description: null,
        imageUrl: null,
        canonicalUrl: 'https://open.spotify.com/track/FixtureTrack',
        links: [{ platform: 'spotify', url: 'https://open.spotify.com/track/FixtureTrack' }],
        tracks: [],
      },
      genres: [],
      blurb: null,
      showTracks: false,
    },
  ],
  layout: 'spotlight',
})

const open = async (
  page: Page,
  at: string | null,
  stored: string | null = null,
  options: { draft?: boolean; document?: typeof RichContentDocument.Type } = {},
) => {
  await page.goto('/editorial')
  await expect(page.locator('.site')).toHaveAttribute('data-interactive', 'true')
  await page.evaluate(
    ({ key, stored }) => {
      localStorage.setItem(key, JSON.stringify({ at: stored, seen: ['intro', 'obsolete'] }))
    },
    { key: storageKey, stored },
  )
  await page.route(`**${path}?*`, (route) => {
    const url = new URL(route.request().url())
    url.searchParams.delete('__data')
    const flags: Flags = {
      url: url.href,
      status: 200,
      principal: null,
      items: [
        {
          id: 'review-fixture',
          slug: 'review-fixture',
          title: 'Synthetic spotlight',
          description: 'Synthetic review evidence.',
          imageUrl: null,
          href: path,
          meta: null,
          content: '',
          richContent: options.document ?? richContent,
          draft: options.draft ?? false,
          audioUrl: null,
          audioType: null,
          show: null,
          creators: [],
          tags: [],
          streamingLinks: [],
        },
      ],
      title: 'Synthetic spotlight',
      description: 'Synthetic review evidence.',
      requestId: 'review-fixture',
      renderedAt: 0,
      skipSeen: false,
      tweet: null,
      neighbours: null,
      dashboard: null,
      profile: null,
      shows: null,
      changelog: null,
      publicAction: null,
      metadata: null,
      failure: null,
    }

    return route.fulfill({ json: flags })
  })
  await page.evaluate(
    (href) => {
      const link = document.createElement('a')
      link.href = href
      link.textContent = 'Open synthetic spotlight'
      document.body.append(link)
      link.click()
      link.remove()
    },
    at === null ? path : `${path}?at=${encodeURIComponent(at)}`,
  )
  await expect(page.locator('.spotlight-stage')).toBeVisible()
}

for (const height of [633, 900]) {
  test(`desktop draft entries scroll inside the reader at ${height}px height`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height })
    await open(page, '1.2', null, {
      draft: true,
      document: Schema.decodeUnknownSync(RichContentDocument)({
        ...richContent,
        blocks: [
          ...richContent.blocks,
          ...parseRichContent(
            Array.from({ length: 30 }, (_, index) => `Listening note ${index + 1}.`).join('\n\n'),
          ).document.blocks,
        ],
      }),
    })
    await expect(page.getByRole('complementary', { name: 'Private draft' })).toBeVisible()
    const stage = page.getByRole('region', { name: 'Current editorial entry' })
    await expect(stage).toHaveCSS('overflow-y', 'auto')
    const frame = await stage.boundingBox()
    expect(frame).not.toBeNull()
    expect(frame?.y).toBeGreaterThan(0)
    expect((frame?.y ?? 0) + (frame?.height ?? 0)).toBeLessThanOrEqual(height - 48)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(height)
    await stage.hover()
    await page.mouse.wheel(0, 900)
    await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.getByRole('button', { name: 'Previous entry', exact: true }).click()
    await expect(page).toHaveURL(/at=1\.1$/)
    await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBe(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
}

for (const at of [null, 'end']) {
  test(`draft ${at ?? 'intro'} keeps its natural document layout`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 633 })
    await open(page, at, null, { draft: true })
    await expect(page.getByRole('complementary', { name: 'Private draft' })).toBeVisible()
    await expect(page.locator('.spotlight-stage')).toHaveCSS('overflow-y', 'visible')
    await expect(page.locator('.spotlight-detail')).toHaveCSS('display', 'block')
  })
}

test('published desktop entries keep their existing reader height', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, '1.2')
  await expect(page.getByRole('complementary', { name: 'Private draft' })).toHaveCount(0)
  await expect(page.locator('.spotlight')).toHaveCSS('height', '804px')
  await expect(page.locator('.spotlight-detail')).toHaveCSS('display', 'block')
})

test('mobile draft entries retain document scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '1.2', null, { draft: true })
  await expect(page.getByRole('complementary', { name: 'Private draft' })).toBeVisible()
  await expect(page.locator('.spotlight-stage')).toHaveCSS('overflow-y', 'visible')
  await expect(page.locator('.spotlight-detail')).toHaveCSS('display', 'block')
})

for (const action of ['Play', 'Queue', 'Save']) {
  test(`Spotify ${action} 403 uses action-specific recovery guidance`, async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'spotify-effect:tokens',
        JSON.stringify({
          accessToken: 'synthetic-token',
          refreshToken: 'synthetic-refresh',
          accessTokenExpiresAt: Date.now() + 3600000,
        }),
      ),
    )
    await page.route('https://api.spotify.com/v1/**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/v1/me')
        return route.fulfill({
          json: {
            id: 'fixture',
            display_name: 'Fixture Listener',
            product: 'premium',
            type: 'user',
            uri: 'spotify:user:fixture',
            href: 'https://api.spotify.com/v1/users/fixture',
            external_urls: { spotify: 'https://open.spotify.com/user/fixture' },
            images: [],
          },
        })
      if (url.pathname === '/v1/me/player/devices')
        return route.fulfill({
          json: {
            devices: [
              {
                id: 'fixture-device',
                is_active: true,
                is_private_session: false,
                is_restricted: false,
                name: 'Fixture speaker',
                type: 'Computer',
                volume_percent: 50,
              },
            ],
          },
        })

      return route.fulfill({
        status: 403,
        json: { error: { status: 403, message: 'Fixture forbidden', reason: 'PREMIUM_REQUIRED' } },
      })
    })
    await open(page, '1.2')
    await page.getByRole('button', { name: action, exact: true }).click()
    if (action === 'Save') {
      await expect(page.getByRole('status').filter({ hasText: 'Reconnect Spotify' })).toBeVisible()
    } else {
      await expect(
        page.getByRole('status').filter({ hasText: 'Check your Premium account and device' }),
      ).toBeVisible()
      await expect(
        page.getByText('Reconnect Spotify to allow saving to your library.'),
      ).toHaveCount(0)
    }
  })
}

test('invalid linked and saved positions resolve to the intro in the view, URL and storage', async ({
  page,
}) => {
  for (const [linked, stored] of [
    ['', '1.1'],
    ['2.3', null],
    [null, '2.3'],
  ] as const) {
    await open(page, linked, stored)
    await expect(
      page.getByRole('heading', { name: 'Synthetic spotlight', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.spotlight-intro')).toContainText('A synthetic introduction.')
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), storageKey))
      .toEqual({ at: null, seen: ['intro'] })
    await page.unroute(`**${path}?*`)
  }
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`chapter-row activation restores owned focus with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion })
    await open(page, '1')
    const stage = page.getByRole('region', { name: 'Current editorial entry' })
    const row = page.getByRole('button', { name: 'Second record', exact: true })
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/at=1\.2$/)
    await expect(stage).toBeFocused()
    await expect(stage.getByRole('heading', { name: 'Second record' })).toBeVisible()

    const previous = page.getByRole('button', { name: 'Previous entry', exact: true })
    await previous.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/at=1\.1$/)
    await expect(previous).toBeFocused()

    const outside = page.getByRole('link', { name: 'Home', exact: true }).first()
    await outside.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/at=1\.2$/)
    await expect(outside).toBeFocused()
  })

  for (const width of [390, 1280]) {
    test(`keyboard navigation retains stage focus at ${width}px with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion })
      await open(page, '1')
      const stage = page.getByRole('region', { name: 'Current editorial entry' })
      const frame = await page.locator('.spotlight').boundingBox()
      await stage.focus()
      await expect(stage).toBeFocused()
      await page.evaluate(() => {
        const stage = document.querySelector('.spotlight-stage')
        stage?.setAttribute('data-focus-identity', 'original')
      })
      for (const [key, position, direction] of [
        ['ArrowRight', '1.1', 'forward'],
        ['l', '1.2', 'forward'],
        ['h', '1.1', 'backward'],
      ]) {
        await page.keyboard.press(key)
        await expect(page).toHaveURL(new RegExp(`at=${position?.replace('.', '\\.')}$`))
        await expect(stage).toBeFocused()
        await expect(stage).toHaveAttribute('data-focus-identity', 'original')
        await expect(stage).toHaveAttribute('aria-live', 'polite')
        await expect(stage).toHaveAttribute('data-direction', direction ?? '')
        await expect(stage.locator('.spotlight-step')).toHaveCSS(
          'animation-name',
          reducedMotion === 'reduce' ? 'none' : `spotlight-${direction}`,
        )
        await expect(stage.locator('.spotlight-step')).toHaveCSS(
          'animation-duration',
          reducedMotion === 'reduce' ? '0s' : '0.18s',
        )
        if (width === 1280) expect(await page.locator('.spotlight').boundingBox()).toEqual(frame)
      }
    })
  }
}
