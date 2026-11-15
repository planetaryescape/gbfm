import { propagatedRequest } from '@gbfm/observability/propagation'
import * as Sentry from '@sentry/cloudflare'

export const requestWithinServerSpan = (request: Request) => {
  const headers = new Headers(request.headers)

  if (Sentry.isEnabled()) {
    for (const [name, value] of Object.entries(Sentry.getTraceData({ propagateTraceparent: true })))
      if (value !== undefined) headers.set(name, value)
  }

  return propagatedRequest(new Request(request, { headers }))
}
