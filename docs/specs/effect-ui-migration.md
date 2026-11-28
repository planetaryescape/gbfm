# Effect UI migration: delivery checkpoints

Status context: this specification records the migration plan and earlier checkpoints, including foundation PR #640 and `migration/effect-ui-ssr`. Current native ownership and the unmerged, undeployed B13 default cutover on `migration/effect-ui-default-cutover` are documented in [EFFECT-UI.md](../../EFFECT-UI.md). Historical steps below are not a current dual-renderer architecture map. Physical-iPhone verification is explicitly deferred; production planning and deployment remain unauthorized.

Inspected baseline: `de889009f0e9016112b0b431b4092e93372985d7` on `prod`.

## Goal

Replace WWW's Foldkit runtime with Effect UI while preserving GBFM's behavior. Deliver short, reviewable GitHub PR stacks with a runnable checkpoint, one primary learning topic, and evidence for each changed contract.

This document is a plan, not verification evidence. Checkpoint results must be recorded separately with resolved versions and commands.

The [retirement evidence map](effect-ui-retirement-evidence.md) links original framework assertions to retained native witnesses, records approved behavior differences, and identifies unresolved gates.

## Decisions and constraints

- Use Effect UI Components for local state, queries for fetched data, and Providers for intentionally shared mutable state.
- Retain the existing API contracts, playback engine, Cloudflare hosting, resource identities, and state ownership.
- Upgrade Alchemy and its separate Cloudflare provider to `2.0.0-beta.87` in a distinct infrastructure checkpoint. Runtime checks disproved beta.83 compatibility: it imports the removed Crypto module. The user selected the provider upgrade rather than a local backport. No infrastructure plan or deployment is authorized.
- Pin preview UI packages to one commit, initially `87a704b`, rather than moving `main`.
- Preserve authentication, authorization, revision checks, retry identities, draft privacy, public URLs, status codes, metadata, and no-JS readable content.
- Do not introduce shared public HTML caching, progressive SSR streaming, database migrations, or new backend architecture as part of this migration.
- Never serialize credentials, server bindings, session tokens, or internal-only query results. Every settled Effect UI query entry can enter hydration state, including failures and entries not displayed.
- Keep request identity and SSR query state request-owned. Browser cache keys and invalidation must account for account changes.
- Production deployment and merging into `prod` require explicit confirmation.

### Approved favorite-state differences, 2026-11-27

The user explicitly selected **Keep safer native behavior** for five conflicts with literal legacy assertions:

- Page and Player controls share one pending membership intent. A correctly correlated acknowledgement settles that intent for both controls instead of leaving a separate stale retry store.
- Other membership writes wait while the listener's revision-owned write is pending. Do not start competing writes against the same observed revision.
- Explicitly unknown identity suspends prior-account membership and private playback access until independent verification. Ordinary page loading alone does not revoke a still-validated global identity.
- A matched current 401 suspends identity rather than inventing a confirmed anonymous session. Superseded failures cannot invalidate a newer owner.
- Independently confirmed signed-out state shows Sign in, not an unavailable-membership error or an unnecessary membership lookup.

These are approved state/timing differences, not permission to discard the remaining behavioral assertions. Preserve native witnesses for exact retry identity, account/target/revision correlation, private-output suspension, stale-result rejection and confirmed sign-out.

## Stack topology and production boundary

Opening a PR runs `.github/workflows/ci.yml`. It does not invoke the production deployment workflow. A push to `prod`, including a PR merge, runs `release.yml`, which dispatches `alchemy-deploy.yml` after validation.

Consequently, review checkpoints are not automatically production checkpoints.

Proposed topology:

1. Create a non-deploying integration branch, proposed name `migration/effect-ui`, from the accepted baseline.
2. Foundation PR 1 targets the integration branch. A separate provider-upgrade checkpoint completes its Alchemy compatibility dependency. Do not promote the runtime-only prefix or merge it into `prod`.
3. Each migration stack's first PR targets that integration branch; subsequent PRs target their predecessor.
4. Review incremental diffs and merge bottom-up into the integration branch. Retarget descendants and rerun checks after ancestor merges. Avoid rewriting published history without coordinating first.
5. Open a separate promotion PR from the integration branch to `prod` only when its complete reachable route set is production-ready. Previously reviewed PRs provide the reading map; cumulative checks verify the exact promotion head.

The foundation branch exists locally. No promotion PR exists. Do not push preliminary migration work directly to `prod`. Ordinary CI currently has no branch filter on `pull_request`, but GitHub rules and required checks still need inspection before publishing the stack.

Temporary route dispatch may choose Foldkit or Effect UI. Across that boundary, a document navigation can interrupt playback. That is acceptable only on the unpromoted integration branch, not as an unannounced production regression. Before promotion, prove continuity across every reachable boundary or complete the route migration so the boundary is removed.

## Intended architecture

```text
Worker request
  -> existing auth/actions/API/redirect dispatch
  -> request-owned identity and data services
  -> Effect UI Component tree and query cache
  -> document head, HTML, safe hydration state, asset URLs
  -> Response with status, cookies and private cache policy

Browser
  -> hydrate the same tree and query results
  -> persistent application shell and player
  -> Router changes page Components
  -> queries fetch through same-origin API adapters
```

Server data adapters retain `src/server/api.ts`'s service-binding path and request/cookie/abort/trace propagation. Browser adapters retain same-origin HTTP. No raw Worker binding enters Component props or Models.

Use `HtmlServer.renderToHtml` in the request-owned handler rather than capturing current-user services in a globally shared `HtmlServerHttp.layerHttp` Layer.

The default SSR wait budget is not an SEO policy. Required page content, missing-record decisions, and metadata need explicit behavior on timeout. Browser-only Commands must not become the source of server-rendered content.

## PR checkpoints

### Stack 1: dependency foundation

#### PR 1: Effect 4.1 compatibility without a renderer change

Delivered: the existing application works on Effect `4.1.6`.

Scope:

- Align existing Effect runtime packages: platform Bun/Node/browser, OpenTelemetry, and mobile atom-react.
- Temporarily upgrade Foldkit and its UI package to `0.170.0`, and its Vite plugin to `0.29.0`, for declared Effect 4.1 compatibility.
- Adapt `apps/server/src/lib/crypto.ts`, personal-access-key and audio services, and their tests to the new crypto services.
- Port the narrow dialog overlay patch; preserve background isolation and password-manager interaction.
- Audit callback streams and resource cleanup. Source comparison of 4.0.6 and 4.1.6 found unchanged callback registration/scoping behavior, so no timing adaptation is planned.
- Keep database schema, key format, and audio fingerprint format unchanged.
- Deliver the approved Alchemy provider-package upgrade as a separately reviewed infrastructure commit/checkpoint. Preserve resource identities, state backend and state selection, bindings, and provider ownership. Verify module loading and disposable local state offline; a reviewed infrastructure plan remains a promotion prerequisite, not an authorized action.

Acceptance:

- Fixed-input crypto tests demonstrate identical key-hash and audio-fingerprint bytes/encoding. Previously issued fixture keys still authenticate; issuance/revocation remain safe.
- Existing package, WWW and D1 tests pass, and WWW builds.
- Browser document/hydration, player lifecycle, upload, and dialog regressions pass.
- Mobile checks pass and the verified build is installed and checked on the user's physical iPhone before the mobile-impacting checkpoint is complete.
- Inspect the resolved dependency graph for incompatible duplicate Effect runtimes; do not hide conflicts with broad overrides.

Review: this is compatibility preparation, not an Effect UI lesson. Show the exact runtime and crypto differences and the unchanged observable contracts.

### Stack 2: a real SSR-to-navigation slice

#### PR 2: first Component, document, and Worker hydration

Delivered: an existing simple public route, proposed `/about`, renders and hydrates with Effect UI on the integration branch.

Owners: `apps/www/vite.config.ts`, `worker.mjs`, `src/entry.server.ts`, `src/entry.client.ts`, `src/server/document.ts`, `src/server/page-response.ts`; proposed Component modules follow the existing page layout.

Scope:

- Add commit-pinned `@effect/ui` and `@effect/ui-kit`; add matching DevTools when wired, not as a prerequisite.
- Add `@effect/vitest@4.1.6` for Component tests. Existing Vitest need not upgrade solely to satisfy its peers.
- Establish explicit server/client builds and asset resolution without assuming a Foldkit-generated handler for the new route.
- Preserve the document shell, styles, theme initialization, request correlation, and HTTP dispatch outside the renderer.
- Add migration browser checks to CI. Keep existing observability checks.

Acceptance:

- Production-built output serves through local workerd, with a disposable fixture API binding.
- GET and HEAD, assets, error status, canonical/robots metadata, and no-JS content behave as intended.
- Gate browser JS, capture server DOM, release JS, and prove adoption plus a working interaction without page errors.
- Add a focused Component behavior test and show it fail when the protected transition is broken.
- CI exercises the actual browser contract, not just the test host.

Learn: a Component owns its Model and Messages instead of the parent storing and forwarding child state.

#### PR 3: query-backed public content

Delivered: one public data-backed route, proposed the mixes listing, gets SSR and browser data through the same query declaration.

Owners: the route's page modules, `src/server/api.ts`, proposed shared query definitions and server/browser adapter Layers, and the request renderer.

Acceptance:

- Initial HTML contains fixture content and correct metadata, not only a loading shell.
- Browser network evidence shows no redundant initial content fetch for a settled, fresh SSR query. Later refetch policy is tested separately.
- Missing, failed, and deadline-exceeded reads have deliberate HTML/status/head behavior.
- Concurrent SSR requests for fixture users A and B cannot exchange Models, query results, metadata, or cookies.
- Hydration state contains no seeded secret sentinels, including in failed or unused query results.
- Browser account changes cannot reuse another principal's private results.

Learn: server data belongs in the query cache, not in manually maintained `status`, `results`, and root `Flags` fields.

#### PR 4: navigation between migrated pages

Delivered: migrated routes support direct requests, browser navigation, and back/forward, including head synchronization.

Owners: `src/route.ts`, root composition, `src/command.ts`, `src/update.ts`, `src/page-cache.ts`, and page query declarations. Remove old loading machinery only for consumers actually migrated.

Acceptance:

- Direct URL, refresh, click, back/forward, query-string changes, redirects, and unknown routes are correct.
- Delay response A, navigate to B, release A, and prove B's content and head remain current.
- Prefetch and navigation share the intended cache entry without crossing account boundaries.
- A visible checkpoint demonstrates the full SSR -> hydrate -> navigate path.
- Playback continuity across mixed-renderer boundaries remains explicitly unproven until PR 5 and the route-boundary gate.

Learn: Router and Component queries replace root page replacement and URL-wide `__data` bookkeeping.

Record the hosting evidence and walkthrough, then continue through the remaining page conversions. Review checkpoints do not pause delivery.

### Stack 3: persistent behavior

| PR  | Delivered behavior                                                       | Primary concept                                             | Required evidence                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Persistent shell and player backed by the existing `@gbfm/player` engine | Component lifetime and resource ownership                   | Real audio advances across client navigation; queue/position retained; no duplicate media engine or listeners; close/unmount cleanup; mixed-route boundary behavior explicitly tested |
| 6   | One shared membership owner for player/page favorite controls            | Providers instead of bidirectional Submodel synchronization | Matching controls agree; A/B account switch, revision conflict, lost acknowledgement/retry identity, and stale page responses remain safe                                             |
| 7   | Search dialog and query lifecycle migrated                               | Interaction Model versus query state                        | Blank input makes no request; controlled-time debounce; late responses; close/reopen; Enter navigation; shortcuts; focus restoration and modal isolation                              |

PR 5 does not rewrite the playback engine. PR 6 centralizes domain safeguards rather than deleting them. PR 7 must prove dialog behavior; the article's component list is not enough to establish API or patch parity.

### Later stacks

These are delivery groups, not one large PR per row. Refine each group before implementing it.

| Group          | Proposed PR boundaries                                                                                     | Promotion-sensitive behavior                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Public reading | Editorial/listing; shows and episode controls; tweet navigation/resume/spotlight; profiles and collections | No-JS content, canonical URLs, private drafts, reader position and history, media controls                          |
| Dashboard      | Small section-based PRs; dedicated API-key issuance PR                                                     | Server authorization, native form fallback, one-time secret disclosure, password-manager overlay isolation          |
| Creator        | Editor state; preview/publish; upload lifecycle                                                            | Unsaved edits, upload pause/retry, navigation races, publication authority and draft media privacy                  |
| Removal        | Foldkit packages/build integration; obsolete state/messages/cache protocol; documentation                  | All existing routes accounted for; no required capability lost; no permanent adapter or duplicate state left behind |

## Verification as work proceeds

### Establish the baseline before implementation

Record the source SHA, lockfile, tool versions, commands, fixture identity, and results before PR 1. Run the required baseline checks and representative browser journeys. A baseline failure is investigated and reproduced; it is not silently counted as a migration pass.

The planning commit does not establish that runtime baseline.

### Work one contract at a time

For each changed behavior:

1. State the caller-visible invariant and choose the appropriate seam.
2. Reuse an existing behavioral regression where possible.
3. Add or adapt a test and observe its intended failure, or deliberately break the protected behavior to prove the gate catches it.
4. Implement the smallest change, run the focused check, then refactor while green.
5. Run cumulative checks before handing off the PR.

Use Story tests for transitions and issued Commands, Play tests for real Commands/queries/subscriptions with supplied test Layers, browsers for DOM/focus/media/hydration, and workerd for Worker/binding behavior. One level is not evidence for another. No module mocks or method spies.

### Existing browser contracts to reuse

All paths below are under `apps/www/e2e/`:

- `document.spec.ts`: no-JS styling/content, HTTP semantics, theme, hydration adoption, search startup.
- `navigation.spec.ts`, `routes.spec.ts`, `tweet-navigation.spec.ts`, `tweet-resume.spec.ts`: navigation and reading.
- `player-source-ownership.spec.ts`, `episode-controls.spec.ts`, player scrubber/favorite suites: real media and controls.
- `public-actions.spec.ts`, `player-favorite.spec.ts`: shared membership behavior.
- `api-keys.spec.ts`, `api-key-issuance-runtime.spec.ts`: security-sensitive issuance and dialogs.
- `creator-edit.spec.ts`, `editorial-drafts.spec.ts`, `upload.spec.ts`: authoring and upload journeys.

Some tests inspect Foldkit markers or load Vite-only fixture modules. Preserve their user-facing assertions, but adapt framework-specific setup and readiness checks for migrated routes. Do not claim a Vite fixture validates a production Worker bundle.

The existing Playwright projects emulate Mobile Safari and Mobile Chrome. Add desktop coverage for keyboard/focus and layout where changed. WebKit emulation is not physical-iPhone evidence.

### Check commands and environments

Existing repository checks:

```sh
bun precommit
bun run test:packages
bun run test:www
bun run --cwd apps/server test:d1
bun run --cwd apps/www build
```

Example focused browser invocation, with `PLAYWRIGHT_BASE_URL` set to a verified disposable fixture environment:

```sh
bun run --cwd apps/www e2e e2e/document.spec.ts e2e/navigation.spec.ts
```

`bun precommit` includes automatic formatting/lint fixes; inspect the resulting diff for unrelated changes. Full suites are required for the foundation, affected security/persistence changes, stack completion, and promotion, not after every keystroke.

The current Playwright configuration can start a fixture API and Vite, or reuse existing servers. During local agent work, run persistent services in named Rex tabs and supply an explicit verified base URL so Playwright does not silently use an unrelated server. Verify fixture identity and tested revision before collecting evidence. Keep fixture E2E runs serialized because they share mutable fixture data.

New production-worker test commands are not implemented yet. PR 2 must supply a reproducible local workerd harness and CI command before its acceptance gate can pass. Local fixtures must not send email, publish real content, mutate production data, or start production deployments.

For fresh regressions, use deterministic response barriers and Effect test clocks instead of arbitrary sleeps. Browser request counts can prove network duplication; a recording service supplied through the production interface can prove server query deduplication.

### PR evidence and review checkpoint

Every PR handoff includes:

- Parent/base SHA and tested head SHA, plus whether CI tested a merge result or the branch head.
- Delivered behavior and explicit non-goals.
- Incremental reading order, preferably three to five entry points.
- One Foldkit-to-Effect UI comparison tied to the actual diff.
- A short prediction question and executable demonstration for the walkthrough.
- Commands, environment, and passed/failed/blocked/not-run results.
- A demonstrated failing regression gate where a new behavior test was added.
- Real browser traces/screenshots where useful, with fixture-only data. Public evidence uploads require permission.
- Remaining preview gaps, unavailable environments, and what is not proved.

Verify both the incremental diff against the parent and the cumulative application at the stack tip. Rerun gates when an ancestor changes or a PR is retargeted. Do not describe CI as green before checking its result.

Continue autonomously through the full-site conversion and Foldkit removal. Conceptual checkpoints are progress updates and review material, not stopping points. Pause only for genuine safety decisions or blockers. Keep walkthroughs tied to the actual diff; do not generate a separate teaching book or unrelated exercises.

## Promotion gate

Before requesting approval to merge into `prod`:

- Every route reachable in the promoted build is accounted for, with playback continuity across all reachable boundaries.
- Cumulative lint/typecheck, package/WWW/D1 tests, browser journeys, and production Worker build checks pass for the exact candidate.
- Browser checks cover initial document, no-JS content, hydration, navigation/history/head, identity transitions, real playback, dialogs, and changed authoring flows.
- Mobile physical-device evidence is complete for the shared dependency change.
- The approved provider upgrade has a separately reviewed infrastructure plan before promotion. That plan still requires explicit authorization to run; resource replacement, deletion, schema/data changes, and consent changes are not authorized by this spec.
- Unverified preview limitations are resolved or explicitly accepted by the user; lower-level tests are not substituted for missing environment evidence.
- The user knows that merging triggers the production release/deployment pipeline.

After an explicitly authorized deployment, verify the deployed release and intended read-only capabilities, not just a 200 health response. Report merged, released, deployed, and behavior-verified as separate states.

## References and current evidence

- [Current Effect UI ownership and SSR conventions](../../EFFECT-UI.md), superseding the historical Foldkit ownership guide.
- [Existing PR CI](../../.github/workflows/ci.yml)
- [Production release trigger](../../.github/workflows/release.yml)
- [Production deployment](../../.github/workflows/alchemy-deploy.yml)
- [Effect UI announcement](https://ui.effect.website/article.md)
- [Effect UI SSR at the selected snapshot](https://github.com/Effect-TS/ui/blob/87a704b/packages/ui/src/html/HtmlServer.ts)
- [Effect UI hydration at the selected snapshot](https://github.com/Effect-TS/ui/blob/87a704b/packages/ui/src/html/HtmlHydrate.ts)

Read-only inspection established the dependency constraints, source boundaries, existing tests, and workflow triggers. The [foundation verification record](effect-ui-foundation.md) separates executed checks, failures, and remaining gates. Each implementation PR owns its evidence; this plan must not be used as a completed test report.
