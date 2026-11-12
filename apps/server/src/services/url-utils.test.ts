import { Effect, Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  BandcampEntityUrl,
  cleanId,
  extractBandcampId,
  extractSpotifyId,
  extractYouTubeId,
  getIdFromSpotifyUrl,
  isAppleMusicUrl,
  isBandcampUrl,
  isSpotifyUrl,
  isYouTubeUrl,
  parseBandcampUrl,
  parseSpotifyUrl,
  parseYouTubeUrl,
  SpotifyEntityUrl,
  YouTubeVideoUrl,
} from './url-utils'

const spotifyId = '4iV5W9uYEdYUVa79Axb7Rh'

describe('Spotify entity parsing', () => {
  test.each([
    'user/alice/playlist/651oo3KB6qwFGBCH6LLQSY?si=x',
    'embed/playlist/651oo3KB6qwFGBCH6LLQSY?utm_source=generator',
    'intl-de/embed/playlist/651oo3KB6qwFGBCH6LLQSY/',
    'intl-en-US/user/alice/playlist/651oo3KB6qwFGBCH6LLQSY#tracks',
  ])('preserves legacy and embedded playlist path %s', async (path) => {
    const input = `https://open.spotify.com/${path}`
    const parsed = await Effect.runPromise(parseSpotifyUrl(input))

    expect(parsed.hostname).toBe('open.spotify.com')
    expect(getIdFromSpotifyUrl(input)).toBe('651oo3KB6qwFGBCH6LLQSY')
    expect(cleanId(input)).toBe('651oo3KB6qwFGBCH6LLQSY')
    expect(cleanId(encodeURIComponent(input))).toBe('651oo3KB6qwFGBCH6LLQSY')
    expect(extractSpotifyId(input)).toBe('651oo3KB6qwFGBCH6LLQSY')
  })

  test.each(['track', 'album', 'playlist', 'artist', 'show', 'episode'])(
    'preserves canonical %s extraction across sharing formats',
    async (entityType) => {
      for (const prefix of ['', 'intl-de/', 'intl-en-US/', 'embed/', 'intl-de/embed/']) {
        for (const suffix of ['', '?si=sharing', '#tracks', '/', '/?si=sharing#tracks']) {
          const input = `https://open.spotify.com/${prefix}${entityType}/${spotifyId}${suffix}`
          const parsed = await Effect.runPromise(parseSpotifyUrl(input))

          expect(parsed.hostname).toBe('open.spotify.com')
          expect(getIdFromSpotifyUrl(input)).toBe(spotifyId)
          expect(cleanId(input)).toBe(spotifyId)
          expect(Schema.is(SpotifyEntityUrl)(parsed)).toBe(true)
        }
      }
    },
  )

  test.each(['track', 'album', 'playlist'])(
    'extracts embedded %s IDs for existing enrichment consumers',
    (entityType) => {
      expect(extractSpotifyId(`https://open.spotify.com/embed/${entityType}/${spotifyId}`)).toBe(
        spotifyId,
      )
    },
  )

  test.each([
    `https://open.spotify.com/user/alice/playlist/${spotifyId}/extra`,
    `https://open.spotify.com/embed/playlist/${spotifyId}/extra`,
    `https://open.spotify.com/user/alice/track/${spotifyId}`,
    `https://open.spotify.com/user//playlist/${spotifyId}`,
    `https://open.spotify.com/embed/user/alice/playlist/${spotifyId}`,
    `https://open.spotify.com/embed/embed/playlist/${spotifyId}`,
    `https://open.spotify.com/other/embed/playlist/${spotifyId}`,
    `https://open.spotify.com.evil.example/user/alice/playlist/${spotifyId}`,
    `https://open.spotify.com.evil.example/embed/playlist/${spotifyId}`,
    `https://spotify.com/user/alice/playlist/${spotifyId}`,
    `https://spotify.com/embed/playlist/${spotifyId}`,
  ])('keeps legacy and embedded recognition bounded: %s', async (input) => {
    const error = await Effect.runPromise(Effect.flip(parseSpotifyUrl(input)))

    expect(error).toBeInstanceOf(Schema.SchemaError)
    expect(getIdFromSpotifyUrl(input)).toBeNull()
    expect(cleanId(input)).toBeNull()
    expect(extractSpotifyId(input)).toBeNull()
  })

  test.each([
    `https://example.com/track/${spotifyId}`,
    `https://open.spotify.com.evil.example/track/${spotifyId}`,
    `https://evil.example/redirect?url=https://open.spotify.com/track/${spotifyId}`,
    `ftp://open.spotify.com/track/${spotifyId}`,
    `https://open.spotify.com/track/${spotifyId}/extra`,
    `https://open.spotify.com/track/${spotifyId}-invalid`,
    'https://open.spotify.com/playlist/',
    'https://open.spotify.com/search/ambient',
    'not-a-url',
  ])('rejects invalid boundary input %s through the typed channel', async (input) => {
    const error = await Effect.runPromise(Effect.flip(parseSpotifyUrl(input)))

    expect(error).toBeInstanceOf(Schema.SchemaError)
    expect(Option.isNone(Schema.decodeUnknownOption(SpotifyEntityUrl)(input))).toBe(true)

    expect(getIdFromSpotifyUrl(input)).toBeNull()
  })

  test.each([null, 42])('rejects non-string boundary input %s', async (input) => {
    const error = await Effect.runPromise(Effect.flip(parseSpotifyUrl(input)))

    expect(error).toBeInstanceOf(Schema.SchemaError)
  })

  test('preserves HTTP support and raw-ID fallback semantics', () => {
    expect(getIdFromSpotifyUrl(`http://open.spotify.com/track/${spotifyId}`)).toBe(spotifyId)
    expect(cleanId(spotifyId)).toBe(spotifyId)
    expect(cleanId('not-a-url')).toBe('not-a-url')
    expect(cleanId('invalid%encoding')).toBe('invalid%encoding')
    expect(cleanId('%34raw-id')).toBe('%34raw-id')
    expect(cleanId('')).toBe('')
    expect(cleanId('https://example.com/track/123')).toBeNull()
    expect(cleanId('https://open.spotify.com/search/ambient')).toBeNull()
    expect(cleanId(encodeURIComponent(`https://open.spotify.com/track/${spotifyId}`))).toBe(
      spotifyId,
    )
  })

  test('keeps enrichment extraction separate from canonical entity parsing', () => {
    expect(extractSpotifyId(`https://spotify.com/track/${spotifyId}`)).toBe(spotifyId)
    expect(extractSpotifyId(`https://open.spotify.com/intl-de/album/${spotifyId}/?si=1`)).toBe(
      spotifyId,
    )
    expect(extractSpotifyId('https://spotify.link/abc123xyz')).toBe('abc123xyz')
    expect(getIdFromSpotifyUrl('https://spotify.link/abc123xyz')).toBeNull()
    expect(extractSpotifyId(`https://open.spotify.com/artist/${spotifyId}`)).toBeNull()
    expect(extractSpotifyId(`https://open.spotify.com/track/${spotifyId}/extra`)).toBeNull()
    expect(extractSpotifyId(`https://evil.example/spotify.com/track/${spotifyId}`)).toBeNull()
  })
})

describe('provider predicates', () => {
  const providers = [
    { predicate: isSpotifyUrl, domain: 'open.spotify.com', path: '/track/123' },
    { predicate: isYouTubeUrl, domain: 'www.youtube.com', path: '/watch?v=abc' },
    { predicate: isAppleMusicUrl, domain: 'music.apple.com', path: '/us/album/123' },
    { predicate: isBandcampUrl, domain: 'artist.bandcamp.com', path: '/album/release' },
  ]

  test.each(providers)(
    'recognizes only parsed provider hosts: $domain',
    ({ predicate, domain, path }) => {
      expect(predicate(`https://${domain}${path}`)).toBe(true)
      expect(predicate(`http://${domain}${path}`)).toBe(true)
      expect(predicate(`https://${domain.toUpperCase()}${path}`)).toBe(true)
      expect(predicate(`https://${domain}.evil.example${path}`)).toBe(false)
      expect(predicate(`https://${domain}@evil.example${path}`)).toBe(false)
      expect(predicate(`https://evil.example/${domain}${path}`)).toBe(false)
      expect(predicate(`https://evil.example/?url=https://${domain}${path}`)).toBe(false)
      expect(predicate(`ftp://${domain}${path}`)).toBe(false)
      expect(predicate(domain)).toBe(false)
      expect(predicate('not-a-url')).toBe(false)
    },
  )

  test('recognizes short-link hosts without treating arbitrary suffixes as providers', () => {
    expect(isSpotifyUrl('https://spotify.link/abc123')).toBe(true)
    expect(isSpotifyUrl('https://spotify.link.evil.example/abc123')).toBe(false)
    expect(isYouTubeUrl('https://youtu.be/abc123')).toBe(true)
    expect(isYouTubeUrl('https://youtu.be.evil.example/abc123')).toBe(false)
    expect(isBandcampUrl('https://notbandcamp.com/album/release')).toBe(false)
  })
})

describe('YouTube video parsing', () => {
  test.each([
    'https://youtube.com/watch?v=abc-123_XYZ',
    'https://www.youtube.com/watch?t=30&v=abc-123_XYZ&list=playlist',
    'https://youtu.be/abc-123_XYZ?si=sharing',
    'https://youtube.com/embed/abc-123_XYZ/#video',
  ])('decodes and extracts video IDs from %s', async (input) => {
    const parsed = await Effect.runPromise(parseYouTubeUrl(input))

    expect(Schema.is(YouTubeVideoUrl)(parsed)).toBe(true)
    expect(extractYouTubeId(input)).toBe('abc-123_XYZ')
  })

  test.each([
    'https://youtube.com/watch?v=',
    'https://youtube.com/watch?v=abc%2Fextra',
    'https://youtube.com/channel/abc',
    'https://youtu.be/abc/extra',
    'https://youtube.com/embed/abc/extra',
    'https://youtube.com.evil.example/watch?v=abc',
    'https://evil.example/?url=https://youtube.com/watch?v=abc',
    'javascript:youtube.com/watch?v=abc',
  ])('rejects unsupported or misleading input %s', async (input) => {
    expect(extractYouTubeId(input)).toBeNull()
    const error = await Effect.runPromise(Effect.flip(parseYouTubeUrl(input)))
    expect(error).toBeInstanceOf(Schema.SchemaError)
  })
})

describe('Bandcamp entity parsing', () => {
  test.each(['album', 'track'])(
    'extracts a %s slug without query or fragment',
    async (entityType) => {
      const input = `https://artist.bandcamp.com/${entityType}/a-release/?from=discover#player`
      const parsed = await Effect.runPromise(parseBandcampUrl(input))

      expect(Schema.is(BandcampEntityUrl)(parsed)).toBe(true)
      expect(extractBandcampId(input)).toBe('a-release')
      expect(extractBandcampId(`https://artist.bandcamp.com/${entityType}/a-release#player`)).toBe(
        'a-release',
      )
    },
  )

  test.each([
    'https://artist.bandcamp.com/album/',
    'https://artist.bandcamp.com/album/release/extra',
    'https://artist.bandcamp.com/music',
    'https://artist.bandcamp.com.evil.example/album/release',
    'https://evil.example/?url=https://artist.bandcamp.com/album/release',
  ])('rejects unsupported or misleading input %s', async (input) => {
    expect(extractBandcampId(input)).toBeNull()
    const error = await Effect.runPromise(Effect.flip(parseBandcampUrl(input)))
    expect(error).toBeInstanceOf(Schema.SchemaError)
  })
})
