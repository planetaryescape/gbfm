import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'

declare global {
  interface Window {
    gbfmPrivatePlaybackFixture?: {
      readonly instances: Array<HTMLAudioElement>
      readonly registrations: () => number
      readonly releases: () => number
    }
  }
}

const privateAudio = 'https://cdn.fixture.test/user-content/private/fixture-a/audio/song.wav'

const privateArtwork = 'https://cdn.fixture.test/user-content/private/fixture-a/artwork/cover.png'

const privateTitle = 'Disposable A private playback'

const publicTitle = 'Disposable public playback'

const PreviewRequest = Schema.Struct({ url: Schema.Literals([privateAudio, privateArtwork]) })

const wave = () => {
  const samples = 8000 * 120
  const audio = Buffer.alloc(44 + samples, 128)
  audio.write('RIFF', 0)
  audio.writeUInt32LE(36 + samples, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24)
  audio.writeUInt32LE(8000, 28)
  audio.writeUInt16LE(1, 32)
  audio.writeUInt16LE(8, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(samples, 40)

  return audio
}

const authenticate = async (page: Page, origin: string, email: string) => {
  const response = await page.request.post('/auth/sign-in/email', {
    headers: { origin },
    data: { email, password: 'LocalTest123!' },
  })

  expect(response.ok(), `Disposable fixture login returned ${response.status()}`).toBe(true)
}

const setup = async (page: Page, origin: string, email: string) => {
  const gate = Promise.withResolvers<boolean>()
  const grants: Array<string> = []
  const bytes = wave()

  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,range',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  }

  await page.route('**/api/upload/preview', async (route) => {
    const body = Schema.decodeUnknownSync(PreviewRequest)(route.request().postDataJSON())
    grants.push(body.url)
    const allowed = await gate.promise

    if (!allowed) return route.fulfill({ status: 403, body: 'Disposable preview denied' })

    return route.fulfill({
      json: {
        sessionUrl: 'https://cdn.fixture.test/preview-session',
        grant: 'disposable-preview-grant',
        expiresAt: Date.now() + 600_000,
      },
    })
  })
  await page.route('https://cdn.fixture.test/**', async (route) => {
    const request = route.request()

    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })

    if (request.url() === 'https://cdn.fixture.test/preview-session')
      return route.fulfill({ status: 204, headers: cors })

    if (request.url() === privateArtwork)
      return route.fulfill({
        headers: cors,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=',
          'base64',
        ),
      })

    if (request.url() !== privateAudio) throw new Error('Unexpected fixture media URL')

    return route.fulfill({ headers: cors, contentType: 'audio/wav', body: bytes })
  })
  await page.route('**/api/e2e-audio.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: bytes }),
  )
  await authenticate(page, origin, email)
  await page.addInitScript(
    ({ privateAudio, privateArtwork, privateTitle, publicTitle }) => {
      const instances: Array<HTMLAudioElement> = []
      let registrations = 0
      let releases = 0
      window.Audio = new Proxy(window.Audio, {
        construct(target, args, newTarget) {
          const audio = Reflect.construct(target, args, newTarget)

          if (audio instanceof HTMLAudioElement) instances.push(audio)

          return audio
        },
      })
      const media = navigator.mediaSession
      const setActionHandler = media.setActionHandler.bind(media)
      media.setActionHandler = (action, handler) => {
        if (action === 'play') {
          if (handler) registrations++
          else releases++
        }

        setActionHandler(action, handler)
      }

      window.gbfmPrivatePlaybackFixture = {
        instances,
        registrations: () => registrations,
        releases: () => releases,
      }
      localStorage.setItem(
        'gbfm-audio-queue.json',
        JSON.stringify({
          currentIndex: 0,
          tracks: [
            {
              id: 'disposable-private',
              slug: 'disposable-private',
              title: privateTitle,
              url: privateAudio,
              thumbnailUrl: privateArtwork,
              type: 'mix',
            },
            {
              id: 'disposable-public',
              slug: 'disposable-public',
              title: publicTitle,
              url: '/api/e2e-audio.wav',
              thumbnailUrl: null,
              type: 'mix',
            },
          ],
        }),
      )
    },
    { privateAudio, privateArtwork, privateTitle, publicTitle },
  )

  return { grants, release: (allowed: boolean) => gate.resolve(allowed) }
}

const inspect = (page: Page) =>
  page.evaluate(() => {
    const fixture = window.gbfmPrivatePlaybackFixture

    if (!fixture) throw new Error('Missing private playback instrumentation')

    return {
      registrations: fixture.registrations(),
      releases: fixture.releases(),
      metadata: navigator.mediaSession.metadata?.title ?? null,
      instances: fixture.instances.map((audio) => ({
        src: audio.getAttribute('src'),
        playing: !audio.paused,
        position: audio.currentTime,
        volume: audio.volume,
        muted: audio.muted,
      })),
    }
  })

test('private playback survives uncertain same-A navigation but releases source and metadata on confirmed B', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Missing disposable WWW origin')
  const origin = new URL(baseURL).origin
  const fixture = await setup(page, origin, 'creator@gbfm.local')
  let releaseNavigation = () => undefined

  try {
    await page.goto('/about')
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
    await expect.poll(() => fixture.grants.includes(privateAudio)).toBe(true)
    await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0)
    expect((await inspect(page)).instances.every((audio) => audio.src === null)).toBe(true)
    fixture.release(true)

    const mini = page
      .locator('.station-navigation')
      .getByRole('region', { name: 'Mini player', exact: true })

    await expect(mini).toContainText(privateTitle)
    await mini.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(async () => (await inspect(page)).instances[0]?.position ?? 0)
      .toBeGreaterThan(0.2)
    const before = await inspect(page)
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    await page
      .locator('.site')
      .evaluate((root) => root.setAttribute('data-private-lifetime', 'same-root'))
    const navigation = Promise.withResolvers<void>()
    releaseNavigation = () => {
      navigation.resolve()

      return undefined
    }

    await page.route(/\/privacy\?[^#]*__data=/, async (route) => {
      await navigation.promise
      await route.continue()
    })

    const requested = page.waitForRequest((request) => {
      const url = new URL(request.url())

      return url.pathname === '/privacy' && url.searchParams.has('__data')
    })

    await page.getByRole('link', { name: 'Privacy policy', exact: true }).click()
    await requested
    await expect
      .poll(async () => (await inspect(page)).instances[0]?.position ?? 0)
      .toBeGreaterThan((before.instances[0]?.position ?? 0) + 0.2)
    expect((await inspect(page)).instances[0]).toMatchObject({ src: privateAudio, playing: true })
    await expect(mini).toContainText(privateTitle)
    navigation.resolve()
    await expect(page).toHaveURL('/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
    await authenticate(page, origin, 'listener@gbfm.local')
    await page
      .getByRole('navigation', { name: 'Primary', exact: true })
      .getByRole('link', { name: 'Home', exact: true })
      .click()
    await expect(page).toHaveURL('/')
    await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0)
    await expect(mini).toContainText(publicTitle)
    await expect(
      page.locator(`img[data-private-media-src="${privateArtwork}"],img[src="${privateArtwork}"]`),
    ).toHaveCount(0)
    const after = await inspect(page)
    expect(after.instances[0]).toMatchObject({ src: null, playing: false })
    expect(after.metadata).not.toBe(privateTitle)
    expect(after.registrations).toBe(1)
    expect(after.releases).toBe(0)
    expect(after.instances[1]?.volume).toBe(before.instances[0]?.volume)
    expect(after.instances[1]?.muted).toBe(before.instances[0]?.muted)
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    await expect(page.locator('.site')).toHaveAttribute('data-private-lifetime', 'same-root')
  } finally {
    releaseNavigation()
    fixture.release(false)
  }
})

test('restored A private queue under B stays undisclosed before and after a denied fresh grant', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Missing disposable WWW origin')
  const fixture = await setup(page, new URL(baseURL).origin, 'listener@gbfm.local')

  try {
    await page.goto('/about')
    await expect(page.locator('html')).toHaveAttribute('data-gbfm-hydrated', 'true')
    await expect.poll(() => fixture.grants.includes(privateAudio)).toBe(true)
    await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0)
    await expect(
      page.locator(`img[data-private-media-src="${privateArtwork}"],img[src="${privateArtwork}"]`),
    ).toHaveCount(0)
    expect((await inspect(page)).metadata).not.toBe(privateTitle)
    expect(
      (await inspect(page)).instances.every((audio) => audio.src === null && !audio.playing),
    ).toBe(true)

    const denied = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/upload/preview',
    )

    fixture.release(false)
    expect((await denied).status()).toBe(403)
    await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0)
    expect((await inspect(page)).metadata).not.toBe(privateTitle)
    expect(
      (await inspect(page)).instances.every((audio) => audio.src === null && !audio.playing),
    ).toBe(true)
    expect((await inspect(page)).registrations).toBe(1)
  } finally {
    fixture.release(false)
  }
})
