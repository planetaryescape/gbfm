import { Option, Schema } from 'effect'

const HttpUrl = Schema.URLFromString.check(
  Schema.makeFilter((url) => url.protocol === 'https:' || url.protocol === 'http:'),
)

const isDomain = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`)

const SpotifyUrl = HttpUrl.check(
  Schema.makeFilter(
    (url) => isDomain(url.hostname, 'spotify.com') || url.hostname === 'spotify.link',
  ),
)

const YouTubeUrl = HttpUrl.check(
  Schema.makeFilter((url) => isDomain(url.hostname, 'youtube.com') || url.hostname === 'youtu.be'),
)

const AppleMusicUrl = HttpUrl.check(
  Schema.makeFilter((url) => isDomain(url.hostname, 'music.apple.com')),
)

const BandcampUrl = HttpUrl.check(
  Schema.makeFilter((url) => isDomain(url.hostname, 'bandcamp.com')),
)

const spotifyEntityPath = (url: URL): string => {
  const path = url.pathname.replace(/^\/intl-[a-zA-Z-]+\//, '/')

  if (url.hostname !== 'open.spotify.com') return path

  if (path.startsWith('/embed/')) return path.slice('/embed'.length)

  return path.replace(/^\/user\/[^/]+\/playlist\//, '/playlist/')
}

const spotifyEntityId = (url: URL): string | null =>
  spotifyEntityPath(url).match(
    /^\/(?:track|album|playlist|artist|show|episode)\/([a-zA-Z0-9]+)\/?$/,
  )?.[1] ?? null

const spotifyLinkId = (url: URL): string | null => {
  if (url.hostname === 'spotify.link') {
    return url.pathname.match(/^\/([a-zA-Z0-9]+)\/?$/)?.[1] ?? null
  }

  return (
    spotifyEntityPath(url).match(/^\/(?:track|album|playlist)\/([a-zA-Z0-9]+)\/?$/)?.[1] ?? null
  )
}

const youTubeVideoId = (url: URL): string | null => {
  const id =
    url.hostname === 'youtu.be'
      ? url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/)?.[1]
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]+)\/?$/)?.[1]

  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null
}

const bandcampEntityId = (url: URL): string | null =>
  url.pathname.match(/^\/(?:album|track)\/([^/]+)\/?$/)?.[1] ?? null

export const SpotifyEntityUrl = HttpUrl.check(
  Schema.makeFilter((url) => url.hostname === 'open.spotify.com' && spotifyEntityId(url) !== null),
).pipe(Schema.brand('SpotifyEntityUrl'))

export const YouTubeVideoUrl = YouTubeUrl.check(
  Schema.makeFilter((url) => youTubeVideoId(url) !== null),
).pipe(Schema.brand('YouTubeVideoUrl'))

export const BandcampEntityUrl = BandcampUrl.check(
  Schema.makeFilter((url) => bandcampEntityId(url) !== null),
).pipe(Schema.brand('BandcampEntityUrl'))

export const parseSpotifyUrl = Schema.decodeUnknownEffect(SpotifyEntityUrl)

export const parseYouTubeUrl = Schema.decodeUnknownEffect(YouTubeVideoUrl)

export const parseBandcampUrl = Schema.decodeUnknownEffect(BandcampEntityUrl)

const decodeSpotifyEntityUrl = Schema.decodeUnknownOption(SpotifyEntityUrl)

const decodeSpotifyUrl = Schema.decodeUnknownOption(SpotifyUrl)

const decodeYouTubeUrl = Schema.decodeUnknownOption(YouTubeUrl)

const decodeYouTubeVideoUrl = Schema.decodeUnknownOption(YouTubeVideoUrl)

const decodeAppleMusicUrl = Schema.decodeUnknownOption(AppleMusicUrl)

const decodeBandcampUrl = Schema.decodeUnknownOption(BandcampUrl)

const decodeBandcampEntityUrl = Schema.decodeUnknownOption(BandcampEntityUrl)

const decodeEncodedUrl = Schema.decodeUnknownOption(
  Schema.StringFromUriComponent.pipe(Schema.decodeTo(Schema.URLFromString)),
)

export const getIdFromSpotifyUrl = (url: string): string | null =>
  decodeSpotifyEntityUrl(url).pipe(Option.map(spotifyEntityId), Option.getOrNull)

export const cleanId = (id: string): string | null =>
  decodeEncodedUrl(id).pipe(
    Option.map((url) => getIdFromSpotifyUrl(url.href)),
    Option.getOrElse(() => id),
  )

export const isSpotifyUrl = (url: string): boolean => Option.isSome(decodeSpotifyUrl(url))

export const isYouTubeUrl = (url: string): boolean => Option.isSome(decodeYouTubeUrl(url))

export const isAppleMusicUrl = (url: string): boolean => Option.isSome(decodeAppleMusicUrl(url))

export const isBandcampUrl = (url: string): boolean => Option.isSome(decodeBandcampUrl(url))

export const extractSpotifyId = (url: string): string | null =>
  decodeSpotifyUrl(url).pipe(Option.map(spotifyLinkId), Option.getOrNull)

export const extractYouTubeId = (url: string): string | null =>
  decodeYouTubeVideoUrl(url).pipe(Option.map(youTubeVideoId), Option.getOrNull)

export const extractBandcampId = (url: string): string | null =>
  decodeBandcampEntityUrl(url).pipe(Option.map(bandcampEntityId), Option.getOrNull)
