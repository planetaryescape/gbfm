# Web Sentry

Refs #478. The native Effect UI browser app keeps the existing `gbfm-frontend` project in `goosebumps-collective`. Access and retained-record queries use the owner's personal Executor connection. This does not replace Analytics Engine, API instrumentation or existing Grafana alerts. The default native cutover is unmerged and undeployed; local adapter checks are not retained-delivery evidence. See [Effect UI ownership](../EFFECT-UI.md).

## Composition and signals

`@gbfm/observability` owns the Effect service, bounded journey contract, timing, terminal-outcome policy, privacy projections and Sentry translation shared with mobile. The WWW adapter, `apps/www/src/observability/sentry.ts`, imports the browser SDK; adapter tests also import it to exercise transport. `src/app/browser-runtime.ts` composes the selected observability Layer with scoped theme, artwork and browser telemetry lifecycles. Native roots receive that Layer from `entry.effect.client.ts`; feature services use the observability service rather than importing the SDK.

Native `RoutedApplication` reports navigation start/completion through `ReportNavigation` and the pure `src/app/navigation-events.ts` bridge. The browser-only `browserNavigationLayer` turns those events into bounded `navigation` journeys with typed terminal outcomes. It cancels an older journey on replacement, pagehide or scope closure, and does not instrument background page prefetches as navigation. Reader visits still follow their separate committed-DOM contract. These signals do not prove final paint, authenticated delivery or retained production ingestion. Keeping the event producers separate also prevents native SSR from importing the browser Sentry bootstrap.

The web shares reading and initial-playback journey contracts with mobile. `reader.open` starts when a reader destination's loading state commits and settles when ready/empty/error DOM commits, on replacement, or on visibility/disposal cancellation. Initial SSR/cached content can settle immediately; this does not measure server rendering or pre-hydration latency. The scoped `browserReaderLayer` observes only bounded reader-state attributes, never post content, slugs or identity. Native query identity/epoch checks and committed reader request markers must keep stale results from completing a newer visit.

`playback.start` starts at an intentional source replacement and succeeds only on the actual media `playing` event. A paused queue hydration starts no attempt; its first explicit play can start one later. Post-replacement preparation is included, but earlier button/queue work is not. Rejection/native media errors fail the owned attempt; pause, replacement and disposal cancel it. Later resume after initial success is not a second initial start. Web and native adapters use the same shared reader/playback lifecycle modules, while preserving their existing transport and persistence behavior.

Sentry's browser integration supplies page-load/Web Vitals and fetch/XHR tracing. Automatic history-navigation tracing is disabled to avoid claiming that history mutation equals native navigation completion. Errors and traces are captured at 100% after explicit opt-in. Replay, profiling and browser SDK logs remain disabled. Requests and arbitrary paths/attributes are removed by the shared projections; authenticated identity is never set. SDK anonymous session tracking is not cross-device product analytics.

## Distributed tracing

The distributed-tracing follow-up connects browser/mobile → WWW/API → Effect services → D1. Client SDKs send `sentry-trace`, `traceparent` and sampling baggage only to complete first-party/configured origins. Spotify, embeds and media CDNs are excluded. Incoming Sentry/W3C context is normalized at the Worker boundary; conflicting B3 context and unreviewed baggage are removed without changing application headers, bodies or abort ownership.

`apps/www/worker.mjs` imports the generated `dist/server/fetch.js` handler and its `instrumentWorker` export. The native server entry re-exports instrumentation from `src/observability/server.ts`, which uses the Cloudflare SDK's `wrapRequestHandler`. The wrapper owns the HTTP span and request isolation. SSR carries reviewed trace meta tags with the request's rendered page so browser page-load tracing can continue the server parent. API service-binding requests create a `www.api` child and forward its context. Only reviewed `www.request.completed` and `www.request.failed` server logs are admitted, with route templates, request IDs, status, duration and trace correlation. Browser and mobile Sentry Logs remain disabled.

The API parents its Effect HTTP handler under the SDK server span. `apps/server/src/runtime/sentry-tracer.ts` maps Effect spans to Sentry spans and restores the active SDK span at fiber evaluation boundaries through the public `Tracer.context` contract. Current workspace Effect is `4.1.6`; verify the installed adapter before changing this bridge. The earlier workerd/D1 regression established why the bridge is needed to preserve service and database parentage. The native Effect logger's warning/error/fatal forwarding and database sanitization remain unchanged. Local OTLP tracing remains separate and continues normalized incoming context.

Ingress normalization preserves sampled and unsampled decisions, leaves an undecided Sentry parent undecided, and strips conflicting single- and multi-header B3 context. Arbitrary baggage and trace state are discarded. Trace headers are correlation input, never authorization.

Browser and mobile keep their approved 100% trace policy. The API inherits those decisions, so connected client requests now produce more API spans than independently sampled requests did. The owner explicitly chose complete waterfalls over lower API sampling on 2026-11-16. Standalone WWW requests use the existing route-aware sampling policy; a recorded parent still takes precedence. Error capture is independent of trace sampling.

No synthetic dynamic sampling context is created for callers without reviewed baggage. The installed Sentry SDK intentionally freezes an empty context for a continued trace without upstream metadata; normalization does not fabricate project, release or environment metadata for it.

Local verification covers real SDK WWW→API parent links, overlapping request isolation, request-body preservation, sanitized SSR metadata/logs and transport failure isolation. A workerd/D1 fixture proves SDK request → Effect HTTP → service → database parenting and a warning log attached to the service span. These are captured transport/runtime assertions, not proof that the undeployed follow-up is retained in production Sentry.

The deployment entrypoint contract remains `apps/www/worker.mjs` and generated `dist/server/fetch.js`. The native plugin must preserve the default handler and named `instrumentWorker` exports. Recheck those exports and request isolation before changing the build adapter; the B13 default cutover itself is not a deployment.

The three-line ES-module entrypoint imports generated JavaScript that has no type declarations. Application instrumentation remains in typed source; changing the glue file's extension alone would not add type coverage. Disabled deployments bypass the Sentry request wrapper and preserve the original response stream.

Scoped browser Layers own visibility/pagehide listeners and remove them on closure. Reader observation cancels on hide or disposal; player mounts own playback cancellation. The Sentry lifecycle performs a best-effort two-second flush, not a delivery guarantee after tab termination. Do not infer journey-cancellation ordering from flush completion alone. Only synchronous local SDK enqueue adapters are supported by the shared callback bridge; Effect workflows use `observeJourney` directly.

## Build-time settings

| Variable | Value |
| --- | --- |
| `VITE_PUBLIC_SENTRY_DSN` | Existing public frontend DSN deployment input |
| `VITE_SENTRY_ENABLED` | Explicit `true` opt-in, absent/false disables capture |
| `VITE_SENTRY_ENVIRONMENT` | `development`, `preview`, or `production` |
| `VITE_SENTRY_RELEASE` | Optional override: `gbfm-www@` followed by the full source SHA |

The browser and server fallback release is `gbfm-www@<GBFM_BUILD_ID>`. Native configuration derives build identity from `GBFM_BUILD_ID`, `APP_RELEASE`, then `GITHUB_SHA`, with `local` as the development fallback. Runtime instrumentation no longer falls back to `FOLDKIT_BUILD_ID`. A local/generated build ID is not a valid source SHA and leaves collection disabled unless explicitly overridden with a valid release. Missing/invalid DSN or release never prevents application startup. Public DSNs are ingestion addresses, not symbol-upload credentials.

Collection and upload have separate opt-ins. Only `SENTRY_UPLOAD_SOURCEMAPS === 'true'` enables hidden maps and upload. The upload release remains `VITE_SENTRY_RELEASE ?? (APP_RELEASE ? gbfm-www@APP_RELEASE : undefined)`, separate from the runtime build-ID fallback. `SENTRY_AUTH_TOKEN` and a full-SHA WWW release are required, and configuration/upload failure must fail that build. The build plugin targets `dist/client`, uploads hidden client maps only for the client environment, and checks that maps are removed from public assets afterward. The token must never enter `VITE_*`. Ordinary local/PR checks need no upload credentials. Native MCP fixtures explicitly disable collection and upload. Preserving these hooks during native cutover does not prove authenticated upload, ingestion or retained delivery; no upload or deployment is authorized by this documentation update.

## Alerts and verification

The **GBFM Web: new and regressed issues** rule (`6289546`) covers first-seen and regressed issues across environments, with a 30-minute per-issue email interval. It targets issue owners with active-member fallback. The existing pull-request-ready alert (`4348577`) is unchanged. Rule creation/read-back does not prove inbox delivery.

Shared tests exercise real Sentry SDK envelopes, secret stripping, Effect TestClock timing, scope cancellation, bounded admission and failed export isolation. `bun run test:www` runs WWW's unit suite. `bun run e2e:observability` in `apps/www` defines disposable browser transport fixtures with a fake DSN and intercepted delivery, not real-account or retained-delivery checks. Inspect its config before selecting a project: configured Chromium/WebKit projects are not evidence that both browsers are installed or passed. Fixtures cover committed reader outcomes, silent-WAV playback/cancellation/rejection, SSR-parent continuation, first-party propagation, and native navigation outcomes/disposal. These are adapter proofs, not full authenticated journey or production delivery proofs.

Browser fixture evidence proves only the exercised adapter/service composition and SDK transport projection, not a full authenticated native journey or retained Sentry delivery. Retrieve release-specific spans, completion/duration metrics and a reviewed issue through Executor before claiming delivery. Native Vite MCP confirmation is not production-workerd proof. Physical-iPhone, live Spotify and WebKit verification are not implied by native conversion. Mobile hardware, native-payload privacy and native-symbol gates remain in [Mobile Sentry](mobile-observability.md).

Cloudflare alert replacement is separately tracked in [#632](https://github.com/planetaryescape/gbfm/issues/632). This tracing slice does not change Grafana rules, Cloudflare exports, Analytics Engine or alert routing. Connected API traffic inherits the client sampling policy described above. Cutover requires separate approval and verified replacement delivery.
