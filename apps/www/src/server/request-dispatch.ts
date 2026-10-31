import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { Option, Schema } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { safeReturnPath } from '../page/auth/links'
import { parseCheckpoint } from '../page/tweet/reader'
import { parseRoute, Route } from '../route'
import { handleBrowserTelemetry } from '../telemetry/server'
import { apiRequest } from './api'
import { handleFormAction, redirect } from './form-actions'
import { loadPageData } from './page-data'
import { createPageResponse } from './page-response'

const isSignInOrUp = (action: string) => action === 'sign-in' || action === 'sign-up'

const JsonObject = Schema.Record(Schema.String, Schema.Json)

const latestTweetSlug = async (response: Response) => {
  const payload = Schema.decodeUnknownSync(Schema.Json)(await response.json())
  const record = Option.getOrNull(Schema.decodeUnknownOption(JsonObject)(payload))

  return (
    parseCheckpoint(Option.getOrNull(Schema.decodeUnknownOption(Schema.String)(record?.slug))) ?? ''
  )
}

export const renderResponse = async (request: Request): Promise<Server.EntryResult> => {
  const startedAt = performance.now()
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto')

  // Foldkit's Vite adapter uses localhost as its URL base; preserve the incoming dev origin.
  if (import.meta.env.DEV && host) {
    const origin = URL.parse(`${(protocol ?? url.protocol).replace(':', '')}://${host}`)

    if (origin) {
      url.protocol = origin.protocol
      url.hostname = origin.hostname
      url.port = origin.port
    }
  }

  const route = parseRoute(url.pathname)
  const dataRequest = url.searchParams.has('__data')
  url.searchParams.delete('__data')
  const requestId = resolveRequestId(request.headers.get('x-request-id'))
  const ownedRequest = new Request(url, request)
  ownedRequest.headers.set('x-request-id', requestId)

  if (url.pathname === '/telemetry/browser') {
    if (!import.meta.env.PROD) return Server.Responded(new Response(null, { status: 204 }))
    const { env } = await import('cloudflare:workers')

    return Server.Responded(
      await handleBrowserTelemetry(ownedRequest, {
        ...env,
        BROWSER_TELEMETRY_ORIGIN: url.origin,
      }),
    )
  }

  if (url.pathname.startsWith('/social/cards/') || url.pathname.startsWith('/social/tweets/')) {
    if (!import.meta.env.PROD) return Server.Responded(new Response(null, { status: 404 }))
    const { env } = await import('cloudflare:workers')

    return Server.Responded(await env.SOCIAL_IMAGES.fetch(ownedRequest))
  }

  if (
    request.method === 'POST' &&
    (Route.guards.Auth(route) || url.pathname.startsWith('/actions/'))
  )
    return handleFormAction(ownedRequest)

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/s/') ||
    (url.pathname === '/auth/verify-email' && url.searchParams.has('token')) ||
    (url.pathname.startsWith('/auth/') && !Route.guards.Auth(route)) ||
    ['/rss.xml', '/sitemap.xml'].includes(url.pathname)
  )
    return Server.Responded(await apiRequest(ownedRequest, `${url.pathname}${url.search}`))

  if (!['GET', 'HEAD'].includes(request.method))
    return Server.Responded(new Response(null, { status: 405 }))

  const redirectPage = (path: string) => {
    const target = new URL(path, url)

    if (dataRequest) target.searchParams.set('__data', '1')

    return redirect(`${target.pathname}${target.search}`)
  }

  if (url.pathname === '/tweet') {
    const slug = parseCheckpoint(url.searchParams.get('visit'))

    return redirectPage(slug ? `/tweet/${encodeURIComponent(slug)}` : '/tweets')
  }

  if (url.pathname === '/tweets' && url.searchParams.get('q') === 'archive')
    return redirectPage('/tweets')

  if (url.pathname === '/tweet/new') return redirectPage('/new/tweet')

  if (url.pathname === '/tweet/latest') {
    const latest = await apiRequest(ownedRequest, '/api/content/posts/micro/latest', {
      method: 'GET',
    }).catch(() => null)

    const slug = latest?.ok ? await latestTweetSlug(latest).catch(() => '') : ''

    if (slug) return redirectPage(`/tweet/${encodeURIComponent(slug)}`)

    if (!latest?.ok) {
      const page = await loadPageData(ownedRequest, request, url, route, requestId)

      if (!page.redirect)
        return createPageResponse(ownedRequest, dataRequest, startedAt, {
          ...page,
          flags: { ...page.flags, status: 503, failure: 'Latest tweet is unavailable right now.' },
        })
    }
  }

  const page = await loadPageData(ownedRequest, request, url, route, requestId)

  if (page.redirect) return redirectPage(page.redirect)

  if (page.flags.principal && Route.guards.Auth(route) && isSignInOrUp(route.action))
    return redirectPage(safeReturnPath(url.searchParams.get('returnTo') ?? '', url.origin))

  return createPageResponse(ownedRequest, dataRequest, startedAt, page)
}
