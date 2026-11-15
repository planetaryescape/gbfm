import { youtubeVideoId } from '@gbfm/rich-content/spotlight'

export const PLAYER_ORIGIN = 'https://goosebumps.fm'

export const videoNavigationAllowed = (href: string, id: string): boolean => {
  if (href === 'about:blank' || href === 'about:srcdoc') return true

  try {
    const url = new URL(href)

    if (url.username || url.password) return false

    return (
      url.href === `${PLAYER_ORIGIN}/` ||
      (url.origin === 'https://www.youtube-nocookie.com' &&
        url.pathname === `/embed/${encodeURIComponent(id)}`)
    )
  } catch {
    return false
  }
}

export const videoWatchUrl = (canonicalUrl: string, id: string): string => {
  try {
    const url = new URL(canonicalUrl)

    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname) &&
      youtubeVideoId(canonicalUrl) === id
    )
      return canonicalUrl
  } catch {}

  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}
