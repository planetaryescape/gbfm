import {
  getStaticSiteMetadata,
  makeStaticSiteMetadata,
  SiteMetadata,
  SITE_URL,
} from '@gbfm/site-metadata'
import { Option, Schema } from 'effect'

import type { PageDocument } from '../domain/page'
import { isEntry } from '../features/reader/location'
import { loginOAuthQuery } from '../page/connect/continuation'
import { Route } from '../route'
import { apiRequest } from './api'
import type { LoadedPage } from './http-dispatch'

export interface PreparedPageResponse {
  readonly document: PageDocument & { readonly metadata: SiteMetadata }
  readonly status: number
  readonly headers: Headers
  readonly unmanagedHead: string
  readonly extraHead: string
}

const metadataKind = new Map([
  ['mixes', 'mix'],
  ['tracks', 'track'],
  ['shows', 'show'],
  ['tweets', 'tweet'],
  ['editorial', 'editorial'],
  ['releases', 'release'],
  ['labels', 'label'],
  ['profile', 'profile'],
])

const decodeMetadata = async (response: Response | null): Promise<SiteMetadata | null> => {
  if (!response?.ok) return null

  return Option.getOrNull(Schema.decodeUnknownOption(SiteMetadata)(await response.json()))
}

const publicMetadata = async (
  request: Request,
  page: LoadedPage,
  containsDraft: boolean,
): Promise<SiteMetadata | null> => {
  const { flags, profile, route, showDetailSlug, response, showMetadata, tweetData } = page

  if (containsDraft) return null

  if (flags.metadata) return flags.metadata

  if (showDetailSlug && response?.ok) return showMetadata

  if (tweetData && flags.status === 200) return decodeMetadata(tweetData.metadata).catch(() => null)
  const kind = profile ? 'profile' : undefined
  const routeKind = Route.guards.Detail(route) ? metadataKind.get(route.kind) : undefined
  const resolvedKind = kind ?? routeKind

  if (!resolvedKind || !Route.guards.Detail(route) || flags.status !== 200) return null

  return apiRequest(
    request,
    `/api/site-metadata/${resolvedKind}/${encodeURIComponent(route.slug)}`,
    { method: 'GET' },
  )
    .then(decodeMetadata)
    .catch(() => null)
}

export const preparePageResponse = async (
  request: Request,
  startedAt: number,
  page: LoadedPage,
): Promise<PreparedPageResponse> => {
  const { flags, identity, response, neighbourResponse, route, url, requestId } = page
  const { status, title } = flags
  const containsDraft = flags.items.some((item) => item.draft)

  const headers = new Headers({
    'cache-control': 'private, no-store',
    'x-request-id': requestId,
    'server-timing': `foldkit;dur=${(performance.now() - startedAt).toFixed(1)}`,
  })

  if (loginOAuthQuery(url.searchParams.get('returnTo') ?? '', url.origin))
    headers.set('referrer-policy', 'strict-origin')

  if (containsDraft) headers.set('x-robots-tag', 'noindex, nofollow')

  for (const cookie of [
    ...identity.cookies,
    ...(response?.headers.getSetCookie() ?? []),
    ...(neighbourResponse?.headers.getSetCookie() ?? []),
  ])
    headers.append('set-cookie', cookie)

  const sourceMetadata =
    (await publicMetadata(request, page, containsDraft)) ??
    (status === 200 ? getStaticSiteMetadata(url.pathname) : null) ??
    makeStaticSiteMetadata(title, flags.description, url.pathname)

  // Preview and dev origins must not become competing public canonical URLs.
  const metadata = {
    ...sourceMetadata,
    canonicalUrl: new URL(new URL(sourceMetadata.canonicalUrl).pathname, SITE_URL).href,
  }

  const document = { ...flags, metadata }

  const privatePage =
    containsDraft ||
    Route.guards.Dashboard(route) ||
    Route.guards.Composer(route) ||
    Route.guards.Auth(route) ||
    url.pathname === '/listening' ||
    url.pathname === '/spotify/callback'

  const readerHead = isEntry(url.href)
    ? '<noscript><meta http-equiv="refresh" content="0;url=/tweet/latest"></noscript>'
    : ''

  const robotsHead =
    privatePage || status !== 200
      ? '<meta data-gbfm-metadata name="robots" content="noindex, nofollow">'
      : ''

  return {
    document,
    status,
    headers,
    unmanagedHead: readerHead,
    extraHead: readerHead + robotsHead,
  }
}
