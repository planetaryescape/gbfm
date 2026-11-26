import { MessageLog } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { getStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Predicate } from 'effect'

import { Application } from './app/application'
import { AppProps, serializeAppProps } from './app/props'
import { logServerRequest } from './observability/server'
import { Rendered, Responded, type EntryResult } from './server/effect-ui'

export { renderDocument } from './server/effect-ui'

export { instrumentWorker } from './observability/server'

const staticPaths = new Set(['/about', '/privacy', '/terms'])

export const renderPage = async (request: Request): Promise<EntryResult> => {
  const startedAt = performance.now()
  const requestId = resolveRequestId(request.headers.get('x-request-id'))
  const url = new URL(request.url)

  const headers = new Headers({
    'cache-control': 'private, no-store',
    'x-request-id': requestId,
  })

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('allow', 'GET, HEAD')

    return Responded(new Response(null, { status: 405, headers }))
  }

  const metadata = getStaticSiteMetadata(url.pathname)

  if (!staticPaths.has(url.pathname) || !metadata)
    return Responded(new Response('Page not found', { status: 404, headers }))

  const props = AppProps.make({ url, metadata })
  let renderingFailed = false

  const rendered = await Effect.runPromise(
    HtmlServer.renderToHtml(Application, props, { budget: '5 seconds' }).pipe(
      Effect.provideService(MessageLog.MessageLog, {
        enabled: true,
        record: (entry) => {
          if (Predicate.isTagged(entry, 'Failed')) renderingFailed = true
        },
      }),
    ),
  )

  if (renderingFailed || rendered.model === undefined)
    return Responded(
      new Response(`Something went wrong. Request ID: ${requestId}`, {
        status: 500,
        headers,
      }),
    )

  logServerRequest({
    service: 'www',
    requestId,
    route: url.pathname,
    method: request.method,
    release: 'local',
    status: 200,
    durationMs: Math.round(performance.now() - startedAt),
  })

  return Rendered(
    {
      ...rendered,
      serializedProps: serializeAppProps(props),
      extraHead: '',
    },
    { status: 200, headers },
  )
}
