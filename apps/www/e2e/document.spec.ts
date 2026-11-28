import { expect, test } from '@playwright/test'

import { parseDocumentBootstrap, parseDocumentState } from './fixtures/native-document'

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('document styles load before the client, including mobile navigation', async ({ page }) => {
    await page.goto('/mixes/e2e-local-frequencies')

    const dock = page.locator('.station-navigation .mobile-dock').filter({
      has: page.locator('nav.dock-tabs'),
    })

    await expect(dock).toHaveCSS('position', 'fixed')
    await expect(dock).toBeHidden()

    const navigation = page.getByRole('navigation', {
      name: 'Navigation without JavaScript',
      exact: true,
    })

    await expect(navigation).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
      'href',
      '/',
    )
    await expect(
      page.getByRole('heading', { name: 'Local Frequencies', exact: true }),
    ).toBeVisible()
    const cover = page.getByRole('img', { name: 'Local Frequencies', exact: true }).first()
    await expect(cover).toHaveAttribute('src', '/gb-default-v1.webp')
    await expect(cover).toHaveJSProperty('naturalWidth', 1080)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})

test('whole-document responses preserve head metadata, HEAD, redirects, and JSON navigation', async ({
  request,
}) => {
  const response = await request.get('/mixes/e2e-local-frequencies', {
    headers: { 'x-request-id': 'document-browser-fixture' },
  })

  expect(response.status()).toBe(200)
  expect(response.headers()['x-request-id']).toBe('document-browser-fixture')
  expect(response.headers()['cache-control']).toContain('no-store')
  const html = await response.text()
  expect(html.match(/rel="canonical"/g)).toHaveLength(1)
  expect(html.match(/property="og:url"/g)).toHaveLength(1)
  expect(html.match(/name="viewport"/g)).toHaveLength(1)
  expect(html).toContain('viewport-fit=cover')
  expect(html).toContain('MusicRecording')
  expect(html.match(/id="gbfm-ui-state"/g)).toHaveLength(1)
  expect(html.match(/id="gbfm-ui-props"/g)).toHaveLength(1)
  expect(html).toContain('type="application/json" id="gbfm-ui-state"')
  expect(html).toContain('type="application/json" id="gbfm-ui-props"')
  const head = await request.head('/mixes/e2e-local-frequencies')
  expect(head.status()).toBe(200)
  expect(await head.body()).toHaveLength(0)
  expect(head.headers()['content-type']).toContain('text/html')
  expect(head.headers()['x-request-id']).toBeTruthy()
  const missing = await request.get('/not-a-route')
  expect(missing.status()).toBe(404)
  expect(await missing.text()).toContain('noindex, nofollow')
  const redirect = await request.get('/tweet', { maxRedirects: 0 })
  expect(redirect.status()).toBe(303)
  expect(redirect.headers().location).toBe('/tweets')
  const data = await request.get('/mixes/e2e-local-frequencies?__data=1')
  expect(data.headers()['content-type']).toContain('application/json')
  expect(await data.json()).toMatchObject({ status: 200, title: 'Local Frequencies' })
})

for (const theme of ['light', 'dark']) {
  test(`${theme} document restores the queue and adopts the existing SSR root`, async ({
    page,
  }) => {
    const errors: Array<string> = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((theme) => {
      localStorage.setItem('vite-ui-theme', theme)
      localStorage.setItem(
        'gbfm-audio-queue.json',
        JSON.stringify({
          currentIndex: 0,
          tracks: [
            {
              id: 'document-audio',
              title: 'Restored fixture',
              slug: 'e2e-local-frequencies',
              url: '/api/e2e-audio.wav',
              thumbnailUrl: theme === 'light' ? null : 'https://cdn.goosebumps.fm/art.png',
              type: 'mix',
            },
          ],
        }),
      )
    }, theme)
    const gate = Promise.withResolvers<void>()
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await gate.promise
      await route.continue()
    })

    try {
      await page.goto('/mixes/e2e-local-frequencies', { waitUntil: 'commit' })
      const root = page.locator('.site')
      await expect(root).toHaveCount(1)
      await expect(page.locator('html')).not.toHaveAttribute('data-gbfm-hydrated')
      const stateScript = page.locator('script#gbfm-ui-state[type="application/json"]')
      const propsScript = page.locator('script#gbfm-ui-props[type="application/json"]')
      await expect(stateScript).toHaveCount(1)
      await expect(propsScript).toHaveCount(1)
      const state = parseDocumentState((await stateScript.textContent()) ?? '')
      const props = parseDocumentBootstrap((await propsScript.textContent()) ?? '')
      expect(Object.keys(state)).toContain('/RoutedApplication')
      expect(props).toMatchObject({
        kind: 'routed',
        url: expect.stringContaining('/mixes/e2e-local-frequencies'),
        realm: expect.any(String),
      })
      expect(props.realm.length).toBeGreaterThan(0)
      const original = await root.elementHandle()

      if (!original) throw new Error('Missing SSR root')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
        'content',
        theme === 'dark' ? '#16415a' : '#e4ecf6',
      )
      await expect(page.locator('html')).toHaveAttribute('data-queued', '')
      expect(
        await page.locator('html').evaluate((html) => html.style.getPropertyValue('--queued-art')),
      ).toContain(theme === 'light' ? '/gb-default-v1.webp' : 'art.png?w=96&q=80&f=webp')
      gate.resolve()
      await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
      expect(await original.evaluate((node) => node.isConnected)).toBe(true)
      expect(await original.evaluate((node) => node === document.querySelector('.site'))).toBe(true)
      await expect(root).toHaveCount(1)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
        'content',
        theme === 'dark' ? '#16415a' : '#e4ecf6',
      )
      await expect(stateScript).toHaveCount(1)
      await expect(propsScript).toHaveCount(1)
      await page
        .getByRole('region', { name: 'Mini player', exact: true })
        .getByRole('button', { name: 'Now playing', exact: true })
        .click()
      const player = page.getByRole('dialog', { name: 'Now playing', exact: true })
      await expect(player).toContainText('Restored fixture')
      await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
      expect(errors).toEqual([])
    } finally {
      gate.resolve()
    }
  })
}

test('browser chrome follows theme changes and the page surface', async ({ page }) => {
  await page.goto('/shows/e2e-local-radio')
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')

  for (const theme of ['light', 'dark', 'system']) {
    await page.evaluate((theme) => {
      localStorage.setItem('vite-ui-theme', theme)
      window.dispatchEvent(new StorageEvent('storage', { key: 'vite-ui-theme' }))
    }, theme)
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'light' ? 'light' : 'dark',
    )
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      theme === 'light' ? '#e4ecf6' : '#16415a',
    )

    const surfaces = await page.locator('.site').evaluate((site) => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      page: getComputedStyle(site).backgroundColor,
    }))

    expect(surfaces.root).toBe(surfaces.page)

    const edge = await page.evaluate(() => {
      const navigation = document.querySelector('nav.dock-tabs')

      return {
        floats: navigation ? navigation.getBoundingClientRect().bottom < innerHeight : false,
        docked: Boolean(
          document.elementFromPoint(innerWidth / 2, innerHeight - 1)?.closest('.mobile-dock'),
        ),
      }
    })

    expect(edge).toEqual({ floats: true, docked: false })
  }
})

test('keyboard search stream opens after hydration', async ({ page }) => {
  await page.goto('/mixes')
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toBeVisible()
})

test('failed responsive artwork recovers to the local cover and does not retry a failed fallback', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
  const cover = page.locator('.featured-art img.artwork')
  await cover.evaluate((image: HTMLImageElement) => {
    image.srcset = '/missing-cover.png 640w'
    image.src = '/missing-cover.png'
  })
  await expect(cover).toHaveAttribute('src', '/gb-default-v1.webp')
  await expect(cover).not.toHaveAttribute('srcset')
  await cover.evaluate((image: HTMLImageElement) => image.decode())
  expect(await cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)

  // An error on the fallback itself must not write src again and cause a request loop.
  const mutations = await cover.evaluate(async (image) => {
    let changes = 0

    const observer = new MutationObserver((records) => {
      changes += records.length
    })

    observer.observe(image, { attributes: true, attributeFilter: ['src'] })
    image.dispatchEvent(new Event('error'))
    await Promise.resolve()
    observer.disconnect()

    return changes
  })

  expect(mutations).toBe(0)
})
