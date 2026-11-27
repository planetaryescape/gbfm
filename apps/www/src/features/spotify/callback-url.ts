export const spotifyCallbackPath = '/spotify/callback'

export const spotifyCallbackAliasPath = '/dashboard/spotify-callback'

export const isSpotifyCallbackUrl = (url: URL): boolean => {
  try {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

    if (parts.length !== 2) return false

    return (
      (parts[0] === 'spotify' && parts[1] === 'callback') ||
      (parts[0] === 'dashboard' && parts[1] === 'spotify-callback')
    )
  } catch {
    return false
  }
}
