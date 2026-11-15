# GBFM observability runbook

Cloudflare persists production Worker logs and native traces and exports them to the Planetaryescape observability stack. Sentry is a separate application telemetry path, with error, trace, and metric support depending on the runtime and its enablement gates. It is not an errors-only integration. Do not assume that an SDK integration proves production ingestion, or use Sentry traces to infer Cloudflare service-binding propagation.

The configuration below was checked against the repository on 2026-11-15. Source configuration and live backend evidence are identified separately.

## Ownership and data flow

| Surface | Owner | Purpose |
| --- | --- | --- |
| Workers Logs, traces, runtime metrics, and Query Builder | Cloudflare dashboard | WWW/API request investigation and native binding spans |
| Exported Worker traces and logs | Hetzner Tempo and Loki, queried through Grafana or the private Kubernetes service proxy | Retained Worker telemetry and cross-request investigation |
| D1 metrics and query insights | Cloudflare dashboard | Database diagnosis |
| Browser application errors, traces, and metrics | Sentry | WWW application and navigation investigation when the browser enablement gates pass |
| API application errors, traces, and logs | Sentry | Enabled for `prod` / `production` when a DSN is configured |
| Mobile errors, native crashes, traces, and metrics | Sentry | Conditional on mobile build-time enablement; separate from Worker telemetry |
| `gbfm_api_<stage>` | API Worker | Bounded request availability and latency points |
| `gbfm_www_<stage>` | WWW Worker | Sampled browser navigation, CWV, error, and player points |
| `/dashboard/frontend-errors` | GBFM admin | Curated 24-hour browser/product aggregates only |
| Grafana Alerting | `hetzner-observability` / Flux | Sustained API error, latency, and collector-health alerts |

The platform owner is the first responder. Application owners investigate the affected route/provider. Escalate to the Cloudflare account owner when native logs, traces, Analytics Engine, D1 metrics, or Email delivery are unavailable across otherwise healthy Workers.

Every deployment uses one immutable `APP_RELEASE` (the Git SHA in CI) across WWW, API, direct Workers, structured logs/spans, and Analytics Engine points. Grafana alerts aggregate across releases. WWW validates or creates `x-request-id`, forwards it through the API service binding, and both Workers return it. Search `gbfm.request_id` or `requestId` to correlate application records; Cloudflare native trace context owns the WWW → API → D1/service-binding waterfall.

## What the code enables

- **Cloudflare production Workers:** `alchemy/observability.ts` enables persisted logs and traces with `headSamplingRate: 1`, invocation logs, and the `planetaryescape-logs` / `planetaryescape-traces` export destinations. Non-production configuration persists logs and traces without those destinations.
- **API Worker Sentry:** `apps/server/src/worker.ts` wraps handlers with `Sentry.withSentry`, enables Sentry logs, sanitizes errors and spans, and uses the shared trace sampler. `apps/server/src/runtime/sentry-worker.ts` connects Effect spans directly to the active Sentry context through `sentry-tracer.ts`, preserving service/database parentage without registering a second OpenTelemetry provider. This is separate from Cloudflare's native tracing.
- **API enablement:** `alchemy/api.ts` sets `SENTRY_ENVIRONMENT: config.stage`; the production stage is `prod` in `alchemy/stage.ts`. `shouldEnableSentry` in `apps/server/src/lib/sentry.ts` accepts both `prod` and `production` with a nonempty DSN. Other environments remain opt-in for the Bun runtime; the Worker does not pass the force argument. Before this fix, only `production` was accepted, disabling Sentry with the declared `prod` binding. Verify deployment of the fix and recent Sentry events before claiming production ingestion.
- **API trace sampling when enabled:** `packages/core/src/observability/trace-sampling.ts` supplies rates of 1% for health/crawler-noise paths, 100% for `/api/music/resolve`, 50% for the configured business-route pattern, and 20% otherwise. The SDK uses `inheritOrSampleWith`, so an inherited sampling decision can take precedence. These rates do not describe Cloudflare native trace sampling.
- **Connected trace sampling:** browser/mobile retain their approved 100% policy, and the API inherits those decisions for complete waterfalls. This increases API span volume for client-originated requests; the owner explicitly accepted that trade-off on 2026-11-16. Standalone WWW requests use the same route-aware policy as the API, while preserving parent decisions.
- **WWW browser/server Sentry:** `apps/www/src/observability/sentry.ts` captures sanitized errors, spans, breadcrumbs, and application metrics. Browser tracing is enabled and automatic navigation instrumentation is disabled. First-party trace propagation, SSR metadata, and service-binding parentage are described in [Web Sentry](web-observability.md#distributed-tracing). Browser Sentry logs and session replay remain disabled; the server admits only reviewed request-completion/failure logs. `packages/observability/src/config.ts` requires an explicit enable flag, a valid HTTPS DSN, and a release matching `gbfm-www@<40-character Git SHA>`; enabled clients use `tracesSampleRate: 1`. A DSN alone is insufficient.
- **Mobile Sentry:** `apps/mobile/src/observability/sentry.ts` uses the same configuration gates with a `gbfm-mobile@<Git SHA>` release. It enables native crash handling, application telemetry and first-party trace propagation, but disables logs, profiling, replay, screenshots and view hierarchy. Latest-build hardware and retained-waterfall verification are separate gates.
- **Bun API runtime:** `apps/server/src/lib/otel.ts` can attach an OTLP exporter alongside Sentry and adds a local collector in local/dev stages. This Node SDK setup is not the production Worker export path.

Browser Sentry source maps are uploaded to `goosebumps-collective/gbfm-frontend` by `apps/www/plugins/sentry.ts` when upload is enabled, then removed from public assets. This identifies the browser upload project, not proof that API transactions reach that project.

## Privacy contract

Application-owned telemetry may contain bounded route templates, method, status, duration, service, release, browser family, a rotating random 24-hour browser session ID, and sanitized browser error fingerprints. It must not contain authenticated identity, email, IP, secrets, authorization/cookie headers, raw URLs or query strings, raw SQL/parameters, or raw browser stacks. Provider spans use provider/system and operation metadata rather than credentials or response bodies.

Cloudflare's automatic instrumentation has a separate schema. Retained native traces inspected on 2026-11-15 include URL/query/header metadata and `db.query.text` attributes. Application sanitizers do not establish that these native fields are removed from exports. Treat backend trace responses as sensitive: inspect only the needed fields, redact paths to route templates in reports, and do not dump raw URLs, queries, headers, or SQL. The application privacy contract is not proof of native-export privacy.

Browser ingestion enforces a versioned schema, exact production origin, native rate limit, streamed 16 KiB body limit, bounded names/routes, and server-side release stamping. The application sampling probability is written with each point; all Analytics Engine aggregates must weight both `_sample_interval` and that probability.

## Investigate an incident

1. Open **Workers & Pages → Observability** in Cloudflare and select the affected production Worker.
2. Start with runtime metrics: invocation/error rate, wall/CPU duration, and status distribution. Compare the incident window to the prior window.
3. In **Logs** or **Query Builder**, filter by `requestId`, route template, release, service, or status. Never broaden the schema by logging the raw request URL.
4. Open the matching native trace. Inspect WWW → API service-binding propagation and automatic fetch, D1, R2, KV, queue, Durable Object, and Email spans. Application Effect spans annotate material Spotify, Bandcamp, storage, scraping, and email work.
5. For database symptoms, open **D1 → production database → Metrics**. Check query count, rows read/written, latency, and errors. Use the native D1 spans to identify the application operation; do not add raw SQL to logs.
6. For browser/product symptoms, open `/dashboard/frontend-errors`. An unavailable card means that Analytics Engine query failed; an empty card means no weighted events matched the 24-hour window. Use Cloudflare operational views for server diagnosis rather than duplicating them in admin.
7. Confirm the release shown by WWW, API, and browser points is the deployed Git SHA. Grafana alerts cover a time window across releases; use logs and traces to compare releases within that window.
8. For browser, mobile, or API application symptoms, inspect Sentry after confirming the runtime's enablement gates, environment, release, and recent event timestamps. For API symptoms, verify that the deployed version accepts the `prod` binding before treating missing Sentry transactions as evidence of healthy traffic.

Workers logs and traces retain seven days on the Paid plan. Analytics Engine retains three months. Export destinations remain enabled in addition to Cloudflare persistence, but incident response must work from Cloudflare alone.

## Alerts

Grafana owns alert evaluation and notifications. Flux provisions its rules from
[`hetzner-observability`](https://github.com/planetaryescape/hetzner-observability/blob/main/docs/alerting.md).
GBFM emits telemetry and does not run an alert-evaluation Worker.

- **API errors:** more than 0.5% HTTP 5xx or failed Cloudflare outcomes across a
  15-minute window, at least 100 observed server spans, sustained for 10 minutes.
- **API latency:** histogram p95 above 1,000 ms with the same sample floor and
  pending period.
- **Collector health:** both collector scrape targets must be available.

These rules use exported HTTP server spans across releases, not the former
Analytics Engine eligibility filters. Missing or low-volume API data preserves
the prior alert state. Recovery has a five-minute hold. Grafana sends grouped
notifications through Cloudflare's HTTPS Email Sending API.

Repeated firing emails are not necessarily separate slow incidents. A notification with `grafana_state_reason = NoData, KeepLast` and `A=-1, B=-1` preserves the previous state without a current latency measurement. Separate these from measured p95 values and from recovery notifications.

The live production server-span metric series inspected on 2026-11-15 expose method, status, colo, and outcome, but no route label; their span names are methods such as `GET`. Consequently, the service-wide histogram cannot rank endpoints. Use route-bearing traces or structured request logs to identify endpoints, then compare latency and request volume over the same window. Do not attribute scheduled jobs or child-span duration to HTTP request p95.

For Tempo, start with `{ resource.service.name = "gbfm-api-prod-yphgo2gectab2vz5" && kind = server && duration > 1s }`, scoped to the incident window. Confirm the deployed Worker name before reusing this filter. A limited search returns examples, not a complete endpoint ranking. Native server spans inspected here carry `url.path` rather than `http.route`; normalize dynamic path segments before grouping or reporting. Compare `d1_all` elapsed duration with `cloudflare.d1.response.sql_duration_ms` and the request waterfall. Large binding elapsed time with small SQL execution time does not by itself establish a slow SQL query.

Browser LCP, INP, and CLS collection and admin aggregates remain available, but
automated browser Web Vitals alerts have no Grafana replacement yet. Independent
uptime monitoring is deferred to
[Uptime Kuma issue #20](https://github.com/planetaryescape/hetzner-observability/issues/20).

The former evaluator package, Worker declaration, and drill were removed. Its
`TelemetryEvaluatorState` KV namespace remains declared with a retain policy to
preserve historical incident data. The Analytics Engine query credential remains
in use by the API's browser telemetry aggregates.

Assessing Cloudflare Monitors and Workers Issues as replacements for GBFM's Grafana rules is tracked in [#632](https://github.com/planetaryescape/gbfm/issues/632). No existing alert or export is removed by the Sentry distributed-tracing slice. Verify account-level dataset access, low-traffic/no-data behavior, recovery and actual notification delivery before an approved cutover.

## First seven days: volume and cost review

Production starts with log and trace head sampling at 1 (100%). For each of the first seven UTC days after rollout, record:

1. **Workers & Pages → account usage:** log events written, trace spans, and projected overage. Paid Workers include 20 million observability events per month; Workers Logs retain seven days. Tracing shares this event pricing starting October 1, 2026.
2. Analytics Engine writes for `gbfm_api_prod` and `gbfm_www_prod`, including the effective 10% browser application sample.
3. Per-Worker invocation volume and unusually chatty application log/span producers.
4. D1 rows read/written and storage under **D1 → Metrics → Row Metrics**.

The platform owner records the daily numbers in the rollout issue. On day 7, retain 100% only if projected volume is acceptable. Otherwise change `headSamplingRate` for logs and traces in `alchemy/observability.ts`, preserving enough traffic for request correlation and rare errors, then deploy normally. This is the rollback/cost control; do not disable persistence or remove observability bindings.

Browser sampling is independently controlled by the production rate in the WWW browser telemetry collector. Change it only from measured Analytics Engine volume, and keep the per-point application sample rate so weighted queries remain correct.

At day 30, recalculate availability, API p95, CWV distributions, and minimum-volume gates from production data. Record and review any objective changes before changing the Grafana rules in the infrastructure repository.

## Deployment verification

After an approved production deployment:

1. Send one request with a unique valid `x-request-id` to WWW that causes an API read.
2. Find the WWW and API completion records by that ID, then open the native trace and confirm the service-binding/API/D1 waterfall.
3. Confirm both records and the browser point use the deployed Git SHA.
4. Exercise a controlled server error. In Cloudflare, verify its stack resolves to authored TypeScript. Alchemy builds direct Workers with hidden/private source maps; no public JavaScript response may include a `sourceMappingURL`, and map files must not be publicly fetchable.
5. Confirm Grafana can query current API span metrics and that the provisioned rules evaluate without datasource errors.

Production smoke requests and source-map resolution are post-deployment checks. They cannot be claimed from a local build.

## Private desktop access

Use Tailscale for the private Kubernetes API at `https://100.76.1.36:6443`. Keep credentials outside the repository, in a mode-0600 kubeconfig. Prefer an existing read-only observer identity for investigation rather than copying administrator credentials. The observer can query backend service proxies but cannot read Secrets or modify workloads.

On the configured desktop, use the explicit context file so unrelated Kubernetes contexts are not changed:

```bash
kubectl --kubeconfig "$HOME/.kube/hetzner-observer.yaml" get pods -n observability
kubectl --kubeconfig "$HOME/.kube/hetzner-observer.yaml" \
  get --raw '/api/v1/namespaces/observability/services/tempo:3200/proxy/api/search?limit=3'
kubectl --kubeconfig "$HOME/.kube/hetzner-observer.yaml" \
  get --raw '/api/v1/namespaces/observability/services/kube-prometheus-stack-prometheus:9090/proxy/api/v1/label/__name__/values'
```

Access was verified on 2026-11-15 by listing observability pods, retrieving retained GBFM traces from Tempo, and querying Prometheus span metrics. Checks for reading Secrets and patching deployments both returned `no`. This verifies backend access and retained data, not complete coverage of every application signal. No cluster workloads or public exposure were changed.

## References

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs retention and pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)
- [Analytics Engine limits and retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
