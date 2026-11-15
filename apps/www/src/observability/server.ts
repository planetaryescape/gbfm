import { telemetryConfig } from '@gbfm/observability/config'
import {
  safeBreadcrumb,
  safeSpan,
  sanitizeError,
  sanitizeTransaction,
} from '@gbfm/observability/privacy'
import { propagatedHeaders, propagatedRequest } from '@gbfm/observability/propagation'
import * as Sentry from '@sentry/cloudflare'

import { routeTemplate } from '../telemetry/privacy'
import { sanitizeServerLog } from './server-logs'

const config = telemetryConfig({
  application: 'www',
  dsn: import.meta.env.VITE_PUBLIC_SENTRY_DSN,
  enabled: import.meta.env.VITE_SENTRY_ENABLED,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  release: import.meta.env.VITE_SENTRY_RELEASE ?? `gbfm-www@${import.meta.env.FOLDKIT_BUILD_ID}`,
  development: import.meta.env.DEV,
})

export const serverTracingOptions: Sentry.CloudflareOptions = {
  ...config,
  sampleRate: 1,
  sendDefaultPii: false,
  enableLogs: true,
  tracePropagationTargets: [],
  integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: 'none' })],
  beforeBreadcrumb: safeBreadcrumb,
  beforeSend: sanitizeError,
  beforeSendSpan: safeSpan,
  beforeSendTransaction: sanitizeTransaction,
  beforeSendLog: sanitizeServerLog,
}

type WorkerContext = NonNullable<Parameters<typeof Sentry.wrapRequestHandler>[0]['context']>

export const instrumentWorker = <Env>(
  handler: { readonly fetch: (request: Request) => Response | Promise<Response> },
  settings: Sentry.CloudflareOptions = serverTracingOptions,
) => {
  Sentry.setAsyncLocalStorageAsyncContextStrategy()

  return {
    fetch(request: Request, _env: Env, context: WorkerContext) {
      const owned = propagatedRequest(request)

      return Sentry.wrapRequestHandler({ options: settings, request: owned, context }, () => {
        const span = Sentry.getActiveSpan()

        if (span)
          Sentry.updateSpanName(
            span,
            `${request.method} ${routeTemplate(undefined, new URL(request.url).pathname)}`,
          )

        return handler.fetch(owned)
      })
    },
  }
}

export const logServerRequest = (attributes: {
  readonly service: string
  readonly requestId: string
  readonly route: string
  readonly method: string
  readonly release: string
  readonly status: number
  readonly durationMs: number
}) => {
  if (!Sentry.isEnabled()) return

  if (attributes.status >= 500) Sentry.logger.error('www.request.failed', attributes)
  else Sentry.logger.info('www.request.completed', attributes)
}

export const serverTraceMeta = () => {
  if (!Sentry.isEnabled()) return ''
  const data = new Headers()

  for (const [name, value] of Object.entries(Sentry.getTraceData()))
    if (value !== undefined) data.set(name, value)
  const headers = propagatedHeaders(data)

  return ['sentry-trace', 'baggage']
    .flatMap((name) => {
      const content = headers.get(name)

      return content ? [`<meta name="${name}" content="${content}">`] : []
    })
    .join('')
}

export const traceApiRequest = (
  request: Request,
  send: (request: Request) => Promise<Response>,
) => {
  if (!Sentry.isEnabled()) return send(propagatedRequest(request))

  return Sentry.startSpan(
    {
      name: 'www.api',
      op: 'http.client',
      attributes: { 'http.request.method': request.method, 'service.name': 'www' },
    },
    async (span) => {
      const headers = new Headers(request.headers)
      const context = span.spanContext()
      const traceData = Sentry.getTraceData()

      for (const [key, value] of Object.entries(traceData)) headers.set(key, value)
      headers.set(
        'traceparent',
        `00-${context.traceId}-${context.spanId}-${context.traceFlags & 1 ? '01' : '00'}`,
      )
      const response = await send(new Request(request, { headers: propagatedHeaders(headers) }))
      Sentry.setHttpStatus(span, response.status)

      return response
    },
  )
}
