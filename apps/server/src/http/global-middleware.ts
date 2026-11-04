import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { Effect, Exit, Layer, Option } from 'effect'
import { HttpMiddleware, HttpRouter, HttpServerError, HttpServerRequest } from 'effect/http'

import { browserOrigins } from '@/lib/browser-origins'
import { checkPerformanceHealth, recordRequest } from '@/lib/performance-monitoring'
import { ConfigService } from '@/services/config.service'
import { RequestTelemetry } from '@/services/request-telemetry.service'
import { SentryService } from '@/services/sentry.service'

// Step 8 (docs/migration-effect-http-api.md): the global concerns that used
// to be Hono middleware in apps/server/src/lib/create-app.ts, ported to
// Effect's global HttpRouter.middleware -- global (not endpoint-scoped)
// because CORS/logging/defect-reporting need to cover every route including
// better-auth and the plain HttpRouter routes in site-routes.ts, not just
// HttpApiBuilder endpoints. Rate limiting (OPS-248) was dropped from this
// list: it moved to Cloudflare's edge Rate Limiting rules, see
// docs/migrations/postgres-to-d1.md's "Rate limiting" subsection.

// ── CORS ──────────────────────────────────────────────────────
// Matches apps/server/src/lib/create-app.ts's corsConfig exactly. The old Hono
// origin() function never actually rejects -- it falls back to the
// production origin for any unrecognized Origin header rather than omitting
// the CORS headers -- so this uses the predicate form of allowedOrigins
// (not a fixed array) to reproduce that exact fallback behavior rather than
// Effect's own array-mode "omit the header for unknown origins" semantics.
export const CorsLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ConfigService

    return HttpRouter.middleware(
      HttpMiddleware.cors({
        allowedOrigins: browserOrigins(config.urls.frontend),
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'MCP-Protocol-Version',
          'Mcp-Method',
          'Mcp-Name',
          'Cookie',
          'Refresh-Token',
          'x-captcha-response',
          'sentry-trace',
          'baggage',
          'b3',
          'traceparent',
        ],
        exposedHeaders: ['Set-Cookie', 'WWW-Authenticate'],
        credentials: true,
      }),
      { global: true },
    )
  }),
)

export const requestPath = (url: string) => new URL(url, 'http://localhost').pathname

// ── Performance metrics + slow-request warnings ──────────────────
// Request events are emitted here so the application has one structured
// request-log producer. HttpRouter's built-in logger is disabled in routes.ts
// to avoid a second response line. Slow-request warnings and the
// recordRequest/checkPerformanceHealth Effect Metrics remain separate events.
const SLOW_REQUEST_THRESHOLD = 500

const VERY_SLOW_REQUEST_THRESHOLD = 2000

export const RequestLoggerLive = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const requestId = resolveRequestId(request.headers['x-request-id'])

      const start = Date.now()
      const result = yield* Effect.exit(httpEffect)
      const duration = Date.now() - start
      const routeContext = yield* Effect.serviceOption(HttpRouter.RouteContext)

      const route = Option.match(routeContext, {
        onNone: () => '/unmatched' as const,
        onSome: ({ route }) => route.path,
      })

      const telemetry = yield* RequestTelemetry

      const annotate = (status: number, outcome: string) =>
        Effect.all([
          telemetry.record({
            method: request.method,
            route,
            requestId,
            status,
            durationMs: duration,
          }),
          Effect.annotateCurrentSpan({
            'gbfm.request_id': requestId,
            'gbfm.release': telemetry.release,
            'service.name': 'api',
            'http.request.method': request.method,
            'http.route': route,
            'http.response.status_code': status,
            'http.request.duration_ms': duration,
            'http.request.outcome': outcome,
          }),
        ])

      if (Exit.isFailure(result)) {
        // Match the HTTP boundary's conversion without swallowing the original failure.
        const [response] = yield* HttpServerError.causeResponse(result.cause)
        const status = response.status
        const clientAborted = status === 499
        const outcome = clientAborted ? 'client_abort' : status >= 500 ? 'failure' : 'success'
        const log = status >= 500 ? Effect.logError : Effect.logInfo
        yield* log(clientAborted ? '[HTTP] client aborted request' : '[HTTP] request failed', {
          method: request.method,
          route,
          requestId,
          status,
          duration,
          // Raw causes can serialize request headers, bodies, URLs, and arbitrary error messages.
          failureKinds: result.cause.reasons.map((reason) => reason._tag),
          outcome,
          release: telemetry.release,
          service: 'api',
        })

        yield* annotate(status, outcome)

        if (clientAborted) yield* recordRequest(duration, false)

        return yield* Effect.failCause(result.cause)
      }

      const response = result.value
      yield* Effect.logInfo('[HTTP] request completed', {
        method: request.method,
        route,
        requestId,
        status: response.status,
        duration,
        outcome: response.status >= 500 ? 'failure' : 'success',
        release: telemetry.release,
        service: 'api',
      })

      if (duration > VERY_SLOW_REQUEST_THRESHOLD) {
        yield* Effect.logError('[Performance] Very slow request detected', {
          method: request.method,
          route,
          requestId,
          status: response.status,
          duration,
          threshold: VERY_SLOW_REQUEST_THRESHOLD,
          severity: 'critical',
          release: telemetry.release,
          service: 'api',
        })
      } else if (duration > SLOW_REQUEST_THRESHOLD) {
        yield* Effect.logWarning('[Performance] Slow request detected', {
          method: request.method,
          route,
          requestId,
          status: response.status,
          duration,
          threshold: SLOW_REQUEST_THRESHOLD,
          severity: 'warning',
          release: telemetry.release,
          service: 'api',
        })
      }

      yield* annotate(response.status, response.status >= 500 ? 'failure' : 'success')
      yield* recordRequest(duration, response.status >= 400)
      yield* checkPerformanceHealth

      return response
    }),
  { global: true },
)

// ── Defect → Sentry capture ──────────────────────────────────────
// The old Hono app.onError (create-app.ts) was the only place that reported
// uncaught errors to Sentry for anything reachable through the Hono app --
// but per docs/migration-effect-http-api-process.md's step-8 findings, no
// equivalent has ever existed on the Effect side: HttpApiBuilder's
// Effect.withErrorReporting feeds Effect's own ErrorReporter mechanism,
// which this app never registers a reporter for, so it silently no-ops.
// Effect.tapDefect here is the actual fix -- it runs on every global
// middleware-wrapped route (HttpApiBuilder endpoints AND plain HttpRouter
// routes like site-routes.ts/betterAuthRoute), closing a real gap that
// predates this specific PR.
export const SentryDefectLive = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.tapDefect((defect) =>
        Effect.gen(function* () {
          const sentry = yield* SentryService
          yield* sentry.captureException(defect)
        }),
      ),
    ),
  { global: true },
)
