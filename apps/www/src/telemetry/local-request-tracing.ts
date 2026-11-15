import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { propagatedRequest, remoteTraceContext } from '@gbfm/observability/propagation'
import { Data, Effect, Layer, ManagedRuntime, Tracer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { OtlpSerialization, OtlpTracer } from 'effect/observability'

import { routeTemplate } from './privacy'

class RequestTracingFailure extends Data.TaggedError('RequestTracingFailure') {
  readonly message = 'WWW request failed'
}

/** Local SSR spans use the API's OTLP exporter and propagate W3C context without recording URLs or payloads. */
export const createLocalRequestTracing = (endpoint: string) => {
  const runtime = ManagedRuntime.make(
    OtlpTracer.layer({
      url: endpoint,
      resource: { serviceName: 'goosebumps-fm-www' },
      exportInterval: '250 millis',
      shutdownTimeout: '2 seconds',
    }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer)),
  )

  return {
    dispose: () => runtime.dispose(),
    trace: <Result extends { readonly status?: number }>(
      request: Request,
      run: (request: Request) => Promise<Result>,
    ) => {
      const route = routeTemplate(undefined, new URL(request.url).pathname)
      const requestId = resolveRequestId(request.headers.get('x-request-id'))
      const parent = remoteTraceContext(request.headers)

      return runtime.runPromise(
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan
          const traced = propagatedRequest(request)
          traced.headers.set('x-request-id', requestId)
          traced.headers.set(
            'traceparent',
            `00-${span.traceId}-${span.spanId}-${span.sampled ? '01' : '00'}`,
          )
          traced.headers.set(
            'sentry-trace',
            `${span.traceId}-${span.spanId}-${span.sampled ? '1' : '0'}`,
          )
          traced.headers.delete('b3')

          const response = yield* Effect.tryPromise({
            try: () => run(traced),
            // Raw failures may contain OAuth codes, cookies or request bodies.
            catch: () => new RequestTracingFailure(),
          })

          yield* Effect.annotateCurrentSpan('http.response.status_code', response.status ?? 200)

          return response
        }).pipe(
          Effect.withSpan(`www ${request.method} ${route}`, {
            ...(parent ? { parent: Tracer.externalSpan(parent) } : undefined),
            attributes: {
              'http.request.method': request.method,
              'http.route': route,
              'gbfm.request_id': requestId,
            },
          }),
        ),
      )
    },
  }
}

const localTracing = createLocalRequestTracing(
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'http://127.0.0.1:4318/v1/traces',
)

export const traceLocalRequest = localTracing.trace

import.meta.hot?.dispose(() => localTracing.dispose())
