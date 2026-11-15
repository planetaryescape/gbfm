import { submitLocalRequestLog } from '@gbfm/core/observability/local-loki'
import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { Effect, Predicate } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { logServerRequest } from './observability/server'
import { apiRequest, endpointFor } from './server/api'
import { renderResponse } from './server/request-dispatch'
import { routeTemplate } from './telemetry/privacy'

export { apiRequest, endpointFor }

export { renderDocument } from './server/document'

export { instrumentWorker } from './observability/server'

/** One request-owned correlation ID covers SSR, actions, redirects, and API forwarding. Logs exclude raw URLs and payloads. */
export const renderPage = async (request: Request): Promise<Server.EntryResult> => {
  const startedAt = performance.now()
  const requestId = resolveRequestId(request.headers.get('x-request-id'))
  const owned = new Request(request)
  owned.headers.set('x-request-id', requestId)

  const attributes = {
    service: 'www',
    requestId,
    route: routeTemplate(undefined, new URL(request.url).pathname),
    method: request.method,
    release: import.meta.env.PROD ? (import.meta.env.FOLDKIT_BUILD_ID ?? 'unversioned') : 'local',
  }

  try {
    const run = async (request: Request) => {
      const result = await renderResponse(request)

      return {
        result,
        status: Predicate.isTagged(result, 'Responded')
          ? result.response.status
          : (result.status ?? 200),
      }
    }

    const { result, status } = import.meta.env.DEV
      ? await (await import('./telemetry/local-request-tracing')).traceLocalRequest(owned, run)
      : await run(owned)

    const headers = new Headers(
      Predicate.isTagged(result, 'Responded') ? result.response.headers : result.headers,
    )

    headers.set('x-request-id', requestId)
    logServerRequest({
      ...attributes,
      status,
      durationMs: Math.round(performance.now() - startedAt),
    })
    await Effect.runPromise(
      Effect.logInfo({
        ...attributes,
        operation: 'request.completed',
        status,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    )

    if (import.meta.env.DEV && new URL(request.url).pathname !== '/telemetry/browser')
      submitLocalRequestLog({
        service: 'www',
        method: request.method,
        route: attributes.route,
        requestId,
        status,
        durationMs: Math.round(performance.now() - startedAt),
      })

    return Predicate.isTagged(result, 'Rendered')
      ? Server.Rendered(result.application, { status, headers })
      : Server.Responded(
          new Response(result.response.body, {
            status,
            statusText: result.response.statusText,
            headers,
          }),
        )
  } catch (cause) {
    if (request.signal.aborted) throw cause
    logServerRequest({
      ...attributes,
      status: 500,
      durationMs: Math.round(performance.now() - startedAt),
    })
    await Effect.runPromise(
      Effect.logError({
        ...attributes,
        operation: 'request.failed',
        status: 500,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    )

    if (import.meta.env.DEV && new URL(request.url).pathname !== '/telemetry/browser')
      submitLocalRequestLog({
        service: 'www',
        method: request.method,
        route: attributes.route,
        requestId,
        status: 500,
        durationMs: Math.round(performance.now() - startedAt),
      })

    return Server.Responded(
      new Response(`Something went wrong. Request ID: ${requestId}`, {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'private, no-store',
          'x-request-id': requestId,
        },
      }),
    )
  }
}
