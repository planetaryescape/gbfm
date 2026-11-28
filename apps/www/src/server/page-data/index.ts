import { GetPostTagsResponse, GetPostsByTagResponse } from '@gbfm/api/post'
import { PublicProfileResponse } from '@gbfm/api/profile'
import { ResolveResult } from '@gbfm/api/resolve'
import { ListDjsResponse } from '@gbfm/api/user'
import { Schema } from 'effect'
import changelog from 'virtual:repo-changelog'

import type { PageDocument } from '../../domain/page'
import type { Principal } from '../../domain/principal'
import type { PublicActionDocument } from '../../domain/public-action'
import { staticPages } from '../../domain/static/pages'
import { isEntry, skipsSeenTweets } from '../../features/reader/location'
import { loadAudioDetailData } from '../../page/content/page-data'
import { loadDashboardData } from '../../page/dashboard/page-data'
import { loadListeningPage } from '../../page/listening/page-data'
import { loadShowDetailData } from '../../page/shows/detail-page-data'
import { loadShowsData } from '../../page/shows/page-data'
import { loadTweetData } from '../../page/tweet/page-data'
import { Route } from '../../route'
import { apiRequest, endpointFor } from '../api'
import { loadIdentity, loadPublicActionState } from './identity'
import { contentItems, json } from './shared'

export interface LoadedPage {
  readonly redirect: null
  readonly flags: PageDocument
  readonly identity: {
    readonly principal: Principal | null
    readonly cookies: ReadonlyArray<string>
  }
  readonly response: Response | null
  readonly neighbourResponse: Response | null
  readonly tweetData: Awaited<ReturnType<typeof loadTweetData>>
  readonly showDetailSlug: string | null
  readonly showMetadata: PageDocument['metadata']
  readonly profile: PageDocument['profile']
  readonly route: Route
  readonly url: URL
  readonly requestId: string
}

export const loadPageData = async (
  ownedRequest: Request,
  request: Request,
  url: URL,
  route: Route,
  requestId: string,
): Promise<LoadedPage | { readonly redirect: string }> => {
  if (Route.guards.Detail(route) && route.kind === 'shows')
    return loadShowDetailData(ownedRequest, request, url, route, requestId, route.slug)

  if (Route.guards.Detail(route) && (route.kind === 'mixes' || route.kind === 'tracks'))
    return loadAudioDetailData(
      ownedRequest,
      request,
      url,
      route,
      requestId,
      route.kind === 'mixes' ? 'mix' : 'track',
      route.slug,
    )

  const endpoint = isEntry(url.href) ? null : endpointFor(route)
  const tweetSlug = Route.guards.Detail(route) && route.kind === 'tweets' ? route.slug : null
  const tweetPromise = loadTweetData(ownedRequest, endpoint, tweetSlug)
  const showsPromise = loadShowsData(ownedRequest, endpoint, route, url)

  const identity = await loadIdentity(ownedRequest)
  const listening = await loadListeningPage(ownedRequest, route, url, identity.principal !== null)
  const dashboard = await loadDashboardData(ownedRequest, route, url, identity.principal)
  const tweetData = tweetPromise ? await tweetPromise : null
  const showsData = showsPromise ? await showsPromise : null

  const selectedListingShow = showsData?.shows?.shows.find(
    (show) => show.slug === showsData.shows?.selectedSlug,
  )

  // The show browser and its dedicated URL must not publish competing copies.
  if (selectedListingShow)
    return { redirect: `/shows/${encodeURIComponent(selectedListingShow.slug)}` } as const

  const response = endpoint
    ? tweetData
      ? tweetData.screen
      : showsData
        ? showsData.response
        : await apiRequest(ownedRequest, endpoint, { method: 'GET' }).catch(() => null)
    : null

  const payload = tweetData
    ? tweetData.payload
    : showsData
      ? showsData.payload
      : response?.ok
        ? await json(response)
        : null

  const resolved =
    Route.guards.Detail(route) && route.kind === 'resolve' && payload
      ? Schema.decodeUnknownSync(ResolveResult)(payload)
      : null

  if (resolved?.type === 'show')
    return { redirect: `/shows/${encodeURIComponent(resolved.data.slug)}` } as const

  const profile =
    resolved?.type === 'profile'
      ? resolved.data
      : Route.guards.Detail(route) && route.kind === 'profile' && payload
        ? Schema.decodeUnknownSync(PublicProfileResponse)(payload)
        : null

  const tweet = tweetData?.tweet ?? null
  const neighbourResponse = tweetData?.neighbourResponse ?? null
  const neighbours = tweetData?.neighbours ?? null

  const listPath = Route.guards.Home(route)
    ? '/mixes'
    : Route.guards.Detail(route)
      ? `/${route.kind === 'tweets' ? 'tweet' : route.kind}`
      : url.pathname

  const items =
    Route.guards.Listing(route) && route.kind === 'tags' && response?.ok
      ? contentItems(
          Schema.decodeUnknownSync(GetPostTagsResponse)(payload).map((tag) => ({
            id: tag,
            slug: tag,
            title: `#${tag}`,
          })),
          '/tags',
        )
      : Route.guards.Detail(route) && route.kind === 'tags' && response?.ok
        ? Schema.decodeUnknownSync(GetPostsByTagResponse)(payload).data.flatMap((post) =>
            contentItems(post, post.type === 'micro' ? '/tweet' : '/editorial'),
          )
        : Route.guards.Listing(route) && route.kind === 'djs' && response?.ok
          ? contentItems(
              Schema.decodeUnknownSync(ListDjsResponse)(payload).map((dj) => ({
                ...dj,
                slug: dj.username ?? dj.id,
              })),
              '/profile',
            )
          : contentItems(payload, listPath)

  const shows = showsData?.shows ?? null
  const showDetailSlug = showsData?.detailSlug ?? null
  const showMetadata = showsData?.metadata ?? null
  const selectedShow = shows?.shows.find((show) => show.slug === shows.selectedSlug)

  const audioItem =
    Route.guards.Detail(route) && ['mixes', 'tracks'].includes(route.kind) ? items[0] : undefined

  const actionTarget: PublicActionDocument['target'] | null = selectedShow
    ? { id: selectedShow.id, kind: 'show' }
    : audioItem
      ? { id: audioItem.id, kind: 'audio' }
      : null

  const publicAction: PublicActionDocument | null = actionTarget
    ? {
        target: actionTarget,
        path: `${url.pathname}${url.search}`,
        state: identity.principal
          ? await loadPublicActionState(ownedRequest, actionTarget).catch(
              () => 'unavailable' as const,
            )
          : 'anonymous',
      }
    : null

  const title =
    (listening
      ? listening.page.workspace
        ? 'Your listening pile'
        : Route.guards.Detail(route)
          ? (listening.page.document.collections[0]?.title ?? 'Collection')
          : 'Mix collections'
      : null) ??
    (Route.guards.Detail(route) && route.kind === 'tags' ? `#${route.slug}` : null) ??
    shows?.shows.find((show) => show.slug === shows.selectedSlug)?.title ??
    profile?.name ??
    tweet?.post.title ??
    tweet?.post.content?.slice(0, 80) ??
    (Route.guards.Detail(route) ? items[0]?.title : null) ??
    Route.match(route, {
      Home: () => 'goosebumps.fm',
      Listing: ({ kind }) =>
        kind === 'djs' ? 'DJs & Residents' : kind.charAt(0).toUpperCase() + kind.slice(1),
      Detail: () => 'Not found',
      Auth: () => 'Account',
      Composer: () => 'Create',
      Dashboard: () => 'Dashboard',
      Static: ({ page }) => staticPages.get(page)?.title ?? page,
      NotFound: () => 'Page not found',
    })

  const status =
    listening?.status ??
    (Route.guards.NotFound(route) || response?.status === 404
      ? 404
      : endpoint && !response?.ok
        ? 503
        : 200)

  const flags: PageDocument = {
    url: url.pathname === '/spotify/callback' ? `${url.origin}${url.pathname}` : url.href,
    turnstileSiteKey:
      url.pathname === '/subscribe' || url.pathname === '/auth/sign-up'
        ? import.meta.env.PROD
          ? ((await import('cloudflare:workers')).env.TURNSTILE_SITE_KEY ?? '')
          : (process.env.TURNSTILE_SITE_KEY ?? '')
        : '',
    status,
    principal: identity.principal,
    principalKnown: identity.principalKnown,
    items,
    title,
    description:
      Route.guards.Static(route) && route.page === 'invite/charlie3000'
        ? 'An invitation to contribute a guest mix to goosebumps.fm'
        : (tweet?.post.description ??
          items[0]?.description ??
          'Independent music, mixes and stories on goosebumps.fm.'),
    requestId,
    renderedAt: Date.now(),
    skipSeen: skipsSeenTweets(request.headers.get('cookie')),
    tweet,
    neighbours,
    dashboard,
    listening: listening?.page,
    profile,
    shows,
    changelog: Route.guards.Static(route) && route.page === 'changelog' ? changelog : null,
    publicAction,
    metadata: null,
    failure: status === 503 ? 'Content is unavailable right now.' : null,
  }

  return {
    redirect: null,
    flags,
    identity: { principal: identity.principal, cookies: identity.cookies },
    response,
    neighbourResponse,
    tweetData,
    showDetailSlug,
    showMetadata,
    profile,
    route,
    url,
    requestId,
  } as const
}
