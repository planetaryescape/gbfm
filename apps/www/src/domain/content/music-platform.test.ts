import { expect, it } from 'vitest'

import { musicEntityLabels, musicPlatformLabel } from './music-platform'

it('preserves platform labels, unknown stored names and catalog entity labels', () => {
  expect(
    [
      'spotify',
      'youtube',
      'youtube_music',
      'apple_music',
      'bandcamp',
      'soundcloud',
      'tidal',
      'deezer',
      'amazon_music',
      'website',
      'other',
    ].map(musicPlatformLabel),
  ).toEqual([
    'Spotify',
    'YouTube',
    'YT Music',
    'Apple Music',
    'Bandcamp',
    'SoundCloud',
    'Tidal',
    'Deezer',
    'Amazon Music',
    'Website',
    'Link',
  ])
  expect(musicPlatformLabel('Independent Radio')).toBe('Independent Radio')
  expect(musicEntityLabels).toEqual({ album: 'Album', track: 'Track', playlist: 'Playlist' })
})
