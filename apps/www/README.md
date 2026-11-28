# `@gbfm/www`

Native Effect UI renders public pages on the server and keeps the application shell and audio player alive across client navigation. Components, queries and service Layers own browser state and effects. The Cloudflare Worker forwards API requests through its `API` service binding; browser credentials remain same-origin. See [EFFECT-UI.md](../../EFFECT-UI.md) for ownership and pinned framework guidance.

## Development and verification

From the repository root:

```sh
bun run --cwd apps/www dev
bun precommit
bun run --cwd apps/www unit
bun run --cwd apps/www build
```

`VPS_PROXY_TARGET` selects the development API origin (default `http://127.0.0.1:3003`). Do not set a browser API origin: it would bypass the same-origin session cookie. `VITE_SPOTIFY_CLIENT_ID` configures Spotify PKCE.

Newsletter subscriptions and account signup require Turnstile. For local development, explicitly set `TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's official always-pass test widget). Playwright config sets this for its web server; when using `PLAYWRIGHT_BASE_URL`, configure the existing web server yourself. The disposable local API accepts only the official dummy token; production uses its configured real sitekey and server-side validation, never a browser bypass. The public sitekey is read by SSR and passed through the request-owned page document, not a build-time secret.

The default Vite configuration uses the native adapter with request-local SSR state, not a model cached across visitors. Builds emit `dist/client` and `dist/server`, preserving the Worker hosting contract. `vite.effect.config.ts` remains a compatibility alias for that same configuration, not a second renderer. This conversion branch is unmerged and undeployed.

Browser tests use `PLAYWRIGHT_BASE_URL` and an optional `CHROMIUM_PATH`. `bun run --cwd apps/server dev:e2e` starts the disposable, migrated D1 fixture API, including local creator/admin/listener accounts. This does not seed a shared database. Set `FRONTEND_URL` to the test web origin and `PORT` to the API port; point the web process's `VPS_PROXY_TARGET` at that API. Then run `bun run --cwd apps/www e2e`.

## Observability

Every server request receives an `x-request-id`, also forwarded to the API. Completion/failure logs use bounded route names and exclude request bodies, cookies and raw URLs. Browser telemetry covers navigation, Web Vitals and player events.

In Vite development, Effect exports SSR spans to `http://127.0.0.1:4318/v1/traces`. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to select another local collector. The request's W3C `traceparent` reaches downstream API requests. Export is batched, and Vite module disposal flushes/closes the tracer. Production does not bundle this local exporter: Cloudflare logs/traces are configured in `alchemy/observability.ts`. Local export tests are not proof of production ingestion or alert delivery.

## Changelog

The repository root `CHANGELOG.md` is the only source of truth. `plugins/repo-changelog.ts` parses it into the shared inert rich-content document exposed by `virtual:repo-changelog` and watches it in development. The native server page loader supplies it only to the changelog route. Do not create a second tracked changelog copy.
