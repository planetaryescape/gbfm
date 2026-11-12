// Tests are runtime entry points that intentionally supply their complete test layers.
/* oxlint-disable effecttsgo/strict-effect-provide */
import { Effect, Fiber, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { TestClock } from 'effect/testing'
import { describe, expect, test } from 'vitest'

import { MusicProviderInvalidInput } from '../errors'
import {
  ListeningImportError,
  parseListeningSource,
  previewListeningImport,
} from './listening-import'
import { SpotifyService, type SpotifyImportPlaylist } from './spotify.service'

const playlist = 'https://www.mixcloud.com/spartacus/playlists/jazz/'

const mix = (index: number) => ({
  url: `https://www.mixcloud.com/dj/mix-${index}/`,
  name: `Mix ${index}`,
})

const page = (offset = 0) => Array.from({ length: 100 }, (_, index) => mix(index + offset))

type TestFetch = (...args: Parameters<typeof globalThis.fetch>) => Promise<Response>

const noSpotify = Layer.mock(SpotifyService, {})

const preview = (fetch: TestFetch, url = playlist, spotify = noSpotify) =>
  Effect.runPromise(
    previewListeningImport(url).pipe(
      Effect.provideService(FetchHttpClient.Fetch, Object.assign(fetch, { preconnect() {} })),
      Effect.provide(spotify),
    ),
  )

const rejectFetch: TestFetch = () => Promise.reject(new Error('No network expected'))

describe('parseListeningSource', () => {
  test.each([
    [
      'https://youtu.be/dQw4w9WgXcQ?si=tracking',
      'youtube',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'youtube',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://open.spotify.com/episode/4iV5W9uYEdYUVa79Axb7Rh?si=tracking',
      'spotify',
      'https://open.spotify.com/episode/4iV5W9uYEdYUVa79Axb7Rh',
      'https://open.spotify.com/embed/episode/4iV5W9uYEdYUVa79Axb7Rh',
    ],
    [
      'https://soundcloud.com/dj/summer-mix?utm_source=share',
      'soundcloud',
      'https://soundcloud.com/dj/summer-mix',
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fdj%2Fsummer-mix',
    ],
    [
      'https://mixcloud.com/dj/summer-mix/#tracking',
      'mixcloud',
      'https://www.mixcloud.com/dj/summer-mix/',
      'https://www.mixcloud.com/widget/iframe/?feed=%2Fdj%2Fsummer-mix%2F',
    ],
  ])('canonicalizes %s and constructs a trusted embed', async (input, platform, url, embedUrl) => {
    const source = await Effect.runPromise(parseListeningSource(input))
    expect(source).toEqual({ platform, url, embedUrl })
    expect(await Effect.runPromise(parseListeningSource(source.url))).toEqual(source)
  })

  test.each([
    'not a URL',
    'http://soundcloud.com/dj/mix',
    'https://localhost/dj/mix',
    'https://soundcloud.com.evil.test/dj/mix',
    'https://evil.soundcloud.com/dj/mix',
    'https://user:password@soundcloud.com/dj/mix',
    'https://soundcloud.com:444/dj/mix',
    'https://soundcloud.com/dj/../mix',
    'https://soundcloud.com/dj/%6dix',
    'https://soundcloud.com/dj/mix/extra',
    'https://soundcloud.com/dj/likes',
    'https://soundcloud.com/discover/sets',
    'https://soundcloud.com/dj/mix?secret_token=secret',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/search?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa',
    'https://open.spotify.com/album/4iV5W9uYEdYUVa79Axb7Rh',
    'https://open.spotify.com/track/short',
    'https://www.mixcloud.com/widget/iframe/',
    'https://soundcloud.com/dj/sets/summer',
    playlist,
    'https://open.spotify.com/playlist/4iV5W9uYEdYUVa79Axb7Rh',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890',
  ])('rejects unsafe, unsupported or collection input %s', async (input) => {
    const result = await Effect.runPromise(parseListeningSource(input).pipe(Effect.result))
    expect(result).toHaveProperty('failure', expect.any(ListeningImportError))
  })
})

describe('previewListeningImport', () => {
  test('single mixes do not require network and disclose the title fallback', async () => {
    const result = await preview(rejectFetch, 'https://youtu.be/dQw4w9WgXcQ')
    expect(result.items).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    ])
    expect(result.warnings.join(' ')).toContain('Title metadata was not fetched')
  })

  test.each(['https://soundcloud.com/dj/sets/summer'])(
    'explicitly fails unsupported playlist snapshots: %s',
    async (url) => {
      await expect(preview(rejectFetch, url)).rejects.toThrow('playlist snapshots are unsupported')
    },
  )

  test('imports public Mixcloud pages, canonicalizes items and never follows next URLs', async () => {
    const requests: Array<string> = []

    const fetch: TestFetch = async (input, init) => {
      requests.push(input instanceof Request ? input.url : input.toString())
      expect(init?.redirect).toBe('error')
      expect(init?.credentials).toBe('omit')
      expect(init?.signal).toBeInstanceOf(AbortSignal)

      return Response.json(
        requests.length === 1
          ? { data: page(), paging: { next: 'https://evil.test/steal' } }
          : { data: [mix(99), mix(100)], paging: {} },
      )
    }

    const result = await preview(fetch)
    expect(result.items).toHaveLength(101)
    expect(result.items[100]).toEqual({ url: mix(100).url, title: 'Mix 100' })
    expect(requests).toEqual([
      'https://api.mixcloud.com/spartacus/playlists/jazz/cloudcasts/?limit=100&offset=0',
      'https://api.mixcloud.com/spartacus/playlists/jazz/cloudcasts/?limit=100&offset=100',
    ])
    expect(result.warnings).toHaveLength(1)
  })

  test('reports skipped invalid items without importing arbitrary URLs or playlists', async () => {
    const result = await preview(async () =>
      Response.json({
        data: [
          mix(0),
          { url: 'https://evil.test/a', name: 'Bad' },
          { url: playlist, name: 'Collection' },
          { url: mix(1).url, name: ' ' },
        ],
      }),
    )

    expect(result.items).toEqual([{ url: mix(0).url, title: mix(0).name }])
    expect(result.warnings.filter((warning) => warning.includes('Partial import'))).toHaveLength(3)
  })

  test('bounds snapshots to two pages / 200 items with an explicit warning', async () => {
    let count = 0

    const result = await preview(async () =>
      Response.json({ data: page(count++ * 100), paging: { next: 'more' } }),
    )

    expect(count).toBe(2)
    expect(result.items).toHaveLength(200)
    expect(result.warnings.join(' ')).toContain('200-item limit')
  })

  test('keeps a truthful partial snapshot when a later page fails', async () => {
    let count = 0

    const result = await preview(async () =>
      ++count === 1
        ? Response.json({ data: page(), paging: { next: 'more' } })
        : new Response(null, { status: 503 }),
    )

    expect(result.items).toHaveLength(100)
    expect(result.warnings.join(' ')).toContain('a later Mixcloud page failed')
  })

  test.each([401, 404, 429, 500, 302])('fails an initial HTTP %s response', async (status) => {
    await expect(preview(async () => new Response(null, { status }))).rejects.toThrow(
      'Provider playlist request failed',
    )
  })

  test.each([
    { error: 'private' },
    { data: [{ url: mix(0).url }] },
    { data: [], paging: { next: 5 } },
  ])('fails malformed provider data', async (body) => {
    await expect(preview(async () => Response.json(body))).rejects.toThrow('invalid data')
  })

  test('fails transport errors', async () => {
    await expect(preview(rejectFetch)).rejects.toThrow('Provider playlist request failed')
  })

  test('times out and aborts slow provider requests', async () => {
    let signal: AbortSignal | null | undefined

    const fetch: TestFetch = (_input, init) => {
      signal = init?.signal

      return new Promise(() => {})
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* previewListeningImport(playlist).pipe(
          Effect.provideService(FetchHttpClient.Fetch, Object.assign(fetch, { preconnect() {} })),
          Effect.provide(noSpotify),
          Effect.result,
          Effect.forkChild,
        )

        yield* TestClock.adjust('5 seconds')

        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer())),
    )

    expect(result).toHaveProperty('failure.message', expect.stringContaining('timed out'))
    expect(signal?.aborted).toBe(true)
  })

  test('bounds response bodies', async () => {
    await expect(
      preview(async () => new Response(' '.repeat(2 * 1024 * 1024 + 1))),
    ).rejects.toThrow('Provider playlist request failed')
  })

  test('accepts empty public playlists', async () => {
    expect((await preview(async () => Response.json({ data: [] }))).items).toEqual([])
  })

  test('reports inconsistent pagination rather than guessing completeness', async () => {
    const result = await preview(async () =>
      Response.json({ data: [mix(0)], paging: { next: 'more' } }),
    )

    expect(result.items).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('inconsistent Mixcloud pagination')
  })

  test('rejects oversized provider pages', async () => {
    await expect(
      preview(async () => Response.json({ data: [...page(), mix(100)] })),
    ).rejects.toThrow('page size')
  })

  test('imports the bounded YouTube public feed with an explicit partial warning', async () => {
    const entries = Array.from(
      { length: 20 },
      (_, index) =>
        `<entry><yt:videoId>${String(index).padStart(11, 'a')}</yt:videoId><title>  A &amp; B ${'x'.repeat(350)}  </title></entry>`,
    ).join('')

    const result = await preview(async (input, init) => {
      expect(input instanceof Request ? input.url : input.toString()).toBe(
        'https://www.youtube.com/feeds/videos.xml?playlist_id=PL1234567890',
      )
      expect(init?.redirect).toBe('error')

      return new Response(
        `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entries}</feed>`,
      )
    }, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890')

    expect(result.items).toHaveLength(15)
    expect(result.items[0]?.title).toHaveLength(300)
    expect(result.items[0]?.title).toMatch(/^A & B/)
    expect(result.warnings.join(' ')).toContain('not the full playlist')
  })

  test.each([
    '<html>Error</html>',
    '<feed/>',
    '<feed>Provider error</feed>',
    '<feed><entry></feed>',
    '<!DOCTYPE feed [<!ENTITY x "bad">]><feed/>',
    '<!DOCTYPE feed SYSTEM "https://example.test/external.dtd"><feed/>',
    '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId></entry></feed>',
    '<feed><entry><title>Missing ID</title></entry></feed>',
    '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><yt:videoId>aaaaaaaaaaa</yt:videoId><title>Duplicate ID</title></entry></feed>',
    '<feed><entry><yt:videoId><id>dQw4w9WgXcQ</id></yt:videoId><title>Nested ID</title></entry></feed>',
    '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>  </title></entry></feed>',
    '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>A</title><title>B</title></entry></feed>',
    '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title><b>Nested</b></title></entry></feed>',
    '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>&unknown;</title></entry></feed>',
    '<feed/><feed/>',
    '<feed/>trailing text',
    '<feed key="a" key="b"/>',
    '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"/>',
  ])('rejects invalid YouTube XML', async (xml) => {
    await expect(
      preview(async () => new Response(xml), 'https://www.youtube.com/playlist?list=PL1234567890'),
    ).rejects.toThrow('invalid public playlist feed')
  })

  test('preserves namespaced IDs, CDATA, Unicode and escaped title text', async () => {
    const result = await preview(
      async () =>
        new Response(
          '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n' +
            '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">' +
            '<!-- ignored --><entry><yt:videoId> dQw4w9WgXcQ </yt:videoId>' +
            '<title><![CDATA[A <B>]]> &amp; &#x1F3B5;</title></entry></feed>',
        ),
      'https://www.youtube.com/playlist?list=PL1234567890',
    )

    expect(result.items).toEqual([
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A <B> & 🎵' },
    ])
  })

  test('validates the complete feed even after the fifteen-item preview limit', async () => {
    const entries = '<entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>Good</title></entry>'.repeat(
      15,
    )

    await expect(
      preview(
        async () => new Response(`<feed>${entries}<entry></feed>`),
        'https://www.youtube.com/playlist?list=PL1234567890',
      ),
    ).rejects.toThrow('invalid public playlist feed')
  })

  test('validates entry fields beyond the fifteen-item preview limit', async () => {
    const entries = '<entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>Good</title></entry>'.repeat(
      15,
    )

    await expect(
      preview(
        async () => new Response(`<feed>${entries}<entry><title>Missing ID</title></entry></feed>`),
        'https://www.youtube.com/playlist?list=PL1234567890',
      ),
    ).rejects.toThrow('invalid public playlist feed')
  })

  test('skips invalid YouTube IDs, deduplicates and handles an empty feed', async () => {
    const result = await preview(
      async () =>
        new Response(
          '<feed><entry><yt:videoId>short</yt:videoId><title>Bad</title></entry><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>Good</title></entry><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>Duplicate</title></entry></feed>',
        ),
      'https://www.youtube.com/playlist?list=PL1234567890',
    )

    expect(result.items).toEqual([
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Good' },
    ])
    expect(result.warnings.join(' ')).toContain('invalid YouTube feed item')
    expect(
      (
        await preview(
          async () => new Response('<feed><title>Empty</title></feed>'),
          'https://www.youtube.com/playlist?list=PL1234567890',
        )
      ).items,
    ).toEqual([])
  })

  test('reuses the configured Spotify import service, bounding and disclosing its first page', async () => {
    const spotify = Layer.mock(SpotifyService, {
      getPlaylistForImport: (id) => {
        expect(id).toBe('4iV5W9uYEdYUVa79Axb7Rh')

        const data: SpotifyImportPlaylist = {
          spotifyPlaylistId: id,
          title: 'Playlist',
          description: null,
          coverImageUrl: null,
          ownerName: null,
          playlistUrl: `https://open.spotify.com/playlist/${id}`,
          tracks: Array.from({ length: 110 }, (_, index) => ({
            spotifyTrackId: String(index).padStart(22, 'a'),
            title: `  ${'x'.repeat(350)}  `,
            artistNames: [],
            artistSpotifyIds: [],
            albumName: null,
            albumSpotifyId: null,
            albumImageUrl: null,
            trackUrl: `https://open.spotify.com/track/${String(index).padStart(22, 'a')}`,
            previewUrl: null,
            durationMs: null,
            trackNumber: null,
          })),
        }

        return Effect.succeed(data)
      },
    })

    const result = await preview(
      rejectFetch,
      'https://open.spotify.com/playlist/4iV5W9uYEdYUVa79Axb7Rh',
      spotify,
    )

    expect(result.items).toHaveLength(100)
    expect(result.items[0]?.title).toHaveLength(300)
    expect(result.warnings.join(' ')).toContain('only the first API page')
  })

  test('maps Spotify provider failures to ListeningImportError', async () => {
    const spotify = Layer.mock(SpotifyService, {
      getPlaylistForImport: () =>
        Effect.fail(
          new MusicProviderInvalidInput({ message: 'fake provider failure', operation: 'test' }),
        ),
    })

    await expect(
      preview(rejectFetch, 'https://open.spotify.com/playlist/4iV5W9uYEdYUVa79Axb7Rh', spotify),
    ).rejects.toThrow('Spotify playlist unavailable')
  })
})
