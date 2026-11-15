import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'
import { propagatedHeaders } from '@gbfm/observability/propagation'
import * as Sentry from '@sentry/cloudflare'

export const requestWithinServerSpan = (
  request: Request,
  headers = new Headers(request.headers),
) => {
  if (Sentry.isEnabled()) {
    headers.delete('sentry-trace')
    headers.delete('traceparent')
  }

  return new Request(request, { headers })
}

export const normalizeWorkerTraceContext = <Env, QueueMessage>(
  worker: ReturnType<typeof Sentry.withSentry<Env, QueueMessage>>,
) => ({
  ...worker,
  fetch(request: Request, env: Env, context: Parameters<NonNullable<typeof worker.fetch>>[2]) {
    const normalized = new Request<unknown, IncomingRequestCfProperties>(request, {
      headers: propagatedHeaders(request.headers),
    })

    return (
      worker.fetch?.(normalized, env, context) ??
      Promise.resolve(new Response(null, { status: 500 }))
    )
  },
})
