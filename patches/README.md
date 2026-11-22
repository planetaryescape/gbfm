# Dependency patches

The Spotify SDK comes from JSR as `@planetaryescape/opensound`, with browser helpers at `/browser`. The SDK contains the stable `effect/http` imports and nullable album-track preview fix that previously required local patches for npm 0.6.7.

The remaining patches are declared in the root `package.json`. Validate dependency changes with `bun precommit`, the Spotify service and shared-package tests, mobile Spotify tests, and WWW's `e2e/spotify.spec.ts`. The browser test exercises PKCE, profile loading and disconnect through the real adapter using disposable fixtures.
