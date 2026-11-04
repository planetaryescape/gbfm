import { expect, test, type Page } from '@playwright/test'

const connect = async (page: Page) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'spotify-effect:tokens',
      JSON.stringify({
        accessToken: 'public-fixture-token',
        refreshToken: 'public-fixture-refresh',
        accessTokenExpiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.route('https://api.spotify.com/v1/me', (route) =>
    route.fulfill({
      json: {
        id: 'fixture',
        display_name: 'Fixture Listener',
        product: 'premium',
        type: 'user',
        uri: 'spotify:user:fixture',
        href: 'https://api.spotify.com/v1/users/fixture',
        external_urls: { spotify: 'https://open.spotify.com/user/fixture' },
        images: [],
        followers: { total: 0, href: null },
      },
    }),
  )
}

const device = {
  id: 'fixture-device',
  is_active: true,
  is_private_session: false,
  is_restricted: false,
  name: 'Fixture speaker',
  type: 'Computer',
  volume_percent: 50,
}

test('a Spotify music card offers connection separately from its external link', async ({
  page,
}) => {
  const response = await page.goto('/tweet/e2e-music-thread')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Spotify', exact: true })).toHaveAttribute(
    'target',
    '_blank',
  )
  await expect(page.getByRole('button', { name: 'Play on Spotify', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Bandcamp', exact: true })).toBeVisible()
  await page.route('https://accounts.spotify.com/authorize?**', (route) =>
    route.fulfill({ body: 'Public OAuth fixture' }),
  )
  await page.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
  await expect(page).toHaveURL(/accounts.spotify.com\/authorize/)
  await page.goto('/tweet/e2e-music-thread')
  expect(await page.evaluate(() => sessionStorage.getItem('gbfm:spotify-return-path'))).toBe(
    '/tweet/e2e-music-thread',
  )
})

for (const kind of ['track', 'album', 'playlist'] as const) {
  test(`${kind} plays and queues in Spotify without navigating or touching the mix player`, async ({
    page,
  }) => {
    await connect(page)
    const plays: Array<unknown> = []
    const queued: Array<string> = []
    const offsets: Array<number> = []

    const tracks = Array.from({ length: 51 }, (_, i) => ({
      uri: `spotify:track:Fixture${i}`,
      id: `Fixture${i}`,
      name: `Fixture ${i}`,
      artists: [],
      available_markets: [],
      disc_number: 1,
      duration_ms: 180000,
      explicit: false,
      external_urls: { spotify: `https://open.spotify.com/track/Fixture${i}` },
      href: `https://api.spotify.com/v1/tracks/Fixture${i}`,
      preview_url: null,
      track_number: i + 1,
      type: 'track',
      is_local: false,
    }))

    await page.route('https://api.spotify.com/v1/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())

      if (url.pathname === '/v1/me') return route.fallback()

      if (url.pathname === '/v1/me/player/devices')
        return route.fulfill({ json: { devices: [device] } })

      if (url.pathname === '/v1/me/player/play') {
        plays.push(request.postDataJSON())

        return route.fulfill({ status: 204 })
      }

      if (url.pathname === '/v1/me/player/queue') {
        queued.push(url.searchParams.get('uri') ?? '')

        return route.fulfill({ status: 204 })
      }

      if (
        url.pathname === `/v1/${kind === 'album' ? 'albums' : 'playlists'}/E2ECollection/tracks`
      ) {
        const offset = Number(url.searchParams.get('offset') ?? 0)
        offsets.push(offset)
        const items = tracks.slice(offset, offset + 50)

        return route.fulfill({
          json: {
            items:
              kind === 'album'
                ? items
                : items.map((track) => ({
                    track,
                    added_at: null,
                    added_by: null,
                    is_local: false,
                  })),
            href: url.href,
            previous: null,
            next: offset === 0 ? `${url.origin}${url.pathname}?offset=50` : null,
            offset,
            limit: 50,
            total: 51,
          },
        })
      }

      throw new Error(`Unexpected Spotify request: ${request.method()} ${url.pathname}`)
    })
    const path = kind === 'track' ? '/tweet/e2e-music-thread' : `/tweet/e2e-spotify-${kind}`
    await page.goto(path)
    await page.getByRole('button', { name: 'Play on Spotify', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Playing on your active Spotify device.' }),
    ).toBeVisible()
    expect(plays).toEqual([
      kind === 'track'
        ? { uris: ['spotify:track:E2ERootTrack'] }
        : { context_uri: `spotify:${kind}:E2ECollection` },
    ])
    await page.getByRole('button', { name: 'Queue on Spotify', exact: true }).click()
    await expect(
      page.getByRole('status').filter({
        hasText: `Added ${kind === 'track' ? '1 track' : '51 tracks'} to your Spotify queue.`,
      }),
    ).toBeVisible()
    expect(queued).toEqual(
      kind === 'track' ? ['spotify:track:E2ERootTrack'] : tracks.map((track) => track.uri),
    )
    expect(offsets).toEqual(kind === 'track' ? [] : [0, 50])
    await expect(page).toHaveURL(path)
    expect(
      await page
        .locator('audio')
        .evaluateAll((elements) => elements.every((audio) => !audio.getAttribute('src'))),
    ).toBe(true)
    expect(page.context().pages()).toHaveLength(1)
  })
}

test('missing, inactive, restricted, and disappearing devices give explicit feedback and allow retry', async ({
  page,
}) => {
  await connect(page)
  let devices: Array<typeof device> = []
  let writes = 0
  await page.route('https://api.spotify.com/v1/me/player/**', async (route) => {
    if (route.request().url().endsWith('/devices')) return route.fulfill({ json: { devices } })
    writes += 1

    return route.fulfill({
      status: 404,
      json: {
        error: { status: 404, message: 'No active device found', reason: 'NO_ACTIVE_DEVICE' },
      },
    })
  })
  await page.goto('/tweet/e2e-spotify-album')

  for (const candidates of [
    [],
    [{ ...device, is_active: false }],
    [{ ...device, is_restricted: true }],
  ]) {
    devices = candidates
    await Promise.all([
      page.waitForResponse('https://api.spotify.com/v1/me/player/devices'),
      page.getByRole('button', { name: 'Queue on Spotify', exact: true }).click(),
    ])
    await expect(
      page.getByRole('status').filter({ hasText: 'No active Spotify device. Open Spotify' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Queue on Spotify', exact: true })).toBeEnabled()
  }

  expect(writes).toBe(0)
  devices = [device]
  await page.getByRole('button', { name: 'Play on Spotify', exact: true }).click()
  await expect.poll(() => writes).toBe(1)
  await expect(
    page.getByRole('status').filter({ hasText: 'No active Spotify device. Open Spotify' }),
  ).toBeVisible()
  await expect(page).toHaveURL('/tweet/e2e-spotify-album')
})

test('Spotify rejects playback without a silent external fallback', async ({ page }) => {
  await connect(page)
  await page.route('https://api.spotify.com/v1/me/player/**', (route) =>
    route.request().url().endsWith('/devices')
      ? route.fulfill({ json: { devices: [device] } })
      : route.fulfill({
          status: 403,
          json: { error: { status: 403, message: 'Premium required' } },
        }),
  )
  await page.goto('/tweet/e2e-spotify-album')
  await page.getByRole('button', { name: 'Play on Spotify', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Check your Premium account and device' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play on Spotify', exact: true })).toBeEnabled()
  await expect(page).toHaveURL('/tweet/e2e-spotify-album')
})
