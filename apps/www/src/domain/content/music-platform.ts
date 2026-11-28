const platformLabels = new Map([
  ['spotify', 'Spotify'],
  ['youtube', 'YouTube'],
  ['youtube_music', 'YT Music'],
  ['apple_music', 'Apple Music'],
  ['bandcamp', 'Bandcamp'],
  ['soundcloud', 'SoundCloud'],
  ['tidal', 'Tidal'],
  ['deezer', 'Deezer'],
  ['amazon_music', 'Amazon Music'],
  ['website', 'Website'],
  ['other', 'Link'],
])

/** Display name for a catalog streaming platform; unknown platforms keep their stored name. */
export const musicPlatformLabel = (platform: string): string =>
  platformLabels.get(platform) ?? platform

export const musicEntityLabels = { album: 'Album', track: 'Track', playlist: 'Playlist' } as const
