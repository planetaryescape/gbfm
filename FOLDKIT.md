# Foldkit in GBFM

The WWW app uses Foldkit 0.169.0 (`apps/www/package.json`). Before changing its runtime or navigation, compare the installed `node_modules/foldkit` source and `@foldkit/vite-plugin` with the current [Foldkit AI overview](https://foldkit.dev/ai/overview). The website offers Markdown at `/ai/overview.md` and an index at `/llms.txt`. Do not assume examples from `main` match this installed release.

The Model owns state, Messages describe events, `update` returns a Model and Commands, and `view` describes the UI. Runtime owns external work through Commands, Subscriptions, Mounts, Flags, Resources, and ManagedResource. Follow a navigation from `apps/www/src/entry.client.ts` through `apps/www/src/update.ts` and `apps/www/src/command.ts`, then into `apps/www/src/entry.server.ts` for server data requests. Keep side effects out of `view` and stateful behavior in the owning submodel.

## UI primitives

`@gbfm/theme` owns shared tokens and CSS. WWW owns shared presentation in `apps/www/src/view/`; feature and page submodels own state, messages, and behavior. There is no shared React web UI package or component playground. See [Design System](docs/design-system.md) for visual guidance. React remains in mobile, email templates, and social-image rendering.

Use the pinned `@foldkit/ui` 0.169.0 primitives for dialogs and popovers. Mobile navigation, search, playback, publish review, and account actions fold their primitive Models and Messages into the owning submodel. Keep the dialog mounted while closed so its Commands can manage native modal focus and scroll locking. Preserve native selects, sliders, and disclosures when they already provide the required behavior.

`patches/@foldkit%2Fui@0.169.0.patch` exposes the modal engine's existing `allowedOutsideSelectors` option through `Dialog.init`, opening Commands and resource-acquisition Mounts. The API-key password dialog allows only `com-1password-button` and `com-1password-menu`; all other dialogs retain their existing defaults. Without this allowance, modal isolation makes body-mounted 1Password overlays inert, so clicks pass through to the controls underneath. Keep the allowance narrow and retain background isolation. Browser regressions exercise a body-mounted closed-shadow popup overlapping a dialog button, not only an overlay outside `body`. Revisit the patch when upgrading Foldkit.

## Server document

`apps/www/worker.ts` wraps the generated Foldkit fetch entry in production. It
forwards the exact `/mcp.txt` path to the API before Foldkit classifies static
misses, since Foldkit 0.169.0 rejects `.txt` paths without calling `renderPage`.
All other requests retain the generated handler and its missing-asset behavior.

`src/server/document.ts`, re-exported by `src/entry.server.ts`, owns the whole HTML document. The Vite plugin supplies browser asset URLs from `ssr.clientEntry`; styles are imported by `src/entry.client.ts`. There is no `index.html` template or production `transformIndexHtml` hook. Page responses stay `Server.Rendered` until the host renders the document; data, actions, and redirects use `Server.Responded`. Request-specific escaped head markup follows its application object through a WeakMap, so concurrent pages cannot overwrite each other's metadata.

Production uses Foldkit's compiled, coordinated build identity. Do not generate a random ID at Vite config evaluation time: separate environment evaluations can give the client and server different IDs. Explicit `FOLDKIT_BUILD_ID` or `APP_RELEASE` values still identify deployments; dev passes an explicit ID because it uses separate plugins. The document links the source stylesheet in dev so pages remain styled with JavaScript disabled.

## Layout

`apps/www/src` follows Foldkit's [Project Organization](https://foldkit.dev/patterns/project-organization):

- Root modules (`init`, `model`, `message`, `update`, `view`, `route`, `command`, `subscription`) sit directly in `src/`.
- Each route owns a folder in `src/page/<name>/`. A stateful page splits into `model`, `message`, `command`, `init`, `update`, `subscription`, and `view`, adding a file only when the page has that concern. Its main view is exported as `view`.
- `page/<name>/index.ts` and `page/index.ts` are barrels only. The root `view.ts` calls pages through `import * as Page from './page'`.
- Root `model`, `message`, `update`, `init`, `command`, and `subscription` import a submodel's own folder (`./page/creator`), never the `./page` barrel. Pages import the root `Message`, so going through the barrel creates a circular import.
- Sub-screens of a page nest under `page/<name>/page/`, as in `page/dashboard/page/`.
- Server loaders live beside their page as `page-data.ts` and stay out of the barrel, so server code never reaches the client bundle. `server/page-data/` holds only dispatch and shared helpers.
- App-wide submodels that are not routes (`player`, `search`, `public-actions`) sit at the `src/` root. Shared view helpers live in `src/view/`.

## Diagnosing slow transitions

For a slow transition, separate browser navigation time, WWW request time, API spans, and client rendering. Local WWW and API traces go to Jaeger (`https://jaeger.localhost`); search `gbfm.request_id` and compare with the response `x-request-id`. Local request summaries are in Grafana's Loki datasource. A slow SSR trace alone does not prove the same delay in a client transition.

Foldkit also offers [agent skills](https://foldkit.dev/ai/skills) and a [DevTools MCP](https://foldkit.dev/ai/mcp) for Model and Message history. This repo has not yet vendored the pinned framework source or installed that MCP. Use the installed packages and version-matched docs now; add the subtree or runtime bridge only when the extra tooling earns its maintenance cost.
