# Web Sentry

Refs #478. The Foldkit browser app uses the existing `gbfm-frontend` project in `goosebumps-collective`. Access and retained-record queries use the owner's personal Executor connection. This slice does not replace Analytics Engine, server tracing, API instrumentation or existing Grafana alerts.

## Composition and signals

`@gbfm/observability` owns the Effect service, bounded journey contract, timing, terminal-outcome policy, privacy projections and Sentry translation shared with mobile. Only the WWW production adapter, `apps/www/src/observability/sentry.ts`, imports the browser SDK; shared adapter tests also import it to exercise the real transport. Foldkit's client Resources provide the selected Layer; commands require the service rather than importing an SDK or singleton.

`Navigation.Load` observes `navigation` from the start of the page-data request to its final success/failure/interruption, before conversion into Foldkit Messages. This is **request completion**, not committed content, final paint or a completed reader visit. The original value, typed error and interruption are preserved. Cancellations do not create incidents. Failed operations create `NavigationFailed` with a reviewed safe message. Duration and completion metrics use the same instruments as mobile, in the separate web project.

The web now observes the same reading and initial-playback journeys as mobile. `reader.open` starts when a reader destination's loading state commits and settles when ready/empty/error DOM commits, on replacement, or on visibility/disposal cancellation. Initial SSR/cached content can settle immediately; this does not measure server rendering or pre-hydration latency. A root resource observes only bounded state attributes, never post content, slugs or identity. Stale loads rejected by the real Foldkit model cannot complete a newer visit.

`playback.start` starts at an intentional source replacement and succeeds only on the actual media `playing` event. A paused queue hydration starts no attempt; its first explicit play can start one later. Post-replacement preparation is included, but earlier button/queue work is not. Rejection/native media errors fail the owned attempt; pause, replacement and disposal cancel it. Later resume after initial success is not a second initial start. Web and native adapters use the same shared reader/playback lifecycle modules, while preserving their existing transport and persistence behavior.

Sentry's browser integration supplies page-load/Web Vitals and fetch/XHR tracing. Automatic history-navigation tracing is disabled to avoid claiming that history mutation equals Foldkit navigation completion. Errors and traces are captured at 100% after explicit opt-in. Replay, profiling, SDK logs and cross-service trace propagation are not enabled. Requests and arbitrary paths/attributes are removed by the shared projections; authenticated identity is never set. SDK anonymous session tracking is not cross-device product analytics.

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

Shared tests exercise real Sentry SDK envelopes, secret stripping, Effect TestClock timing, scope cancellation, bounded admission and failed export isolation. `bun run test:www` runs WWW's unit suite. `bun run e2e:observability` in `apps/www` starts a dedicated Vite server and runs disposable Chromium/WebKit transport fixtures with a fake DSN and intercepted delivery, no backend/database or real account needed. The six cases cover navigation, committed reader outcomes and actual silent-WAV media playback/cancellation/rejection. GitHub Actions runs those checks on stacked bases as well as `prod`.

Browser fixture evidence proves the production adapter/service composition and SDK transport projection, not a full authenticated Foldkit journey or retained Sentry delivery. Retrieve release-specific spans, completion/duration metrics and a reviewed issue through Executor before claiming delivery. Mobile hardware, native-payload privacy and native-symbol gates remain in [Mobile Sentry](mobile-observability.md).
