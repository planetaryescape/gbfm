import { ShowPageResponse } from '@gbfm/api/shows'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

import type { PageDocument } from '../../domain/page'
import { skipsSeenTweets } from '../../features/reader/location'
import type { Route } from '../../route'
import { apiRequest } from '../../server/api'
import { contentItems } from '../../server/page-data/shared'

export const loadShowDetailData = async (
  request: Request,
  originalRequest: Request,
  url: URL,
  route: Route,
  requestId: string,
  slug: string,
) => {
  const response = await apiRequest(request, `/api/shows/${encodeURIComponent(slug)}/page`, {
    method: 'GET',
  }).catch(() => null)

  const decoded = await (
    response?.ok
      ? response.json().then(Schema.decodeUnknownSync(ShowPageResponse))
      : Promise.resolve(null)
  ).catch(() => null)

  const page = decoded ?? ShowPageResponse.cases.Unavailable.make({ principal: null })

  const ready = ShowPageResponse.guards.Ready(page) ? page : null

  const items = ready
    ? contentItems(Schema.decodeUnknownSync(Schema.Json)(ready.show), '/shows')
    : []

  const status = ShowPageResponse.match(page, {
    Ready: () => 200,
    NotFound: () => 404,
    Unavailable: () => 503,
  })

  const title = ready?.show.title ?? 'Not found'

  const description =
    items[0]?.description ?? 'Independent music, mixes and stories on goosebumps.fm.'

  const flags: PageDocument = {
    url: url.href,
    status,
    principal: page.principal,
    principalKnown: decoded !== null,
    items,
    title,
    description,
    requestId,
    renderedAt: Date.now(),
    skipSeen: skipsSeenTweets(originalRequest.headers.get('cookie')),
    tweet: null,
    neighbours: null,
    dashboard: null,
    profile: null,
    shows: ready
      ? {
          shows: ready.shows.some((show) => show.id === ready.show.id)
            ? ready.shows.map((show) =>
                show.id === ready.show.id ? { ...ready.show, hosts: ready.show.hosts ?? [] } : show,
              )
            : [{ ...ready.show, hosts: ready.show.hosts ?? [] }, ...ready.shows],
          selectedSlug: ready.show.slug,
          episodes: ready.episodes,
          richContent: ready.show.richContent,
        }
      : null,
    changelog: null,
    publicAction: ready
      ? {
          target: { id: ready.show.id, kind: 'show' },
          path: `${url.pathname}${url.search}`,
          state: ready.subscription,
        }
      : null,
    metadata: ready?.metadata ?? makeStaticSiteMetadata(title, description, url.pathname),
    failure: status === 503 ? 'Content is unavailable right now.' : null,
  }

  return {
    redirect: null,
    flags,
    identity: { principal: page.principal, cookies: [] },
    response,
    neighbourResponse: null,
    tweetData: null,
    showDetailSlug: slug,
    showMetadata: ready?.metadata ?? null,
    profile: null,
    route,
    url,
    requestId,
  } as const
}
