import { Effect, Result, Schema, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { SpotifyService } from './spotify.service'
import { parseYoutubeFeed } from './youtube-feed'

// Effect 4.0.6 names the schema-backed tagged error constructor TaggedError.
export class ListeningImportError extends Schema.TaggedError<ListeningImportError>()(
  'ListeningImportError',
  { message: Schema.String },
) {}

const ListeningSource = Schema.Struct({
  url: Schema.String,
  platform: Schema.Literals(['youtube', 'spotify', 'soundcloud', 'mixcloud']),
  embedUrl: Schema.NullOr(Schema.String),
})

const ListeningPreview = Schema.Struct({
  items: Schema.Array(Schema.Struct({ url: Schema.String, title: Schema.NonEmptyString })),
  warnings: Schema.Array(Schema.String),
})

const MixcloudPage = Schema.Struct({
  data: Schema.Array(Schema.Struct({ url: Schema.String, name: Schema.NonEmptyString })),
  paging: Schema.optionalKey(
    Schema.Struct({ next: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
  ),
})

const SpotifyImportPage = Schema.Struct({
  tracks: Schema.Array(Schema.Struct({ trackUrl: Schema.String, title: Schema.NonEmptyString })),
})

const fail = (message: string) => Effect.fail(new ListeningImportError({ message }))

const invalid = () => fail('Use a supported HTTPS mix URL or public playlist URL.')

const slug = /^[a-zA-Z0-9_-]{1,200}$/

const reserved = new Set([
  'discover',
  'search',
  'upload',
  'you',
  'settings',
  'stream',
  'charts',
  'genres',
  'tags',
  'favorites',
  'likes',
  'reposts',
  'tracks',
  'albums',
  'sets',
  'playlists',
  'cloudcasts',
  'listens',
  'followers',
  'following',
  'live',
  'premium',
  'pro',
  'widget',
  'developers',
  'about',
  'terms',
  'privacy',
  'login',
  'signup',
])

// This parser deliberately does not resolve short links or accept provider widgets as input.
const parseInput = Effect.fn('ListeningImport.parseInput')(function* (input: string) {
  const text = yield* Schema.decodeUnknownEffect(Schema.String)(input).pipe(
    Effect.mapError(() => new ListeningImportError({ message: 'Expected a URL string.' })),
  )

  if (
    !/^https:\/\//i.test(text) ||
    text.length > 2048 ||
    /[\\\s]|%|\/\.{1,2}(?:\/|\?|#|$)/.test(text)
  )
    return yield* invalid()

  const url = yield* Schema.decodeUnknownEffect(Schema.URLFromString)(text).pipe(
    Effect.mapError(() => new ListeningImportError({ message: 'Invalid URL.' })),
  )

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.searchParams.has('secret_token')
  )
    return yield* invalid()
  const path = url.pathname.replace(/\/$/, '')
  const parts = path.slice(1).split('/')
  const host = url.hostname

  if (
    ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(
      host,
    )
  ) {
    const list = url.searchParams.get('list')

    if (list !== null || path === '/playlist') {
      if (!list || !/^[a-zA-Z0-9_-]{10,100}$/.test(list)) return yield* invalid()

      if (host === 'youtu.be' || !['/watch', '/playlist'].includes(path)) return yield* invalid()

      return {
        kind: 'playlist' as const,
        platform: 'youtube' as const,
        url: `https://www.youtube.com/playlist?list=${list}`,
        embedUrl: null,
      }
    }

    const id =
      host === 'youtu.be' && parts.length === 1
        ? parts[0]
        : path === '/watch' && url.searchParams.getAll('v').length === 1
          ? url.searchParams.get('v')
          : parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0] ?? '')
            ? parts[1]
            : undefined

    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return yield* invalid()

    return {
      kind: 'mix' as const,
      platform: 'youtube' as const,
      url: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}`,
    }
  }

  if (host === 'open.spotify.com') {
    const match = /^\/(track|episode|playlist)\/([a-zA-Z0-9]{22})$/.exec(path)

    if (!match) return yield* invalid()
    const canonical = `https://open.spotify.com${path}`

    return {
      kind: match[1] === 'playlist' ? ('playlist' as const) : ('mix' as const),
      platform: 'spotify' as const,
      url: canonical,
      embedUrl: `https://open.spotify.com/embed${path}`,
    }
  }

  if (['soundcloud.com', 'www.soundcloud.com', 'mixcloud.com', 'www.mixcloud.com'].includes(host)) {
    const platform = host.endsWith('soundcloud.com')
      ? ('soundcloud' as const)
      : ('mixcloud' as const)

    const [user, second, third] = parts

    if (!user || reserved.has(user.toLowerCase()) || !parts.every((part) => slug.test(part)))
      return yield* invalid()

    if (
      parts.length === 3 &&
      second === (platform === 'soundcloud' ? 'sets' : 'playlists') &&
      third
    ) {
      return {
        kind: 'playlist' as const,
        platform,
        url: `https://${platform === 'mixcloud' ? 'www.' : ''}${platform}.com${path}${platform === 'mixcloud' ? '/' : ''}`,
        embedUrl: null,
      }
    }

    if (parts.length !== 2 || !second || reserved.has(second.toLowerCase())) return yield* invalid()
    const canonical = `https://${platform === 'mixcloud' ? 'www.' : ''}${platform}.com${path}${platform === 'mixcloud' ? '/' : ''}`

    return {
      kind: 'mix' as const,
      platform,
      url: canonical,
      embedUrl:
        platform === 'soundcloud'
          ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}`
          : `https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(`${path}/`)}`,
    }
  }

  return yield* invalid()
})

export const parseListeningSource = Effect.fn('parseListeningSource')(function* (
  input: string,
): Effect.fn.Return<typeof ListeningSource.Type, ListeningImportError> {
  const source = yield* parseInput(input)

  if (source.kind === 'playlist')
    return yield* fail('Playlist URLs must be imported as snapshots, not saved as one mix.')

  return yield* ListeningSource.makeEffect({
    url: source.url,
    platform: source.platform,
    embedUrl: source.embedUrl,
  }).pipe(Effect.mapError(() => new ListeningImportError({ message: 'Invalid listening source.' })))
})

// Callers construct URLs from validated provider identifiers, never arbitrary input.
const loadText = Effect.fn('ListeningImport.loadText')(
  function* (url: string) {
    // A small edge fetch adapter avoids introducing another required app layer.
    const fetch = yield* FetchHttpClient.Fetch

    // Never follow API-provided pagination URLs or HTTP redirects.
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(url, { signal, redirect: 'error', credentials: 'omit' }),
      catch: () => new ListeningImportError({ message: 'Provider request failed.' }),
    })

    if (!response.ok) {
      yield* Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve()).pipe(
        Effect.ignore,
      )

      return yield* fail(`Provider returned HTTP ${response.status}.`)
    }

    const stream = response.body

    if (!stream) return yield* fail('Provider returned no response body.')

    const decoder = new TextDecoder()

    const body = yield* Stream.fromReadableStream({
      evaluate: () => stream,
      onError: () => new ListeningImportError({ message: 'Provider response stream failed.' }),
    }).pipe(
      Stream.runFoldEffect(
        () => ({ bytes: 0, text: '' }),
        (body, chunk) =>
          body.bytes + chunk.byteLength > 2 * 1024 * 1024
            ? fail('Provider response exceeded the 2 MiB limit.')
            : Effect.succeed({
                bytes: body.bytes + chunk.byteLength,
                text: body.text + decoder.decode(chunk, { stream: true }),
              }),
      ),
    )

    return body.text + decoder.decode()
  },
  Effect.mapError(
    () =>
      new ListeningImportError({
        message: 'Provider playlist request failed or returned invalid data.',
      }),
  ),
  Effect.timeoutOrElse({
    duration: '5 seconds',
    orElse: () => fail('Provider playlist request timed out.'),
  }),
)

const loadMixcloudPage = Effect.fn('ListeningImport.loadMixcloudPage')(function* (
  path: string,
  offset: number,
) {
  const text = yield* loadText(
    `https://api.mixcloud.com${path}cloudcasts/?limit=100&offset=${offset}`,
  )

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(MixcloudPage))(text).pipe(
    Effect.mapError(() => new ListeningImportError({ message: 'Provider returned invalid data.' })),
  )
})

/** One-time snapshots only. Spotify uses the existing configured service; no new credentials. */
export const previewListeningImport = Effect.fn('previewListeningImport')(function* (
  url: string,
): Effect.fn.Return<typeof ListeningPreview.Type, ListeningImportError, SpotifyService> {
  const source = yield* parseInput(url)

  if (source.kind === 'mix') {
    return {
      items: [{ url: source.url, title: source.url.slice(0, 300) }],
      warnings: ['Title metadata was not fetched; the canonical URL is used as the title.'],
    }
  }

  if (source.platform === 'youtube') {
    const id = new URL(source.url).searchParams.get('list')
    const xml = yield* loadText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`)

    const feed = yield* parseYoutubeFeed(xml).pipe(
      Effect.mapError(
        () =>
          new ListeningImportError({
            message: 'YouTube returned an invalid public playlist feed.',
          }),
      ),
    )

    const warnings = [
      'Partial import: YouTube public RSS exposes at most 15 recent videos, not the full playlist. Order and completeness are not guaranteed; no further pages are available.',
    ]

    const items: Array<{ url: string; title: string }> = []
    const seen = new Set<string>()

    for (const entry of feed.slice(0, 15)) {
      const parsed = yield* parseListeningSource(
        `https://www.youtube.com/watch?v=${entry.videoId}`,
      ).pipe(Effect.result)

      if (Result.isFailure(parsed) || !entry.title.trim()) {
        warnings.push('Partial import: an invalid YouTube feed item was skipped.')
        continue
      }

      if (!seen.has(parsed.success.url)) {
        items.push({ url: parsed.success.url, title: entry.title.trim().slice(0, 300) })
        seen.add(parsed.success.url)
      }
    }

    return yield* ListeningPreview.makeEffect({ items, warnings }).pipe(
      Effect.mapError(() => new ListeningImportError({ message: 'Invalid YouTube preview.' })),
    )
  }

  if (source.platform === 'spotify') {
    const spotify = yield* SpotifyService

    // getPlaylist follows every page without a bound. The existing import method
    // intentionally exposes only the first API page and may cache it for one hour.
    const raw = yield* spotify
      .getPlaylistForImport(new URL(source.url).pathname.split('/')[2] ?? '')
      .pipe(
        Effect.mapError(
          () =>
            new ListeningImportError({
              message:
                'Spotify playlist unavailable; check the configured app credentials and public playlist access.',
            }),
        ),
        Effect.timeoutOrElse({
          duration: '10 seconds',
          orElse: () => fail('Spotify playlist request timed out.'),
        }),
      )

    const page = yield* Schema.decodeUnknownEffect(SpotifyImportPage)(raw).pipe(
      Effect.mapError(
        () => new ListeningImportError({ message: 'Spotify returned invalid playlist data.' }),
      ),
    )

    const warnings = [
      'Partial import: Spotify exposes only the first API page through the existing import service (up to 100 tracks); later pages, unavailable tracks and episodes are not included. Results may be cached for one hour.',
    ]

    const items: Array<{ url: string; title: string }> = []
    const seen = new Set<string>()

    for (const track of page.tracks.slice(0, 100)) {
      const parsed = yield* parseListeningSource(track.trackUrl).pipe(Effect.result)

      if (
        Result.isFailure(parsed) ||
        parsed.success.platform !== 'spotify' ||
        !track.title.trim()
      ) {
        warnings.push('Partial import: an invalid Spotify track was skipped.')
        continue
      }

      if (!seen.has(parsed.success.url)) {
        items.push({ url: parsed.success.url, title: track.title.trim().slice(0, 300) })
        seen.add(parsed.success.url)
      }
    }

    return yield* ListeningPreview.makeEffect({ items, warnings }).pipe(
      Effect.mapError(() => new ListeningImportError({ message: 'Invalid Spotify preview.' })),
    )
  }

  if (source.platform === 'soundcloud') {
    return yield* fail(
      'SoundCloud playlist snapshots are unsupported: public oEmbed provides only a set widget, not a reliable track enumeration; the documented API requires credentials. No items were imported.',
    )
  }

  const path = new URL(source.url).pathname
  const items: Array<{ url: string; title: string }> = []

  const warnings: Array<string> = [
    'This is a one-time public playlist snapshot; later changes are not synced.',
  ]

  const seen = new Set<string>()

  for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
    const result = yield* loadMixcloudPage(path, pageIndex * 100).pipe(Effect.result)

    if (Result.isFailure(result)) {
      if (pageIndex === 0) return yield* result.failure
      warnings.push(
        'Partial import: a later Mixcloud page failed; remaining items were not imported.',
      )
      break
    }

    const page = result.success

    if (page.data.length > 100)
      return yield* fail('Mixcloud returned more than the requested page size; snapshot aborted.')

    for (const item of page.data) {
      const parsed = yield* parseListeningSource(item.url).pipe(Effect.result)

      if (Result.isFailure(parsed) || parsed.success.platform !== 'mixcloud' || !item.name.trim()) {
        warnings.push('Partial import: an invalid or unavailable Mixcloud item was skipped.')
        continue
      }

      if (!seen.has(parsed.success.url)) {
        items.push({ url: parsed.success.url, title: item.name.trim().slice(0, 300) })
        seen.add(parsed.success.url)
      }
    }

    if (!page.paging?.next) break

    if (page.data.length !== 100) {
      warnings.push(
        'Partial import: inconsistent Mixcloud pagination; remaining items were not imported.',
      )
      break
    }

    if (pageIndex === 1)
      warnings.push(
        'Partial import: reached the 2-page / 200-item limit; remaining items were not imported.',
      )
  }

  return yield* ListeningPreview.makeEffect({ items, warnings }).pipe(
    Effect.mapError(
      () => new ListeningImportError({ message: 'Invalid listening import preview.' }),
    ),
  )
})
