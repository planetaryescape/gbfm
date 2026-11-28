import { Option, Schema } from 'effect'

export const Checkpoint = Schema.String.check(
  Schema.isPattern(/^(?!.*[\s/?#\\])\P{C}+$/u),
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
)

export const parseCheckpoint = (value: string | null | undefined) => {
  const slug = Option.getOrNull(Schema.decodeUnknownOption(Checkpoint)(value))

  return slug && !['latest', 'new', '.', '..'].includes(slug) ? slug : null
}

export const checkpointKey = (identity: string) =>
  `gbfm:tweet-checkpoint:${encodeURIComponent(identity)}`

const readerUrl = (href: string | URL) => new URL(href, 'https://goosebumps.fm')

export const isEntry = (href: string | URL) => {
  const url = readerUrl(href)

  return ['/tweet', '/tweets'].includes(url.pathname) && !url.searchParams.has('q')
}

export const concreteSlug = (href: string | URL) => {
  const url = readerUrl(href)
  const match = /^\/tweet\/([^/]+)$/.exec(url.pathname)

  try {
    return match?.[1] ? parseCheckpoint(decodeURIComponent(match[1])) : null
  } catch {
    return null
  }
}

export const readModeCookie = 'gbfm-tweet-read-mode'

const ReadMode = Schema.Literals(['unread', 'all'])

export const skipsSeenTweets = (cookies: string | null) => {
  const value = cookies
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${readModeCookie}=`))
    ?.slice(readModeCookie.length + 1)

  return Option.getOrElse(Schema.decodeUnknownOption(ReadMode)(value), () => 'unread') === 'unread'
}
