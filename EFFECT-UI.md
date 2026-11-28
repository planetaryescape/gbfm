# Effect UI in GBFM

WWW uses native Effect UI Components and SSR. This is implementation guidance for the unmerged, undeployed conversion branch, not a claim about production. Historical Foldkit and React checkpoints remain in `docs/specs/` and `docs/archive/`.

## Installed versions and patch

Check the installed packages and lockfile before using upstream examples:

- `@effect/ui` and `@effect/ui-kit` are pinned to the `87a704b` pkg.pr.new artifacts in [apps/www/package.json](apps/www/package.json). The installed UI package reports `0.0.0`; the artifact revision, not that version string, identifies its API.
- Effect is `4.1.6`; Alchemy and `@alchemy.run/cloudflare` are `2.0.0-beta.87`. Root overrides keep workspace versions aligned.
- [package.json](package.json), [bun.lock](bun.lock), and the committed [UI hydration patch](patches/@effect%252Fui@https%253A%252F%252Fpkg.pr.new%252FEffect-TS%252Fui%252F@effect%252Fui@87a704b.patch) form one dependency contract. Use `bun install --frozen-lockfile` when installation is authorized. Do not regenerate the lockfile or replace the artifact to resolve a frozen-install failure.

The patch changes both `src/html/HtmlHydrate.ts` and `dist/html/HtmlHydrate.js`. It preserves a textarea's existing text child during initial hydration instead of deleting its SSR content. Keep both halves and the textarea hydration regression when upgrading. A source-only patch does not protect consumers of the compiled SDK.

## Components, queries and services

[RoutedApplication](apps/www/src/app/routed-application.ts) owns the site shell. Components declare schema-backed props, model and messages. `update` handles those messages and returns state changes and commands; the view derives HTML from that state. Keep network requests and DOM lifetimes out of view construction.

- `Query.Service` owns reads. [GetPage](apps/www/src/app/page-query.ts) declares decoded page results, typed failures, staleness and retention. Component query declarations select arguments from the current model and props; views handle pending, success and failure through `AsyncResult`.
- `Command.Service` owns requested effects and invalidation. Its Layer supplies the implementation. Commands are not a second mutable store.
- `Mount.make` and `Mount.makeStream` own element-bound work. Use scoped acquisition and finalizers for listeners, observers, widget instances, editor/media handles and pending work. Argument changes and unmount must not let a stale completion update a new owner.
- Provide HTTP clients, player adapters and feature services through Layers at the owning root or provider. SSR supplies request-local services and server-safe implementations; the browser supplies browser implementations.

For concrete examples, follow [the player provider](apps/www/src/features/player/provider.ts), [API-key issuance](apps/www/src/features/dashboard/api-keys.ts), and [the signup challenge mount](apps/www/src/features/signup-challenge/mount.ts). Preserve their ownership and cleanup contracts when changing presentation.

## Routing and bootstrap

[AppRoute](apps/www/src/app/route.ts) describes native routes. The server supplies `Router.static`; the browser supplies `BrowserRouter.layer`. The routed root subscribes to location changes, selects page-query arguments and retains app-wide providers across page changes. Do not add a parallel router or restore the legacy flags/messages navigation protocol.

[entry.effect.server.ts](apps/www/src/entry.effect.server.ts) loads and prepares the requested page before rendering. [Bootstrap](apps/www/src/app/bootstrap.ts) is a Schema-validated union, not arbitrary flags:

- `routed` carries the initial URL, metadata, identity and request realm. SSR seeds the initial `GetPage` result.
- `credential` uses a standalone root for token-bearing password-reset, subscribe and unsubscribe URLs. Public bootstrap and metadata omit the token; credential handling stays outside routed query state.
- `spotify-callback` uses its own root and service Layer. Do not route callback credentials through the general page cache.

[entry.effect.client.ts](apps/www/src/entry.effect.client.ts) decodes props and hydration state, selects the same root and awaits hydration adoption before marking the document hydrated. Its scoped Layer owns browser support and disposal.

### Identity and request isolation

`GetPage` arguments include path, principal identity/known state/epoch, and realm. The realm starts from the SSR request ID. Browser page reads are same-origin, use session credentials and `cache: no-store`, and validate the returned document and identity. Private or authenticated navigation rechecks identity rather than trusting a previous page.

Server page Layers and HTTP clients belong to one request. Do not share rendered state, authenticated query results, principals or request clients across requests or browser roots. Preserve stale-result rejection and the narrow public-only retained-content rules; do not turn them into authenticated cache reuse.

## Server document and build boundary

[server/effect-ui/document.ts](apps/www/src/server/effect-ui/document.ts) owns the complete HTML document. It combines native rendered head/body attributes, request-owned extra head metadata, serialized state/props, and asset URLs supplied by the build adapter. [prepare-page-response.ts](apps/www/src/server/prepare-page-response.ts) prepares page metadata and headers. Keep redirects, data and action responses as responses rather than rendering them into the page shell.

Metadata travels with the rendered page, not through a process-global current-page variable. Preserve escaping, credential projection, trace metadata and no-JavaScript styling.

The B13 default cutover is implemented on this branch: [vite.config.ts](apps/www/vite.config.ts) owns the native server/client entries and `dist/client` plus `dist/server`. [vite.effect.config.ts](apps/www/vite.effect.config.ts) only re-exports that config for existing command paths; it creates no second runtime or output tree. App workerd preview reads `dist`; the isolated fixture build keeps `dist-effect-fixture`. The earlier app `dist-effect` preview tree is retired as an active output contract.

The dev proxy preserves `VPS_PROXY_TARGET || VITE_VPS_BASE_URL || 'http://127.0.0.1:3003'`, with `GBFM_FRONTEND_FIXTURE_BASE` as the explicit fixture override. Keep ordinary browser API traffic same-origin so session cookies are preserved; do not expose a dev-only proxy target as a browser API origin.

[worker.mjs](apps/www/worker.mjs) remains the Worker entrypoint and preserves the generated server handler import contract. Build IDs come from explicit build/release inputs, not random config-evaluation values. Preserve Sentry opt-in and full-source-SHA release validation. See [Web Sentry](docs/web-observability.md) for collection and upload boundaries.

The default cutover has not been merged or deployed. Legacy Foldkit sources, packages and its UI patch are removed on this branch after assertion and consumer closure; see the [retirement evidence map](docs/specs/effect-ui-retirement-evidence.md). Final post-retirement build/browser results belong to the cutover PR. A local native build or workerd check is not production delivery. MCP uses its dedicated native HTTPS Vite fixture config with collection and source-map upload explicitly disabled. Those consent fixtures prove that adapter only, not the production Worker.

## Layout and presentation

- `src/app/`: roots, routing, bootstrap, page queries, hydration and browser composition.
- `src/features/`: stateful native Components, providers, commands and managed mounts.
- `src/ui/`: shared native presentation, links, artwork, icons and rich-content rendering.
- `src/domain/`: decoded data and feature contracts.
- `src/server/`: HTTP dispatch, page loading, response preparation and native document rendering.
- `src/page/`: retained loaders, service adapters and migration-era modules. A file's presence here does not make its legacy renderer the active owner.

`@gbfm/theme` owns shared tokens and CSS. `@effect/ui-kit` supplies dialog/popover primitives; compose them with the owning Component's messages and state. Keep accessible focus, dismissal, scroll locking and keyboard behavior. Preserve native selects, sliders and disclosures when they suffice. The API-key password-manager allowance is deliberately narrow, not permission to disable modal isolation.

See [Design System](docs/design-system.md). React remains in Expo mobile, email templates and social-image rendering, not the WWW view layer. The [React inventory](docs/archive/react-www-features.md) and [rich-content specification](docs/specs/rich-content.md) retain their historical context.

## Maintainer checks

Use Bun for repository commands. [apps/www/package.json](apps/www/package.json) lists the current typecheck and browser commands. Typecheck the normal app, native fixtures and Bun browser scripts separately. [test/tsconfig.effect-ui-browser-scripts.json](apps/www/test/tsconfig.effect-ui-browser-scripts.json) adds Bun/Node CLI types without adding them to the DOM-facing project.

Run DOM/browser regressions through their dedicated Playwright configs and disposable fixtures, not as Node-only unit tests. Preserve user-facing assertions when retiring framework markers. A fixture pass does not imply WebKit availability, physical-device coverage, live Spotify behavior, symbol upload or retained telemetry delivery.

For slow transitions, distinguish browser navigation, WWW requests, API spans and rendering. Local Jaeger and Loki request IDs can correlate server work; a slow SSR trace alone does not prove the same client-transition delay. Native navigation events are telemetry boundaries, not proof of final paint. See [Web Sentry](docs/web-observability.md) for the remaining signal gaps.
