import { AudioPageResponse } from '@gbfm/api/audio'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

import type { PageDocument } from '../../domain/page'
import { skipsSeenTweets } from '../../features/reader/location'
import type { Route } from '../../route'
import { apiRequest } from '../../server/api'
import { contentItems } from '../../server/page-data/shared'

export const loadAudioDetailData = async (
  request: Request,
  originalRequest: Request,
  url: URL,
  route: Route,
  requestId: string,
  type: 'mix' | 'track',
  slug: string,
) => {
  const response = await apiRequest(
    request,
    `/api/content/audio/${type}/${encodeURIComponent(slug)}/page`,
    { method: 'GET' },
  ).catch(() => null)

  const decoded = await (
    response?.ok
      ? response.json().then(Schema.decodeUnknownSync(AudioPageResponse))
      : Promise.resolve(null)
  ).catch(() => null)

  const page = decoded ?? AudioPageResponse.cases.Unavailable.make({ principal: null })

  const ready = AudioPageResponse.guards.Ready(page) ? page : null

  const items = ready
    ? contentItems(
        Schema.decodeUnknownSync(Schema.Json)(ready.audio),
        `/${type === 'mix' ? 'mixes' : 'tracks'}`,
      )
    : []

  const status = AudioPageResponse.match(page, {
    Ready: () => 200,
    NotFound: () => 404,
    Unavailable: () => 503,
  })

  const title = ready?.audio.title ?? 'Not found'

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
    shows: null,
    changelog: null,
    publicAction: ready
      ? {
          target: { id: ready.audio.id, kind: 'audio' },
          path: `${url.pathname}${url.search}`,
          state: ready.favorite,
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
    showDetailSlug: null,
    showMetadata: null,
    profile: null,
    route,
    url,
    requestId,
  } as const
}
