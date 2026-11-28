import { expect, test } from '@playwright/test'

test('SSR no-JS latest fallback never becomes an active refresh during hydration', async ({
  page,
}, info) => {
  const entry = Promise.withResolvers<void>()
  const navigation = Promise.withResolvers<void>()
  const documents: Array<string> = []
  const errors: Array<string> = []
  let before: { children: number; text: string | null } | undefined
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('gbfm:tweet-checkpoint:anonymous', 'e2e-archive-one')

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue

          const metas = node.matches('meta[http-equiv="refresh"]')
            ? [node]
            : [...node.querySelectorAll('meta[http-equiv="refresh"]')]

          for (const meta of metas) {
            if (!meta.closest('#root')) continue
            sessionStorage.setItem('fixture:hydrated-refresh', meta.outerHTML)
          }
        }
      }
    })

    observer.observe(document, { childList: true, subtree: true })
  })
  await page.route('**/src/entry.effect.client.ts*', async (route) => {
    await entry.promise
    await route.continue()
  })
  await page.route('**/tweet/latest', async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue()
    documents.push(route.request().url())
    await navigation.promise
    await route.fulfill({ contentType: 'text/html', body: '<h1>Unexpected latest document</h1>' })
  })

  try {
    await page.goto('/tweets', { waitUntil: 'commit' })
    const fallback = page.locator('noscript:not(:empty)')
    await expect(fallback).toHaveCount(1)
    before = await fallback.evaluate((node) => ({
      children: node.childElementCount,
      text: node.textContent,
    }))
    expect(before.children).toBe(0)
    entry.resolve()
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
    await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)

    const activeRefresh = await page.evaluate(() =>
      sessionStorage.getItem('fixture:hydrated-refresh'),
    )

    expect(activeRefresh).toBeNull()
    expect(documents).toEqual([])
    await expect(page.locator('#root meta[http-equiv="refresh"]')).toHaveCount(0)
  } finally {
    const activeRefresh = await page.evaluate(() =>
      sessionStorage.getItem('fixture:hydrated-refresh'),
    )

    await info.attach('SSR-hydration-refresh-proof', {
      contentType: 'application/json',
      body: JSON.stringify({ before, activeRefresh, documents, errors }),
    })
    entry.resolve()
    navigation.resolve()
  }
})
