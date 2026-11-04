# Web Sentry

Refs #478. The Foldkit browser app uses the existing `gbfm-frontend` project in `goosebumps-collective`. Access and retained-record queries use the owner's personal Executor connection. This slice does not replace Analytics Engine, server tracing, API instrumentation or existing Grafana alerts.

## Composition and signals

`@gbfm/observability` owns the Effect service, bounded journey contract, timing, terminal-outcome policy, privacy projections and Sentry translation shared with mobile. Only the WWW production adapter, `apps/www/src/observability/sentry.ts`, imports the browser SDK; shared adapter tests also import it to exercise the real transport. Foldkit's client Resources provide the selected Layer; commands require the service rather than importing an SDK or singleton.

`Navigation.Load` observes `navigation` from the start of the page-data request to its final success/failure/interruption, before conversion into Foldkit Messages. This is **request completion**, not committed content, final paint or a completed reader visit. The original value, typed error and interruption are preserved. Cancellations do not create incidents. Failed operations create `NavigationFailed` with a reviewed safe message. Duration and completion metrics use the same instruments as mobile, in the separate web project.

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

No production capture flag or deployment setting was enabled by this change. Production opt-in remains gated on authenticated source-map upload, readable authored stacks and a final privacy review. The installed Vite upload plugin is not configured by this slice; a successful WWW build is not symbolication evidence. Do not expose upload tokens through `VITE_*`.

## Alerts and verification

The **GBFM Web: new and regressed issues** rule (`6289546`) covers first-seen and regressed issues across environments, with a 30-minute per-issue email interval. It targets issue owners with active-member fallback. The existing pull-request-ready alert (`4348577`) is unchanged. Rule creation/read-back does not prove inbox delivery.

Shared tests exercise real Sentry SDK envelopes, secret stripping, Effect TestClock timing, scope cancellation, bounded admission and failed export isolation. `bun run test:www` runs WWW's unit suite. `bun run e2e:observability` in `apps/www` starts a dedicated Vite server and runs disposable Chromium/WebKit transport fixtures with a fake DSN and intercepted delivery, no backend/database or real account needed. GitHub Actions runs those checks on stacked bases as well as `prod`.

Browser fixture evidence proves the production adapter/service composition and SDK transport projection, not a full authenticated Foldkit journey or retained Sentry delivery. Retrieve release-specific spans, completion/duration metrics and a reviewed issue through Executor before claiming delivery. Mobile hardware, native-payload privacy and native-symbol gates remain in [Mobile Sentry](mobile-observability.md).
