# Web Sentry

Refs #478. The Foldkit browser app uses the existing `gbfm-frontend` project in `goosebumps-collective`. Access and retained-record queries use the owner's personal Executor connection. This slice does not replace Analytics Engine, server tracing, API instrumentation or existing Grafana alerts.

## Composition and signals

`@gbfm/observability` owns the Effect service, bounded journey contract, timing, terminal-outcome policy, privacy projections and Sentry translation shared with mobile. Only the WWW production adapter, `apps/www/src/observability/sentry.ts`, imports the browser SDK; shared adapter tests also import it to exercise the real transport. Foldkit's client Resources provide the selected Layer; commands require the service rather than importing an SDK or singleton.

`Navigation.Load` observes `navigation` from the start of the page-data request to its final success/failure/interruption, before conversion into Foldkit Messages. This is **request completion**, not committed content, final paint or a completed reader visit. The original value, typed error and interruption are preserved. Cancellations do not create incidents. Failed operations create `NavigationFailed` with a reviewed safe message. Duration and completion metrics use the same instruments as mobile, in the separate web project.

The web now observes the same reading and initial-playback journeys as mobile. `reader.open` starts when a reader destination's loading state commits and settles when ready/empty/error DOM commits, on replacement, or on visibility/disposal cancellation. Initial SSR/cached content can settle immediately; this does not measure server rendering or pre-hydration latency. A root resource observes only bounded state attributes, never post content, slugs or identity. Stale loads rejected by the real Foldkit model cannot complete a newer visit.

`playback.start` starts at an intentional source replacement and succeeds only on the actual media `playing` event. A paused queue hydration starts no attempt; its first explicit play can start one later. Post-replacement preparation is included, but earlier button/queue work is not. Rejection/native media errors fail the owned attempt; pause, replacement and disposal cancel it. Later resume after initial success is not a second initial start. Web and native adapters use the same shared reader/playback lifecycle modules, while preserving their existing transport and persistence behavior.

Sentry's browser integration supplies page-load/Web Vitals and fetch/XHR tracing. Automatic history-navigation tracing is disabled to avoid claiming that history mutation equals Foldkit navigation completion. Errors and traces are captured at 100% after explicit opt-in. Replay, profiling and browser SDK logs remain disabled. Requests and arbitrary paths/attributes are removed by the shared projections; authenticated identity is never set. SDK anonymous session tracking is not cross-device product analytics.

## Distributed tracing

The distributed-tracing follow-up connects browser/mobile → WWW/API → Effect services → D1. Client SDKs send `sentry-trace`, `traceparent` and sampling baggage only to complete first-party/configured origins. Spotify, embeds and media CDNs are excluded. Incoming Sentry/W3C context is normalized at the Worker boundary; conflicting B3 context and unreviewed baggage are removed without changing application headers, bodies or abort ownership.

`apps/www/worker.mjs` wraps Foldkit's generated handler using the Cloudflare SDK's `wrapRequestHandler`. The wrapper owns the HTTP span and request isolation. SSR emits reviewed trace meta tags so browser page-load tracing continues the server parent. API service-binding requests create a `www.api` child and forward its context. Only reviewed `www.request.completed` and `www.request.failed` server logs are admitted, with route templates, request IDs, status, duration and trace correlation. Browser and mobile Sentry Logs remain disabled.

The API parents its Effect HTTP handler under the SDK server span. `apps/server/src/runtime/sentry-tracer.ts` maps Effect spans to Sentry spans and restores the active SDK span at fiber evaluation boundaries. This uses Effect 4.0.6's public `Tracer.context` contract, matching the context hook in the installed `@effect/opentelemetry` adapter. The installed Cloudflare SDK 10.76.2 OpenTelemetry shim otherwise flattens service and database spans into siblings. Restoring the old bridge makes the workerd/D1 parentage regression fail. The native Effect logger's warning/error/fatal forwarding and database sanitization remain unchanged. Local OTLP tracing remains separate and continues normalized incoming context.

Ingress normalization preserves sampled and unsampled decisions, leaves an undecided Sentry parent undecided, and strips conflicting single- and multi-header B3 context. Arbitrary baggage and trace state are discarded. Trace headers are correlation input, never authorization.

Local verification covers real SDK WWW→API parent links, overlapping request isolation, request-body preservation, sanitized SSR metadata/logs and transport failure isolation. A workerd/D1 fixture proves SDK request → Effect HTTP → service → database parenting and a warning log attached to the service span. These are captured transport/runtime assertions, not proof that the undeployed follow-up is retained in production Sentry.

The production WWW entrypoint is `apps/www/worker.mjs`, which wraps Foldkit 0.169.0 / Vite plugin 0.28.0's generated `{ fetch }` handler. Recheck its exported `instrumentWorker` and generated handler contract before a framework upgrade.

The runtime owns visibility/pagehide listeners and removes them on scope closure. Pending journeys are canceled before the final two-second flush. Background flushes are best effort, not delivery guarantees after tab termination. Only synchronous local SDK enqueue adapters are supported by the callback bridge used on mobile; Effect workflows use `observeJourney` directly.

## Build-time settings

| Variable | Value |
| --- | --- |
| `VITE_PUBLIC_SENTRY_DSN` | Existing public frontend DSN deployment input |
| `VITE_SENTRY_ENABLED` | Explicit `true` opt-in, absent/false disables capture |
| `VITE_SENTRY_ENVIRONMENT` | `development`, `preview`, or `production` |
| `VITE_SENTRY_RELEASE` | Optional override: `gbfm-www@` followed by the full source SHA |

Without an override, release is `gbfm-www@<FOLDKIT_BUILD_ID>`. The existing production build supplies `APP_RELEASE=<github.sha>` to Foldkit, so this uses the shipped source identity. A local/generated build ID is not a valid source SHA and leaves collection disabled unless explicitly overridden. Missing/invalid DSN or release never prevents application startup. Public DSNs are ingestion addresses, not symbol-upload credentials.

Trusted Release and Alchemy deployment builds now explicitly enable browser capture, supply the existing DSN, and request source-map upload with the existing `SENTRY_AUTH_TOKEN`. Uploads require a full-SHA WWW release and fail the build when configuration or authenticated upload fails. Hidden client maps are uploaded only for the client build and deleted from public assets afterward; the token is never exposed through `VITE_*`. Ordinary PR/local builds do not receive upload credentials. A manual Release run on the feature branch verifies the real token/upload path without releasing or deploying, because those jobs require a push to `prod`.

## Alerts and verification

The **GBFM Web: new and regressed issues** rule (`6289546`) covers first-seen and regressed issues across environments, with a 30-minute per-issue email interval. It targets issue owners with active-member fallback. The existing pull-request-ready alert (`4348577`) is unchanged. Rule creation/read-back does not prove inbox delivery.

Shared tests exercise real Sentry SDK envelopes, secret stripping, Effect TestClock timing, scope cancellation, bounded admission and failed export isolation. `bun run test:www` runs WWW's unit suite. `bun run e2e:observability` in `apps/www` starts a dedicated Vite server and runs disposable Chromium/WebKit transport fixtures with a fake DSN and intercepted delivery, no backend/database or real account needed. The eight cases cover navigation, committed reader outcomes, actual silent-WAV media playback/cancellation/rejection, SSR-parent continuation and first-party-only propagation. GitHub Actions runs those checks on stacked bases as well as `prod`.

Browser fixture evidence proves the production adapter/service composition and SDK transport projection, not a full authenticated Foldkit journey or retained Sentry delivery. Retrieve release-specific spans, completion/duration metrics and a reviewed issue through Executor before claiming delivery. Mobile hardware, native-payload privacy and native-symbol gates remain in [Mobile Sentry](mobile-observability.md).

Cloudflare alert replacement is separately tracked in [#632](https://github.com/planetaryescape/gbfm/issues/632). This tracing slice does not change Grafana rules, Cloudflare exports, Analytics Engine, alert routing or existing sampling rates. Cutover requires separate approval and verified replacement delivery.
