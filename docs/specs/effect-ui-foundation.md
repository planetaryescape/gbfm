# Effect UI foundation: verification record

Status: local implementation ready for review, not deployable. The user approved a separate Alchemy provider upgrade after beta.83 failed module loading. Full D1 CI, WebKit, trusted native verification, and remote-state upgrade review remain open. Offline verification is authorized; login, consent, infrastructure planning, and deployment are not.

## Scope

This checkpoint keeps Foldkit as the renderer. It prepares Effect 4.1 compatibility before adding Effect UI.

- Effect and directly declared runtime packages: `4.1.6`.
- Foldkit and UI: `0.170.0`; Vite plugin: `0.29.0`.
- Runtime-only checkpoint retains Alchemy `2.0.0-beta.83` and cannot be promoted independently.
- Separate infrastructure checkpoint upgrades Alchemy and `@alchemy.run/cloudflare` to `2.0.0-beta.87`, without adding a local Alchemy patch.
- The existing password-manager dialog patch is retargeted without changing its contents.
- Crypto moves from `Crypto.Crypto` to `Digest` and `SecureRandom`, preserving token and fingerprint formats.
- No schema changes, production data changes, deployment, policy activation, or OAuth consent changes.

## Baseline

Application baseline: `de889009f0e9016112b0b431b4092e93372985d7`.

Baseline lockfile Git blob: `c42404c28554112b8d994c53a7298fe58d521b2d`.

Environment: Linux/NixOS, Bun `1.4.4`, Node `24.22.1`, Vitest `5.0.5`.

Passed before installing new dependencies:

| Check | Result |
| --- | --- |
| `bun precommit` | Passed; warnings present, no errors |
| `bun run test:www` | 633 tests across 81 files |
| `bun run --cwd apps/www build` | Passed |
| Audio service tests, one worker | Passed |
| Personal-access-key D1 tests, one worker | 22 passed |
| Chromium document and navigation journeys | 9 passed |
| Chromium API-key and real-media ownership journeys | 11 passed |

The crypto implementation was briefly edited while broad baseline checks were running. Those edits were saved and reversed before the serialized audio, personal-access-key, browser, and build baselines above. Overlapping broad runs are not clean baseline evidence.

### Baseline environment failures

- `test:packages` initially stopped because `python3` was missing. Running in `nix-shell -p python3` passed all 45 Alchemy tests and proceeded through shared/mobile checks.
- The overlapping package/server and D1 runs encountered Miniflare timeouts, poisoned stubs, and connection resets. They did not establish a passing full baseline.
- WebKit could not launch because its system libraries are unavailable.
- Playwright's default Chromium executable was absent. Supplying `CHROMIUM_PATH=/etc/profiles/per-user/guidefari/bin/chromium` enabled the passing Chromium checks.
- Browser fixtures used a disposable migrated D1 API on port `3013` and WWW on `5183`. An unrelated service on `3003` was neither reused nor stopped.

## Upgrade evidence collected so far

- `bun install` succeeded and applied the retargeted dialog patch.
- Root, WWW, server, mobile, and shared player resolve the same physical `effect@4.1.6` installation. The lockfile contains one Effect runtime entry.
- Focused dialog, upload, browser-player, and platform-player tests: 46 passed.
- Focused crypto/audio tests passed.
- Personal-access-key D1 tests: 24 passed, including historical-token authentication and deterministic issuance.
- Workspace typechecking identified further Effect 4.1 adaptations in consent matching, playlist failure narrowing, and MCP test harnesses; these were adapted without changing their contracts.
- `test:packages` on Effect 4.1.6 stops at the Alchemy state suite because `alchemy/lib/Auth/OAuthFlow.js` imports the removed Crypto module. Passing application tests cannot substitute for this deployment-tooling gate.
- After the approved beta.87 upgrade, Bun imports of `alchemy` and `@alchemy.run/cloudflare` succeeded without executing a stack.
- The four affected backend D1 files passed 36 tests after the initial API adaptations. A subsequent middleware annotation fix preserves the existing MCP error channel; final workspace typechecking passed.
- `bun precommit` passed for the cumulative runtime and provider changes.
- Full WWW unit tests passed: 634 tests across 81 files. The production WWW build passed.
- Mobile unit/runtime tests passed: 386 tests across 54 files. This is not physical-device evidence.
- An intermediate full package run passed 891/892 server tests. The remaining assertion assumed successful spans were always OpenTelemetry `OK`; Effect 4.1 deliberately defaults to `UNSET`. The test now accepts either exact non-error status shape while retaining empty-event, secret-exclusion, safe-tag, and restored-failure assertions. Production instrumentation is unchanged. See [upstream change](https://github.com/Effect-TS/effect/commit/ec4f2723a5784d315248455f949f6f04e7a0173e).
- The final package rerun passed all 1,614 tests across 199 files, including all 892 server unit/runtime tests, 386 mobile tests, and 63 Alchemy checks.
- Upgraded Mobile Chrome browser journeys passed all 39 tests across document/no-JS/hydration/navigation, API-key issuance/lifetimes and password-manager overlays, real-media ownership/fine seeking, and resumable uploads.
- The broad local D1 run was terminated by `SIGHUP` when its Rex terminal disappeared. No completion marker or passing full-suite result was recorded. CI must complete this gate.

OpenTelemetry dashboards outside this repository that filter exclusively on `OK` need review for `UNSET` success spans. Local captured-export tests do not prove live backend delivery after deployment.

### Provider-upgrade limits

The provider-package split preserves the inspected resource type identifiers, FQN encoding, remote state-key prefixes, and default state-store/secret names. GBFM's source changes only provider import paths; resource declarations and state selection stay unchanged.

The remote state protocol changes from v7 to v8, including bootstrap/upgrade behavior: [beta.83 protocol](https://unpkg.com/alchemy@2.0.0-beta.83/src/Cloudflare/StateStore/Api.ts), [provider beta.87 protocol](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.87/src/StateStore/Api.ts). Offline import, service-construction, and disposable local-state tests cannot prove remote upgrade safety or absence of resource replacements. Review bootstrap/upgrade behavior before requesting authorization for a plan; do not assume planning is read-only. An explicitly authorized infrastructure plan and separate review are required before production promotion.

### Demonstrated regression guards

1. Removing the dialog mount's `allowedOutsideSelectors` forwarding makes the new reacquisition test fail. The other two dialog tests still pass, demonstrating the new coverage.
2. Uppercasing stored/authentication hash encoding makes the historical SHA-256 fixture receive HTTP 401 instead of 200. Fresh issuance/authentication round trips alone would not detect this format break.

Both deliberate mutations were restored.

The provider smoke guard was also mutation-checked: restoring the obsolete `alchemy/Cloudflare` entrypoint import makes the Bun-source loading test fail with subprocess exit code 1. The supported provider import was restored.

## Reproduction

Run long commands and fixture services in named visible Rex tabs. Keep fixture browser suites serialized and use an explicit fixture URL.

For the browser demonstration, start the API in a Rex tab with working directory `apps/server`:

```sh
PORT=3013 FRONTEND_URL=http://127.0.0.1:5183 bun run dev:e2e
```

Start WWW in a separate Rex tab with working directory `apps/www`:

```sh
VPS_PROXY_TARGET=http://127.0.0.1:3013 TURNSTILE_SITE_KEY=1x00000000000000000000AA VITE_SPOTIFY_CLIENT_ID=gbfm-local-e2e bun x vite --host 127.0.0.1 --port 5183 --strictPort
```

These services must be the disposable fixture API and the candidate WWW checkout, not existing production-connected development servers.

```sh
bun precommit
VITEST_MAX_WORKERS=1 nix-shell -p python3 --run 'bun run test:packages'
VITEST_MAX_WORKERS=1 bun run --cwd apps/server test:d1
bun run test:www
bun run --cwd apps/www build
```

Focused checks:

```sh
bun run --cwd apps/server test:unit src/lib/crypto.test.ts src/services/audio.service.test.ts --maxWorkers=1
bun run --cwd apps/server test:d1 src/http/personal-access-keys.d1.test.ts --maxWorkers=1
bun run --cwd apps/www unit src/page/dashboard/page/api-keys/dialog-compatibility.test.ts src/page/creator/upload/runtime.test.ts src/player/runtime.test.ts src/player/runtime.platform-integration.test.ts
CHROMIUM_PATH=/etc/profiles/per-user/guidefari/bin/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5183 bun run --cwd apps/www e2e e2e/document.spec.ts e2e/navigation.spec.ts e2e/api-keys.spec.ts e2e/player-source-ownership.spec.ts --project="Mobile Chrome" --reporter=line
```

Local command logs and exit markers are under `.git/effect-ui-*`, not committed. `/tmp/opencode` is root-owned on this machine, while Rex commands run as `guidefari`; it was not a writable logging destination.

## Review walkthrough

1. `package.json`, `apps/www/package.json`, and `bun.lock`: compatible framework pins and one resolved runtime.
2. `apps/server/src/lib/crypto.ts`: platform-owned digest and secure randomness replace the combined service.
3. `apps/server/src/services/personal-access-keys.ts` and its D1 tests: unchanged externally issued token and persisted hash formats.
4. `apps/server/src/services/audio.service.ts` and its fixed fingerprint test: unchanged canonicalization and digest encoding.
5. `apps/www/src/page/dashboard/page/api-keys/dialog-compatibility.test.ts`: the allowance survives opening and mount reacquisition.

Prediction question: if both key issuance and authentication start using uppercase hashes, which test catches the incompatibility with previously stored keys, and why would a fresh round trip miss it?

This is a compatibility checkpoint, not yet an Effect UI Component migration.

## Remaining gates

- Before promotion, request authorization for an infrastructure plan after reviewing remote-state bootstrap/upgrade behavior, then review any proposed resource changes. The approved provider source upgrade and offline checks are complete.
- Complete full D1 CI for the committed head. Local lint/typecheck, all package and WWW tests, the WWW build, affected D1 checks, and 39 affected Chrome journeys passed; the interrupted full local D1 run is not a substitute for this remaining gate.
- WebKit verification in an environment that can launch it.
- Build, install, and verify the exact candidate on the user's physical iPhone. PR iOS archives disable authenticated symbol upload and do not satisfy the repository's trusted-artifact handoff by themselves. A separately authorized trusted run at the frozen SHA is required before signing/exporting the same archive without a rebuild.
- Check CI results separately from local results.
- Obtain explicit approval before merging into `prod`, which triggers release and deployment.
