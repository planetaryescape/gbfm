import { Cause, Effect, Exit } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import {
  cleanId,
  extractSpotifyId,
  extractYouTubeId,
  getIdFromSpotifyUrl,
  isExactSpotifyAlbumMatch,
  isExactSpotifyIsrcMatch,
  isAppleMusicUrl,
  isSpotifyUrl,
  isYouTubeUrl,
  resolveSpotifySourceEffect,
} from './spotify.service'
import type { SpotifyService } from './spotify.service'

const spotifyId = '4iV5W9uYEdYUVa79Axb7Rh'

const makeSourceLookups = () => ({
  getTrack: vi.fn<SpotifyService['getTrack']>(() =>
    Effect.succeed({
      title: 'Track title',
      artists: 'Artist',
      trackUrl: `https://open.spotify.com/track/${spotifyId}`,
      isrc: 'USRC17607839',
      albumImageUrl: 'https://image.example/track.jpg',
    }),
  ),
  getAlbum: vi.fn<SpotifyService['getAlbum']>(() =>
    Effect.succeed({
      albumType: 'album',
      title: 'Album title',
      artists: 'Artist',
      albumUrl: `https://open.spotify.com/album/${spotifyId}`,
      tracks: [],
    }),
  ),
  getPlaylist: vi.fn<SpotifyService['getPlaylist']>(() =>
    Effect.succeed({
      title: 'Playlist title',
      description: 'Playlist description',
      ownerName: 'Playlist owner',
      playlistUrl: `https://open.spotify.com/playlist/${spotifyId}`,
      tracks: [],
    }),
  ),
})

describe('resolveSpotifySourceEffect', () => {
  test('resolves a track URL to the canonical Spotify source', async () => {
    const spotify = makeSourceLookups()

    const candidate = await Effect.runPromise(
      resolveSpotifySourceEffect(spotify, {
        entityType: 'track',
        urlOrId: `https://open.spotify.com/track/${spotifyId}?si=abc123`,
      }),
    )

    expect(candidate).toEqual({
      platform: 'spotify',
      entityType: 'track',
      externalId: spotifyId,
      title: 'Track title',
      artists: 'Artist',
      isrc: 'USRC17607839',
      url: `https://open.spotify.com/track/${spotifyId}`,
      imageUrl: 'https://image.example/track.jpg',
      crossPlatformEnrichment: 'allowed',
    })
    expect(spotify.getTrack).toHaveBeenCalledWith(spotifyId)
  })

  test('resolves a raw album ID using the expected source type', async () => {
    const spotify = makeSourceLookups()

    const candidate = await Effect.runPromise(
      resolveSpotifySourceEffect(spotify, { entityType: 'album', urlOrId: spotifyId }),
    )

    expect(candidate.entityType).toBe('album')
    expect(candidate.url).toBe(`https://open.spotify.com/album/${spotifyId}`)
    expect(candidate.crossPlatformEnrichment).toBe('allowed')
    expect(spotify.getAlbum).toHaveBeenCalledWith(spotifyId)
  })

  test('marks an exact playlist source as forbidden from cross-platform enrichment', async () => {
    const spotify = makeSourceLookups()

    const candidate = await Effect.runPromise(
      resolveSpotifySourceEffect(spotify, {
        entityType: 'playlist',
        urlOrId: `https://open.spotify.com/playlist/${spotifyId}`,
      }),
    )

    expect(candidate).toMatchObject({
      platform: 'spotify',
      entityType: 'playlist',
      externalId: spotifyId,
      url: `https://open.spotify.com/playlist/${spotifyId}`,
      crossPlatformEnrichment: 'forbidden',
    })
    expect(spotify.getPlaylist).toHaveBeenCalledWith(spotifyId)
  })

  test('rejects a mismatched source URL before calling Spotify', async () => {
    const spotify = makeSourceLookups()

    const error = await Effect.runPromise(
      Effect.flip(
        resolveSpotifySourceEffect(spotify, {
          entityType: 'track',
          urlOrId: `https://open.spotify.com/album/${spotifyId}`,
        }),
      ),
    )

    expect(error._tag).toBe('MusicProviderInvalidInput')
    expect(error).toMatchObject({ operation: 'resolveSource' })
    expect(spotify.getTrack).not.toHaveBeenCalled()
    expect(spotify.getAlbum).not.toHaveBeenCalled()
    expect(spotify.getPlaylist).not.toHaveBeenCalled()
  })

  test('rejects malformed and non-Spotify source input', async () => {
    const spotify = makeSourceLookups()
    const inputs = ['short-id', `https://example.com/track/${spotifyId}`]

    for (const urlOrId of inputs) {
      const error = await Effect.runPromise(
        Effect.flip(resolveSpotifySourceEffect(spotify, { entityType: 'track', urlOrId })),
      )

      expect(error._tag).toBe('MusicProviderInvalidInput')
      expect(error).toMatchObject({ operation: 'resolveSource' })
    }

    expect(spotify.getTrack).not.toHaveBeenCalled()
  })

  test('interrupts an in-flight source lookup when the caller aborts', async () => {
    const spotify: Pick<SpotifyService, 'getTrack' | 'getAlbum' | 'getPlaylist'> = {
      getTrack: () => Effect.never,
      getAlbum: () => Effect.die('unexpected album lookup'),
      getPlaylist: () => Effect.die('unexpected playlist lookup'),
    }

    const controller = new AbortController()

    const exitPromise = Effect.runPromiseExit(
      resolveSpotifySourceEffect(spotify, { entityType: 'track', urlOrId: spotifyId }),
      { signal: controller.signal },
    )

    controller.abort()

    const exit = await exitPromise
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  })
})

describe('Spotify exact search matching', () => {
  test('accepts only the normalized ISRC returned by Spotify', () => {
    expect(isExactSpotifyIsrcMatch('us-rc1-76-07839', 'USRC17607839')).toBe(true)
    expect(isExactSpotifyIsrcMatch('USRC17607839', 'GBAYE0601696')).toBe(false)
    expect(isExactSpotifyIsrcMatch('USRC17607839', undefined)).toBe(false)
  })

  test('requires an exact normalized album title and artist', () => {
    expect(isExactSpotifyAlbumMatch('Déjà Vu', 'Beyoncé', 'Deja Vu', ['Beyonce'])).toBe(true)
    expect(
      isExactSpotifyAlbumMatch('Discovery', 'Daft Punk', 'Discovery Deluxe', ['Daft Punk']),
    ).toBe(false)
    expect(
      isExactSpotifyAlbumMatch('Discovery', 'Daft Punk', 'Discovery', ['Various Artists']),
    ).toBe(false)
  })
})

describe('getIdFromSpotifyUrl', () => {
  test('extracts ID from Spotify URL with query params', () => {
    const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc123'
    expect(getIdFromSpotifyUrl(url)).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })

  test('extracts ID from Spotify URL without query params', () => {
    const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh'
    expect(getIdFromSpotifyUrl(url)).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })

  test.each([
    'https://open.spotify.com/playlist/651oo3KB6qwFGBCH6LLQSY',
    'https://open.spotify.com/playlist/651oo3KB6qwFGBCH6LLQSY?si=d86bfe0a686e49a9',
    'https://open.spotify.com/playlist/651oo3KB6qwFGBCH6LLQSY#tracks',
    'https://open.spotify.com/playlist/651oo3KB6qwFGBCH6LLQSY/',
    'https://open.spotify.com/intl-de/playlist/651oo3KB6qwFGBCH6LLQSY',
  ])('extracts the same playlist ID from %s', (url) => {
    expect(getIdFromSpotifyUrl(url)).toBe('651oo3KB6qwFGBCH6LLQSY')
  })

  test.each([
    'https://example.com/playlist/651oo3KB6qwFGBCH6LLQSY?si=abc',
    'https://open.spotify.com.evil.example/playlist/651oo3KB6qwFGBCH6LLQSY',
    'https://open.spotify.com/playlist/',
    'https://open.spotify.com/playlist/651oo3KB6qwFGBCH6LLQSY/tracks',
    'https://open.spotify.com/search/ambient',
  ])('rejects invalid Spotify entity URL %s', (url) => {
    expect(getIdFromSpotifyUrl(url)).toBeNull()
  })

  test('returns null for invalid URL', () => {
    expect(getIdFromSpotifyUrl('not-a-url')).toBeNull()
  })
})

describe('cleanId', () => {
  test('returns raw ID when not a URL', () => {
    expect(cleanId('4iV5W9uYEdYUVa79Axb7Rh')).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })

  test('extracts ID from a canonical playlist URL', () => {
    expect(cleanId('https://open.spotify.com/playlist/651oo3KB6qwFGBCH6LLQSY')).toBe(
      '651oo3KB6qwFGBCH6LLQSY',
    )
  })

  test('extracts ID from encoded Spotify URL', () => {
    const encodedUrl = encodeURIComponent(
      'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc',
    )

    expect(cleanId(encodedUrl)).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })
})

describe('isSpotifyUrl', () => {
  test('returns true for spotify.com URLs', () => {
    expect(isSpotifyUrl('https://open.spotify.com/track/123')).toBe(true)
    expect(isSpotifyUrl('https://spotify.com/album/456')).toBe(true)
  })

  test('returns true for spotify.link URLs', () => {
    expect(isSpotifyUrl('https://spotify.link/abc123')).toBe(true)
  })

  test('returns false for non-Spotify URLs', () => {
    expect(isSpotifyUrl('https://youtube.com/watch?v=123')).toBe(false)
    expect(isSpotifyUrl('https://example.com')).toBe(false)
  })
})

describe('isYouTubeUrl', () => {
  test('returns true for youtube.com URLs', () => {
    expect(isYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
  })

  test('returns true for youtu.be URLs', () => {
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
  })

  test('returns false for non-YouTube URLs', () => {
    expect(isYouTubeUrl('https://spotify.com/track/123')).toBe(false)
    expect(isYouTubeUrl('https://vimeo.com/123')).toBe(false)
  })
})

describe('isAppleMusicUrl', () => {
  test('returns true for music.apple.com URLs', () => {
    expect(isAppleMusicUrl('https://music.apple.com/album/123')).toBe(true)
    expect(isAppleMusicUrl('https://music.apple.com/us/album/xyz')).toBe(true)
  })

  test('returns false for non-Apple Music URLs', () => {
    expect(isAppleMusicUrl('https://apple.com')).toBe(false)
    expect(isAppleMusicUrl('https://spotify.com/track/123')).toBe(false)
  })
})

describe('extractSpotifyId', () => {
  test('extracts track ID from Spotify URL', () => {
    expect(extractSpotifyId('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh')).toBe(
      '4iV5W9uYEdYUVa79Axb7Rh',
    )
  })

  test('extracts album ID from Spotify URL', () => {
    expect(extractSpotifyId('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3')).toBe(
      '1DFixLWuPkv3KT3TnV35m3',
    )
  })

  test('extracts playlist ID from Spotify URL', () => {
    expect(extractSpotifyId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(
      '37i9dQZF1DXcBWIGoYBM5M',
    )
  })

  test('extracts ID from spotify.link URL', () => {
    expect(extractSpotifyId('https://spotify.link/abc123xyz')).toBe('abc123xyz')
  })

  test('extracts ID from URL with query params', () => {
    expect(
      extractSpotifyId('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc123'),
    ).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })

  test('returns null for non-Spotify URL', () => {
    expect(extractSpotifyId('https://youtube.com/watch?v=123')).toBeNull()
  })

  test('returns null for invalid Spotify URL', () => {
    expect(extractSpotifyId('https://spotify.com/invalid/path')).toBeNull()
  })
})

describe('extractYouTubeId', () => {
  test('extracts ID from youtube.com/watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  test('extracts ID from youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  test('extracts ID from embed URL', () => {
    expect(extractYouTubeId('https://youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  test('extracts ID with additional query params', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe('dQw4w9WgXcQ')
  })

  test('handles IDs with hyphens and underscores', () => {
    expect(extractYouTubeId('https://youtu.be/abc-123_XYZ')).toBe('abc-123_XYZ')
  })

  test('returns null for non-YouTube URL', () => {
    expect(extractYouTubeId('https://vimeo.com/123456')).toBeNull()
  })

  test('returns null for invalid YouTube URL', () => {
    expect(extractYouTubeId('https://youtube.com/channel/abc')).toBeNull()
  })
})
