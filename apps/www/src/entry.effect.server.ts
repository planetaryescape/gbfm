import { MessageLog, Router } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { Effect, Layer, Predicate } from 'effect'

import { serializeBootstrap, type Bootstrap } from './app/bootstrap'
import { CredentialApplication, makeCredentialProps } from './app/credential-application'
import { identityFromPage, serverPageLayer } from './app/page-query'
import { AppRoute } from './app/route'
import { AppBootstrap, RoutedApplication } from './app/routed-application'
import { nativePlayerServerLayer } from './features/player/provider'
import {
  makeSpotifyCallbackProps,
  SpotifyCallbackApplication,
  spotifyCallbackHeaders,
  spotifyCallbackLayer,
} from './features/spotify/callback-application'
import { isSpotifyCallbackUrl } from './features/spotify/callback-url'
import { logServerRequest } from './observability/server'
import { parseRoute, Route } from './route'
import { type EntryResult, Rendered, Responded } from './server/effect-ui'
import { requestHttpClientLayer } from './server/effect-ui/http-client'
import { dispatchHttp, type LoadedPage } from './server/http-dispatch'
import { loadPageData } from './server/page-data'
import { preparePageResponse } from './server/prepare-page-response'

export { renderDocument } from './server/effect-ui'

export { instrumentWorker } from './observability/server'

export { handlesHttpRequest } from './server/http-routes'

const renderApplication = async (
  rendering: Effect.Effect<HtmlServer.Rendered<unknown>>,
  bootstrap: Bootstrap,
  status: number,
  headers: Headers,
  extraHead: string,
  requestId: string,
): Promise<EntryResult> => {
  let failed = false

  const rendered = await Effect.runPromise(
    rendering.pipe(
      Effect.provideService(MessageLog.MessageLog, {
        enabled: true,
        record: (entry) => {
          if (Predicate.isTagged(entry, 'Failed')) failed = true
        },
      }),
      Effect.catchDefect(() => Effect.succeed(undefined)),
    ),
  )

  if (failed || !rendered || rendered.model === undefined)
    return Responded(
      new Response(`Something went wrong. Request ID: ${requestId}`, {
        status: 500,
        headers,
      }),
    )

  return Rendered(
    { ...rendered, serializedProps: serializeBootstrap(bootstrap), extraHead },
    { status, headers },
  )
}

export const renderNativePage = async (
  request: Request,
  dataRequest: boolean,
  startedAt: number,
  page: LoadedPage,
): Promise<EntryResult> => {
  const { document, status, headers, unmanagedHead } = await preparePageResponse(
    request,
    startedAt,
    page,
  )

  if (
    ['/auth/reset-password', '/subscribe', '/unsubscribe'].includes(page.url.pathname) &&
    page.url.searchParams.has('token')
  ) {
    const props = makeCredentialProps(page.url, document.metadata, document.turnstileSiteKey)
    headers.set('referrer-policy', 'no-referrer')
    headers.set('x-robots-tag', 'noindex, nofollow')

    return renderApplication(
      HtmlServer.renderToHtml(CredentialApplication, props, { budget: '5 seconds' }),
      {
        kind: 'credential',
        url: props.url,
        metadata: props.metadata,
        turnstileSiteKey: props.turnstileSiteKey,
      },
      status,
      headers,
      unmanagedHead,
      page.requestId,
    )
  }

  if (isSpotifyCallbackUrl(page.url)) {
    const props = makeSpotifyCallbackProps({
      principal: document.principal,
      principalKnown: document.principalKnown ?? true,
    })

    for (const [name, value] of Object.entries(spotifyCallbackHeaders)) headers.set(name, value)

    return renderApplication(
      HtmlServer.renderToHtml(SpotifyCallbackApplication, props, { budget: '5 seconds' }).pipe(
        Effect.provide(spotifyCallbackLayer),
      ),
      { kind: 'spotify-callback', ...props },
      status,
      headers,
      unmanagedHead,
      page.requestId,
    )
  }

  if (dataRequest) return Responded(Response.json(document, { status, headers }))

  const props = AppBootstrap.make({
    url: page.url,
    metadata: document.metadata,
    identity: identityFromPage(document),
    realm: page.requestId,
  })

  const path = `${page.url.pathname}${page.url.search}`

  const pageLayer = serverPageLayer({
    request,
    ownedRequest: request,
    requestId: page.requestId,
    realm: props.realm,
    preloaded: { path, document },
    load: loadPageData,
    prepare: async (loaded) => (await preparePageResponse(request, startedAt, loaded)).document,
  })

  return renderApplication(
    HtmlServer.renderToHtml(RoutedApplication, props, { budget: '5 seconds' }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Router.static({ routes: AppRoute, url: path }),
          pageLayer,
          nativePlayerServerLayer,
          requestHttpClientLayer(request),
        ),
      ),
    ),
    { kind: 'routed', ...props },
    status,
    headers,
    unmanagedHead,
    page.requestId,
  )
}

export const renderPage = async (request: Request): Promise<EntryResult> => {
  const startedAt = performance.now()
  const requestId = resolveRequestId(request.headers.get('x-request-id'))
  const ownedRequest = new Request(request)
  ownedRequest.headers.set('x-request-id', requestId)
  const url = new URL(request.url)
  let result: EntryResult

  try {
    result = await dispatchHttp(ownedRequest, renderNativePage, {
      url,
      route: isSpotifyCallbackUrl(url)
        ? Route.cases.Static.make({ page: 'spotify-callback' })
        : parseRoute(url.pathname),
    })
  } catch {
    result = Responded(
      new Response(`Something went wrong. Request ID: ${requestId}`, {
        status: 500,
        headers: {
          'cache-control': 'private, no-store',
          'x-request-id': requestId,
        },
      }),
    )
  }

  logServerRequest({
    service: 'www',
    requestId,
    route: url.pathname,
    method: request.method,
    release: import.meta.env.PROD ? import.meta.env.GBFM_BUILD_ID : 'local',
    status: Predicate.isTagged(result, 'Responded') ? result.response.status : result.status,
    durationMs: Math.round(performance.now() - startedAt),
  })

  return result
}
