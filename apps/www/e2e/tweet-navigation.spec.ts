import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'

const openReader = async (page: Page) => {
  await page.locator('summary[aria-label="Reading options"]').click()

  return page.locator('details[data-tweet-dock]')
}

const chooseTweets = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Menu', exact: true })
    .getByRole('link', { name: 'Tweets', exact: true })
    .click()
}

test('the discarded archive URL returns to a single full post', async ({ page }) => {
  await page.goto('/tweets?q=archive')
  await expect(page).toHaveURL(/\/tweet\/[^/?]+$/)
  await expect(page.locator('[data-tweet-swipe]')).toBeVisible()
  await expect(page.locator('.tweet-browse-row')).toHaveCount(0)
})

test('visiting a month opens one full post without background keyboard navigation', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  const reader = await openReader(page)
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await expect(page.locator('.tweet-browse-row')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Browse tweets', exact: true })).toHaveCount(0)
  await reader.getByText('Visit a month', { exact: true }).click()
  await reader.getByRole('combobox', { name: 'Choose a month' }).selectOption('e2e-archive-two')
  await reader.getByRole('button', { name: 'Visit', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  const next = await openReader(page)
  await next.getByText('Visit a month', { exact: true }).click()
  await expect(next.getByRole('combobox', { name: 'Choose a month' })).toHaveValue(
    'e2e-archive-two',
  )
  await next.getByRole('combobox', { name: 'Choose a month' }).selectOption('e2e-archive-one')
  await next.getByRole('button', { name: 'Visit', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('visiting a month works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/tweet/e2e-archive-one')
  const reader = await openReader(page)
  await reader.getByText('Visit a month', { exact: true }).click()
  await reader.getByRole('combobox', { name: 'Choose a month' }).selectOption('e2e-archive-two')
  await reader.getByRole('button', { name: 'Visit', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await context.close()
})

test('reading options stay in the header and do not add a fixed layer over the tweet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tweet/e2e-music-thread')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

  const [contentBottom, dockTop] = await page.evaluate(() => {
    const dock = document.querySelector('.dock-tabs')
    const replies = document.getElementById('replies')

    return [replies?.getBoundingClientRect().bottom ?? 0, dock?.getBoundingClientRect().top ?? 0]
  })

  expect(contentBottom).toBeLessThanOrEqual(dockTop)
  await expect(page.locator('.tweet-reader-navigation')).toHaveCSS('position', 'relative')
  await expect(page.locator('.tweet-reader-navigation')).not.toBeInViewport()
})

test('chronological arrows stay adjacent regardless of seen history', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-one')
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Skip seen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await expect(page.locator('#tweet-newer')).toHaveAttribute('href', '/tweet/e2e-archive-two')
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await expect(page.locator('#tweet-older')).toHaveAttribute('href', '/tweet/e2e-archive-one')
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
})

test('legacy new-tweet URL redirects to the composer rather than looking up a tweet named new', async ({
  request,
}) => {
  const response = await request.get('/tweet/new', { maxRedirects: 0 })
  expect(response.status()).toBe(303)
  expect(response.headers().location).toBe('/new/tweet')
})

test('random unread form loads another published tweet through the local API', async ({ page }) => {
  const seen = page.waitForResponse(
    (response) =>
      response.url().endsWith('/e2e-archive-one/seen') && response.request().method() === 'POST',
  )

  await page.goto('/tweet/e2e-archive-one')
  expect((await seen).ok()).toBe(true)
  await (await openReader(page)).getByRole('button', { name: 'Surprise me', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/(?!e2e-archive-one)[^?]+$/)
  await expect(
    (await openReader(page)).getByRole('link', { name: 'Latest', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('No unread tweet could be loaded. Try again.')).toHaveCount(0)
})

test('Tweets resumes the last successful visit across leaving and reload, while direct URLs and Back win', async ({
  page,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await page.goto('/about')
  await page.reload()
  await chooseTweets(page)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await (await openReader(page)).getByRole('link', { name: 'Latest', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/(?!latest|e2e-archive-one)[^?]+$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await page.goto('/tweet/e2e-archive-two')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
})

test('hard Tweets entry preserves resume intent without marking latest and prefetched content is not a visit', async ({
  page,
}) => {
  await page.goto('/tweet/latest')
  const latest = new URL(page.url()).pathname

  const prefetched = page.waitForResponse((response) =>
    response.url().includes('/tweet/e2e-archive-two?__data=1'),
  )

  await page.goto('/tweet/e2e-archive-one')
  expect((await prefetched).ok()).toBe(true)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint')))
    .toBe('e2e-archive-one')
  const writes: Array<string> = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/seen'))
      writes.push(new URL(request.url()).pathname)
  })
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint')))
    .toBe('e2e-archive-one')
  expect(writes).not.toContain(`/api/content/posts/micro/${latest.split('/').pop()}/seen`)
})

test('a deleted automatic checkpoint falls back once, but a direct missing URL stays missing', async ({
  page,
}) => {
  await page.goto('/about')
  await page.evaluate(() => sessionStorage.setItem('gbfm:tweet-checkpoint', 'e2e-deleted-tweet'))
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/(?!latest|e2e-deleted-tweet)[^?]+$/)
  await expect(
    (await openReader(page)).getByRole('link', { name: 'Latest', exact: true }),
  ).toBeVisible()
  await page.goto('/tweet/e2e-deleted-tweet')
  await expect(page).toHaveURL(/\/tweet\/e2e-deleted-tweet$/)
  await expect(page.getByText('Tweet not found.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Latest', exact: true })).toBeVisible()
})

test('storage denial degrades to latest and independent tabs do not share checkpoints', async ({
  page,
  context,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint')))
    .toBe('e2e-archive-one')
  const other = await context.newPage()
  await other.goto('/tweets')
  await expect(other).toHaveURL(/\/tweet\/(?!latest|e2e-archive-one)[^?]+$/)
  await other.close()
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('Storage denied', 'SecurityError')
      },
    })
  })
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/(?!latest|e2e-archive-one)[^?]+$/)
})

test('tweet search URLs do not resume and unread failures do not claim caught up', async ({
  page,
}) => {
  await page.goto('/tweets?q=ambient')
  await expect(page).toHaveURL(/\/tweets\?q=ambient$/)
  await page.route('**/api/content/posts/micro/*/neighbours', (route) =>
    route.fulfill({ status: 500, body: '{}' }),
  )
  await page.goto('/tweet/e2e-archive-one')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  const reader = await openReader(page)
  await expect(reader.getByText('Unread navigation unavailable', { exact: true })).toBeVisible()
  await expect(page.getByText('Caught up', { exact: true })).toHaveCount(0)
  await expect(reader.getByRole('button', { name: 'Retry navigation', exact: true })).toBeVisible()
})

test('Next unread goes older first, then clearly changes to newer, and reports caught up only at zero', async ({
  page,
}) => {
  // Other journeys publish tweets into the shared fixture DB. Isolate this reader's history,
  // not the feed: only the three seed roots should remain unread for this scenario.
  const api = page.context().request
  expect((await api.get('/api/content/posts/micro/e2e-archive-two/neighbours')).ok()).toBe(true)
  const response = await api.get('/api/content/posts/micro?limit=100')
  expect(response.ok()).toBe(true)

  const feed = Schema.decodeUnknownSync(
    Schema.Struct({
      data: Schema.Array(
        Schema.Struct({ slug: Schema.String, parentPostId: Schema.NullOr(Schema.String) }),
      ),
      pagination: Schema.Struct({ hasMore: Schema.Boolean }),
    }),
  )(await response.json())

  expect(feed.pagination.hasMore).toBe(false)
  const seeds = new Set(['e2e-archive-one', 'e2e-archive-two', 'e2e-music-thread'])

  for (const post of feed.data)
    if (post.parentPostId === null && !seeds.has(post.slug))
      expect((await api.post(`/api/content/posts/micro/${post.slug}/seen`)).ok()).toBe(true)

  await page.goto('/tweet/e2e-archive-two')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  const first = await openReader(page)
  await expect(
    first.getByRole('link', { name: 'Next unread (older)', exact: true }),
  ).toHaveAttribute('href', '/tweet/e2e-archive-one')
  await first.getByRole('link', { name: 'Next unread (older)', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  const second = await openReader(page)
  await expect(
    second.getByRole('link', { name: 'Next unread (newer)', exact: true }),
  ).toHaveAttribute('href', '/tweet/e2e-music-thread')
  await second.getByRole('link', { name: 'Next unread (newer)', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-music-thread$/)
  const last = await openReader(page)
  await expect(last.getByText('Caught up', { exact: true })).toBeVisible()
  await expect(last.getByRole('button', { name: 'Surprise me', exact: true })).toBeDisabled()
})

test('starting over resets reading history and opens the latest tweet', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-two')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  const reader = await openReader(page)
  await reader.getByText('Reset reading history…', { exact: true }).click()
  await reader.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/(?!latest)[^?]+$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(
    (await openReader(page)).getByRole('link', { name: 'Next unread (older)', exact: true }),
  ).toBeVisible()
})

test('network failure during resume preserves the checkpoint', async ({ page }) => {
  await page.goto('/tweet/e2e-archive-one')
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint')))
    .toBe('e2e-archive-one')
  await page.route('**/tweet/e2e-archive-one?__data=1', (route) => route.abort())
  await page.goto('/tweets')
  await expect(
    page.getByText('This page could not be loaded. Please try again.', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint'))).toBe(
    'e2e-archive-one',
  )
})

test('seen write failures are visible and retryable', async ({ page }) => {
  await page.route('**/api/content/posts/micro/*/seen', (route) =>
    route.fulfill({ status: 500, body: '{}' }),
  )
  await page.goto('/tweet/e2e-archive-one')
  await expect(
    page.getByRole('button', { name: 'Retry saving history', exact: true }),
  ).toBeVisible()
  await page.unroute('**/api/content/posts/micro/*/seen')
  await page.getByRole('button', { name: 'Retry saving history', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry saving history', exact: true })).toHaveCount(
    0,
  )
  await expect(
    (await openReader(page)).getByRole('link', { name: 'Next unread (newer)', exact: true }),
  ).toBeVisible()
})

test('random immediate click records the submitted tweet before leaving', async ({
  page,
  request,
}) => {
  await page.route('**/api/content/posts/micro/e2e-archive-one/seen', (route) => route.abort())
  await page.goto('/tweet/e2e-archive-one')
  await (await openReader(page)).getByRole('button', { name: 'Surprise me', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/(?!e2e-archive-one)[^?]+$/)
  const cookies = await page.context().cookies()

  const response = await request.get('/api/content/posts/micro/e2e-archive-one/neighbours', {
    headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') },
  })

  expect((await response.json()).seen).toBe(true)
})

test('Tweets entry without JavaScript still opens latest', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/tweets')
  await expect(page).toHaveURL(/\/tweet\/(?!latest)[^?]+$/)
  await expect(
    (await openReader(page)).getByRole('link', { name: 'Latest', exact: true }),
  ).toBeVisible()
  await context.close()
})

test('a modified Latest click opens a separate tab without changing the current visit', async ({
  page,
  context,
}) => {
  await page.goto('/tweet/e2e-archive-one')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()

  const [other] = await Promise.all([
    context.waitForEvent('page'),
    (await openReader(page))
      .getByRole('link', { name: 'Latest', exact: true })
      .click({ modifiers: ['ControlOrMeta'] }),
  ])

  await other.waitForURL(/\/tweet\/(?!latest|e2e-archive-one)[^?]+$/)
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-one$/)
  expect(await page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint'))).toBe(
    'e2e-archive-one',
  )
  await other.close()
})

test('late prefetched and loaded tweet responses cannot change a superseding page or checkpoint', async ({
  page,
}) => {
  let release = () => {}

  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  await page.route('**/tweet/e2e-archive-two?__data=1', async (route) => {
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  await page.goto('/tweet/e2e-archive-one')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeEnabled()
  await (await openReader(page)).getByRole('link', { name: 'Newer tweet', exact: true }).click()
  await expect(page).toHaveURL(/\/tweet\/e2e-archive-two$/)
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Menu', exact: true })
    .getByRole('link', { name: 'About', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible()

  const late = page.waitForResponse((response) =>
    response.url().includes('/tweet/e2e-archive-two?__data=1'),
  )

  release()
  await late
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('gbfm:tweet-checkpoint'))).toBe(
    'e2e-archive-one',
  )
})
