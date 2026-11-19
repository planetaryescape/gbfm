import type { Device } from '@spotify-effect/core'
import { describe, expect, test } from 'vitest'

import {
  pickSpotifyPlaybackTarget,
  spotifyEntityFromUrl,
  spotifyIdFromUrl,
  spotifyUriFromUrl,
} from './index'

test('turns supported Spotify web links and URIs into playable track, album, and playlist refs', () => {
  expect([
    spotifyEntityFromUrl('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh'),
    spotifyEntityFromUrl('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3'),
    spotifyEntityFromUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
    spotifyEntityFromUrl('https://open.spotify.com/intl-pt/album/1DFixLWuPkv3KT3TnV35m3?si=abc'),
    spotifyEntityFromUrl('spotify:track:4iV5W9uYEdYUVa79Axb7Rh'),
    spotifyEntityFromUrl('spotify:album:1DFixLWuPkv3KT3TnV35m3'),
    spotifyEntityFromUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'),
  ]).toEqual([
    {
      kind: 'track',
      id: '4iV5W9uYEdYUVa79Axb7Rh',
      uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    },
    {
      kind: 'album',
      id: '1DFixLWuPkv3KT3TnV35m3',
      uri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3',
    },
    {
      kind: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    },
    {
      kind: 'album',
      id: '1DFixLWuPkv3KT3TnV35m3',
      uri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3',
    },
    {
      kind: 'track',
      id: '4iV5W9uYEdYUVa79Axb7Rh',
      uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    },
    {
      kind: 'album',
      id: '1DFixLWuPkv3KT3TnV35m3',
      uri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3',
    },
    {
      kind: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    },
  ])
})

test('rejects invalid entities and keeps the legacy URI and ID helpers track-only', () => {
  expect(
    [
      'https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF',
      'https://bandcamp.com/track/whatever',
      '',
      'not a url at all, just some text',
      'spotify:track:',
    ].map(spotifyEntityFromUrl),
  ).toEqual([null, null, null, null, null])

  const track = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh'
  expect(spotifyUriFromUrl(track)).toBe('spotify:track:4iV5W9uYEdYUVa79Axb7Rh')
  expect(spotifyIdFromUrl(track)).toBe('4iV5W9uYEdYUVa79Axb7Rh')

  for (const nonTrack of [
    'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  ]) {
    expect(spotifyUriFromUrl(nonTrack)).toBeNull()
    expect(spotifyIdFromUrl(nonTrack)).toBeNull()
  }
})

describe('pickSpotifyPlaybackTarget', () => {
  const base: Device = {
    id: 'computer',
    is_active: false,
    is_private_session: false,
    is_restricted: false,
    name: 'Mac',
    type: 'Computer',
    volume_percent: 50,
  }

  test('prefers the active device', () => {
    expect(
      pickSpotifyPlaybackTarget([
        { ...base, id: 'phone', type: 'Smartphone', name: 'iPhone' },
        { ...base, is_active: true },
      ]),
    ).toEqual({ id: 'computer', name: 'Mac', active: true })
  })

  test('falls back to a phone, then any usable device', () => {
    expect(
      pickSpotifyPlaybackTarget([
        base,
        { ...base, id: 'phone', type: 'Smartphone', name: 'iPhone' },
      ]),
    ).toEqual({ id: 'phone', name: 'iPhone', active: false })
    expect(pickSpotifyPlaybackTarget([base])).toEqual({
      id: 'computer',
      name: 'Mac',
      active: false,
    })
  })

  test('ignores restricted and id-less devices', () => {
    expect(
      pickSpotifyPlaybackTarget([
        { ...base, is_restricted: true, is_active: true },
        { ...base, id: null },
      ]),
    ).toBeNull()
  })
})
