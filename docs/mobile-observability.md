# Mobile Sentry

First slice of #478. Sentry is the mobile application destination, not a second product-analytics service. Existing web/API telemetry, Analytics Engine, Cloudflare persistence, Grafana alerts, and local tracing remain unchanged.

## Setup

The personal Sentry organization is `goosebumps-collective`, with a dedicated `gbfm-mobile` React Native project. Use Executor's existing personal Sentry account for project access and retained-record queries. Do not use the unrelated CLI account or copy authentication tokens into this repository.

Set these build-time variables in the existing local/EAS environment:

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | Client DSN from the mobile project |
| `EXPO_PUBLIC_SENTRY_ENABLED` | Explicit `true` opt-in; absent/false disables collection |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | `development`, `preview`, or `production` |
| `EXPO_PUBLIC_SENTRY_RELEASE` | `gbfm-mobile@` followed by the full 40-character Git SHA |

Missing/invalid DSN or release disables telemetry without preventing app startup. A standalone development verification build must explicitly set environment `development`; a Release binary otherwise defaults to `production`. Native build number supplies the SDK distribution identity. Increment native build numbers for distributed builds, and build a clean committed tree so the SHA identifies the shipped source.

The SDK initializes in `apps/mobile/index.js` before Expo Router. Metro uses Sentry's Expo configuration beneath NativeWind, and the Expo plugin configures native integration and build uploads. This requires a native rebuild, not Expo Go or an OTA-only change.

## Capture policy

The owner explicitly chose **100% error capture and 100% tracing** while traffic is low. Do not silently reduce sampling. Session tracking remains enabled for crash-free-session measurements. Replay, profiling, screenshots, view hierarchy, automatic console logs, and failed-request issue autocapture remain disabled.

Sentry's Expo Router integration owns navigation tracing. Bounded route templates are retained; concrete slugs and parameters are discarded. Custom journey measurements are added separately from automatic navigation, not substituted for it. API trace propagation is deliberately disabled in this first slice; verify and enable it in the client/API correlation follow-up rather than claiming an existing connected waterfall.

## Privacy and delivery

- JavaScript error projection retains release, symbolication metadata, approved exception types, authored frame locations, trace IDs, and bounded journey breadcrumbs. Arbitrary error messages, nested values, request payloads/headers, user identity, local variables, and unknown contexts are discarded. This sacrifices raw error-message detail deliberately; stack locations and reviewed classifications own diagnosis.
- Transaction/span filters remove raw paths, URL queries, SQL, route parameters, and arbitrary attributes. Metric filters admit only the named journey instruments and bounded operation/outcome dimensions, plus validated SDK release/environment attributes.
- There is no `setUser` call or account/content identifier in the signal contract. SDK anonymous session bookkeeping is not an authenticated user identity or a cross-device analytics contract.
- **JavaScript `beforeSend` does not filter native crashes.** Native network/system breadcrumbs and screenshot/view-hierarchy attachments are disabled, but native crash privacy and project-side scrubbing still need a representative review before production opt-in. Do not claim a JavaScript synthetic-secret test proves native payload safety.
- The SDK owns bounded queues. On background/inactive transitions the application requests a two-second client flush; this is best effort, not a delivery guarantee after OS termination. Export failures must not change application results.

## Reading and playback journeys

`@gbfm/observability` owns the Effect `Observability` service and `JourneyExporter` port. The service owns monotonic Effect-clock timing, once-only completion, exporter-failure isolation and cancellation at scope closure. It retains at most 30 outstanding attempts; excess attempts become no-ops until capacity is released. The callback bridge is for synchronous SDK enqueue adapters, not network I/O. Both service and callback APIs share the same completion policy.

The shared Sentry adapter translates this contract into spans, metrics and reviewed exceptions. Shared privacy/config modules import no native SDK. Mobile bootstrap selects the adapter Layer, and its React provider owns the runtime, AppState subscription and final flush. Reader and player components depend on the injected observer, not a Sentry singleton. Closing the runtime cancels outstanding journeys before removing the listener and requesting a bounded flush.

| Operation | Start | Completion |
| --- | --- | --- |
| `reader.open` | A focused reader begins an owned visit | The new request's ready/empty/error state commits in React, or focus/replacement cancels it |
| `playback.start` | An intentional replacement, or first explicit play after paused hydration | Expo confirms the current requested source is playing, reports an error, rejects play, or pause/replacement/disposal cancels the pending attempt |

Reading success means committed content, not an API response or final native paint. Cached content can succeed before background refresh finishes. A later refresh failure does not rewrite that success. Playback measures intentional replacement to the first playing callback, including preparation after replacement but not earlier button/queue work. Paused hydration creates no outstanding attempt; its first explicit play can start one later. Queued callbacks are checked against current native playing/loading state and the requested source generation. Later resume, stalls and interruption recovery are not new initial-start measurements. Expo web does not emit native-project journey measurements; WWW uses its own browser adapter and project.

Each attempt settles once. Stale reader completions are ignored. The sink receives no post/track IDs, content, URLs, credentials, or raw player errors. Final `failed` outcomes create reviewed `ReaderOpenFailed` or `PlaybackStartFailed` issues; `canceled` and `empty` do not create incidents.

- `gbfm.journey.completed`: one counter increment per settled attempt, split by `operation` and `outcome`.
- `gbfm.journey.duration`: duration distribution in milliseconds with the same dimensions.
- `gbfm.journey` span: operation timing and bounded outcome, plus a completion breadcrumb.

Behavior measurements are emitted independently of trace sampling. They remain best-effort device telemetry, not exact visitor counts, an audit trail, or a retention analysis. Use succeeded durations separately from fast failures/cancellations when comparing performance. Outstanding attempts without a terminal callback are not successful completions.

## Symbols and verification

The plugin configures source-map and native-symbol upload. Authenticated upload requires `SENTRY_AUTH_TOKEN` supplied only to the trusted build process through the existing secure environment, never an `EXPO_PUBLIC_*` variable or plugin JSON. Use the same release identity for upload and runtime. Executor account access is not a build-upload token.

For a local compile/install check only, `SENTRY_DISABLE_AUTO_UPLOAD=true` skips upload. A successful build with this flag **does not** prove symbolication. Do not distribute a production build until uploaded artifacts and an authored stack are verified.

Example from a clean committed repository root, with the public DSN and API URL already configured in the ignored mobile environment:

```sh
export EXPO_PUBLIC_SENTRY_RELEASE="gbfm-mobile@$(git rev-parse HEAD)"
export SENTRY_RELEASE="$EXPO_PUBLIC_SENTRY_RELEASE"
export EXPO_PUBLIC_SENTRY_ENVIRONMENT=development
cd apps/mobile
SENTRY_DISABLE_AUTO_UPLOAD=true bunx expo run:ios --device --configuration Release --no-bundler
```

Run `bun precommit` and the mobile suite. Build/install the latest cumulative code on the physical iPhone; simulator or injected-platform tests alone do not satisfy the handoff. Retrieve a known device record through Executor, confirm environment/release, and inspect symbolication and privacy. Do not trigger a native crash on the owner's phone without separate agreement.

## Notifications

The project's **GBFM Mobile: new and regressed issues** alert (`6289429`) covers first-seen and regressed issues at all priorities, across environments, with a 30-minute per-issue notification interval. Email targets issue owners, falling back to active project members. It does not email every repeated occurrence; all occurrences are still captured. The owner's approved replacement disables the new project's default high-priority-only rule (`6289396`) to avoid duplicates. Existing web/API/Grafana rules are unchanged.

Rule read-back is not inbox delivery evidence. Confirm notification receipt for a controlled failed operation or new exception before claiming the alert path verified. No independent uptime coverage is supplied here.

## Sources and follow-ups

The owner's notes on Bluesky and other mobile apps informed early initialization, environment/release context, and complete user-journey boundaries. Their *Building Mobile Apps at Scale* highlights emphasize crash-free sessions, older mobile versions, and profiling overhead. These are design references, not justification for copying a multi-transport logger, introducing other vendors, or inheriting another app's sample rates or thresholds.

- [Sentry Expo setup](https://docs.sentry.io/platforms/react-native/guides/expo/)
- [Native versus JavaScript filtering](https://docs.sentry.io/platforms/react-native/configuration/filtering/)
- [Application metrics](https://docs.sentry.io/platforms/react-native/metrics/)

The shared web slice is documented in [Web Sentry](web-observability.md). Follow-up slices cover client/API correlation, a useful Sentry dashboard, remaining journeys and playback recovery, and approved retirement of old pipelines. #478 remains open until those checks are complete.
