# Effect UI retirement evidence

Review snapshot: **B13 retirement applied locally, 2026-11-27**. This maps assertions for the removed 177 source files and 28 framework suites. The branch remains unmerged and undeployed; final compiled build/browser acceptance is recorded separately in the cutover PR.

The [migration specification](effect-ui-migration.md) records decisions; [EFFECT-UI.md](../../EFFECT-UI.md) describes current ownership. Historical source is fixed at [pre-retirement `afa0d476`](https://github.com/planetaryescape/gbfm/tree/afa0d476f12a4c28464669377eb4ad98b77ac754/apps/www/src). Legacy paths below are relative to that `apps/www/src` tree. Retained witness links point to actual repository files, not ignored evidence.

## Reading the statuses

- **PASS**: the stated native assertion witnesses passed. This is not deletion permission or a claim about every release gate.
- **APPROVED_DIFFERENCE**: explicit user approval replaces a conflicting literal legacy expectation; all other safeguards remain required.
- **HOLD**: an active failure or missing proof blocks closure. Seven rows explicitly marked **KEEP** stay unchanged.

Framework command names, renderer signatures and Foldkit wire markers need not survive. Their user-visible effects, privacy, ordering, retry identity and error behavior do. A graph edge, matching title or passing count alone never authorizes an assertion drop.

### Consumer closure

The applied batch contains 177 source paths and the 28 framework suites below. After removing the two obsolete server includes from `test/tsconfig.effect-ui-http.json`, the inspected compiler roots and surviving imports no longer reached those 177 paths. The native HTTP project typecheck passed. Main applied the exact hash-checked batch only after `bun precommit` and all 1,750 pre-retirement tests passed.

Keep six shared helpers outside the batch: `navigation-transition.ts`, `page/auth/links.ts`, `page/connect/callback.ts`, `page/connect/client-logo.ts`, `page/connect/domain.ts` and `telemetry/local-request-tracing.ts`. Native code or retained tests still consume them.

Also retain `page/dashboard/dashboard.css`, `view/rich-content/classic.css`, `view/rich-content/spotlight.css`, ambient declarations and live browser fixtures. Their legacy-looking paths do not make them obsolete. Recheck the final native build and presentation after deletion because Tailwind scans source inputs, not just the JavaScript import graph.

## Closed privacy proof

**PASS: Public/Root is 466/466, including all 459 original cases and seven new Player cases.** [The unchanged matched-current401 test][current401] now proves private current/queued titles and media-session metadata are removed while independent principal verification is held. Root passes explicit authorization suspension from its validated membership identity; Player revokes private grants and fences late completions without treating ordinary navigation as authorization loss. A [separate exact-null check][metadata-null] verifies media-session metadata is exactly `null`. Final combined repository and compiled-browser gates remain pending.

The separately approved Root-only Creator lease is **62/62 PASS**: retain the actual editor scope only during exact-URL, same-owner verification; remove its DOM and private head while verification is unresolved. Accepted commands may finish under the explicitly approved behavior. Role eligibility and owner, realm, URL, editor/verification epoch and navigation-ID fences remain required. Retained `dataScopeModel` is not permission to display private DOM. See [timing][lease-time], [boundaries][lease-boundary] and [revocation][lease-revoke].

The first frozen B13 browser run exposed a separate resume-presentation gap. A failed concrete resume destination must show the existing unavailable alert and Retry, not treat the `/tweets` entry shell as destination content. The narrow Root correction has [13 native regression cases][resume-failure], preserving checkpoint/write fences, pending visibility and ordinary public retention. This does not replace the original failed browser result; B14 compiled acceptance must reach its unchanged alert and checkpoint assertions.

The two B13 membership-write401 failures exposed a lost recovery action after independent identity verification. [Root recovery][membership-recovery] and [provider/control proofs][recovery-controls] cover a separate owner-scoped recovery flag: keep Sign in through unknown and verified same-owner refreshes, block write replay and read-refresh loops, and clear it for a different owner, confirmed sign-out or a fresh document lifetime. The flag never authorizes private content or restores grants. Fourteen new native proofs pass; the unchanged compiled-browser cases remain separate acceptance gates.

## Suite-level map: 28 framework suites and seven KEEP originals

| Legacy source                                               | Retained native witness and scenario                                                                                                                                                                                                                 | Status              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **KEEP** `nav-scroll.test.ts`                               | [Original suite][keep-scroll]: strict small-motion identity and near-top expansion.                                                                                                                                                                  | PASS                |
| **KEEP** `spotlight-page.test.ts`                           | [Original suite][keep-spotlight]: invalid-position rejection and idempotent normalization.                                                                                                                                                           | PASS                |
| `spotify/playback.test.ts`                                  | [Ownership][spotify]: serialized playback/connect, partial failure, retry and identity fences.                                                                                                                                                       | PASS                |
| `spotify/synchronization.test.ts`                           | [Root Spotify][root-spotify]: fresh accepted-navigation status read, stale outcome rejection, anonymous Connect admission.                                                                                                                           | PASS                |
| `page/dashboard/spotify-ownership.test.ts`                  | [Pending Connect][connect-pending]: duplicate Connect/status/callback blocked; disconnect admitted.                                                                                                                                                  | PASS                |
| `player/model.test.ts`                                      | [Native model port][player-model]: complete fine-preview fields, stale gestures, external seek and one-drop reorder.                                                                                                                                 | PASS                |
| `player/drag-handle.test.ts`                                | [Native drag events][drag]: exact six-pixel threshold, pointer replacement/cancel and click suppression.                                                                                                                                             | PASS                |
| **KEEP** `player/runtime.platform-integration.test.ts`      | [Original suite][keep-platform]: actual adapter seek/completion, source replacement and replay ownership.                                                                                                                                            | PASS                |
| `player/favorite.test.ts`                                   | [Notice port][favorite-notices] and [account ownership][account]: 3999/4000 ms boundary, track/account races; approved identity-state differences below.                                                                                             | APPROVED_DIFFERENCE |
| `player-favorite.test.ts`                                   | [Actual Root port][player-root] and [queued-track port][queued]: A→B/return ordering, opposite acknowledged writes, shared intent; private-output suspension is proved separately above.                                                             | APPROVED_DIFFERENCE |
| `public-actions/index.test.ts`                              | [Membership port][membership]: observed revision before write, exact uncertain retry, conflict reobserve without automatic write retry.                                                                                                              | PASS                |
| `view/artwork.test.ts`                                      | [Native artwork][artwork]: private inert URLs, public transforms and square/banner geometry.                                                                                                                                                         | PASS                |
| `view/rich-content/render.test.ts`                          | [Native SSR rendering][rich]: original variant expectations, escaping, links, player fallbacks and disclosure.                                                                                                                                       | PASS                |
| `update.test.ts`                                            | [Reader navigation][reader-nav], [upload departure][upload-departure] and [public guards][public-guards]: loading/ready/empty/error, stale outcomes, cached public return and checkpoint retention. Current401 private-output gate passes unchanged. | PASS                |
| `page/creator/update.test.ts`                               | [Query ownership][creator-query]: same-entity reference races, author races, retry and ready-preview no-duplicate work; [parity][creator-parity] retains other original cases.                                                                       | PASS                |
| `page/creator/publication.test.ts`                          | [Publication port][creator-publish], [named edits][creator-named] and [cache retention][creator-cache]: failed save causes no cleanup, fresh retry, discard failures, zero automatic local read, exact autosave timing and retained prior preview.   | PASS                |
| **KEEP** `page/dashboard/ui.test.ts`                        | [Original suite][keep-ui]: formatting edge cases and helper consumers.                                                                                                                                                                               | PASS                |
| **KEEP** `page/dashboard/navigation.test.ts`                | [Original suite][keep-nav]: role/workspace routes and title fallback.                                                                                                                                                                                | PASS                |
| `page/dashboard/document.test.ts`                           | [Projection parity][dashboard-projection]: artwork/removal identity and eight reminder-eligibility rows.                                                                                                                                             | PASS                |
| `page/dashboard/page/admin.test.ts`                         | [Admin parity][dashboard-admin]: all eight human labels and formatted counts.                                                                                                                                                                        | PASS                |
| `page/dashboard/update.test.ts`                             | [Collection controls][dashboard-collection]: disabled pending controls, enabled exact retry after refresh/cancel, and zero denied-admin requests.                                                                                                    | PASS                |
| `page/dashboard/service.test.ts`                            | [Transport parity][dashboard-transport]: authenticated no-store reads, malformed responses and partial import success.                                                                                                                               | PASS                |
| `page/dashboard/page/playlists.test.ts`                     | [Library operations][dashboard-library]: all seven pending-action locks, exact reload/reset/delete-empty state and cancellable confirmation.                                                                                                         | PASS                |
| `page/dashboard/page/shows.test.ts`                         | [Dashboard DOM port][dashboard-dom] and [show parity][dashboard-shows]: all eight Creating/Editing × idle/load/save/delete label branches.                                                                                                           | PASS                |
| `page/dashboard/page/sessions.test.ts`                      | [Dashboard DOM port][dashboard-dom]: both query lifetimes reject delayed success/failure after search or revision changes.                                                                                                                           | PASS                |
| `page/dashboard/page/catalog.test.ts`                       | [Catalog parity][dashboard-catalog] and [transport][dashboard-transport]: owned payloads, numeric validation, role guard and stale-link rejection.                                                                                                   | PASS                |
| `page/dashboard/page/connections.test.ts`                   | [Admin parity][dashboard-admin] and [retirement gates][dashboard-gates]: owned disconnect form; 403/503 unavailable without retry loop.                                                                                                              | PASS                |
| `page/dashboard/page/api-keys/update.test.ts`               | [Account controls][dashboard-account]: password exclusion, verification lock, revoke confirmation and both secret-disclosure outcomes.                                                                                                               | PASS                |
| `page/dashboard/page/api-keys/dialog-compatibility.test.ts` | [Dashboard DOM port][dashboard-dom]: unrelated-dialog negative, both closed-shadow password hosts, first open/reopen/remount and real pointer activation.                                                                                            | PASS                |
| `page/listening/view.test.ts`                               | [Native listening][listening]: five owner forms retain target-specific revisions and POST fallback.                                                                                                                                                  | PASS                |
| `page/tweet/reader.test.ts`                                 | [Visit ordering][reader-order] and [reader matrix][reader-matrix]: visible-first gating, both stale query outcomes, pre-write metadata and retained timeline after failure.                                                                          | PASS                |
| **KEEP** `page/connect/review.test.ts`                      | [Original suite][keep-review]: modes/statuses, continuation policy and cookie ordering.                                                                                                                                                              | PASS                |
| **KEEP** `server/mcp-guide.test.ts`                         | [Original suite][keep-mcp]: exact 200/503 body, content type and no-store forwarding.                                                                                                                                                                | PASS                |
| `server/document.test.ts`                                   | [Homepage JSON][home-json]: actual `/?__data=1` public metadata fallback; [native document][document] and [host][host] retain HTML/assets/request isolation.                                                                                         | PASS                |
| `server/spotify-ssr.test.ts`                                | [Spotify provider][spotify-ssr] and [reader requests][reader-requests]: readable music/outbound fallback with zero browser storage/SDK acquisition during SSR.                                                                                       | PASS                |

## Five approved differences, not blanket permission

The user explicitly selected **Keep safer native behavior**. The authoritative [approved favorite-state section](effect-ui-migration.md#approved-favorite-state-differences-2026-11-27) preserves these five decisions:

1. One correlated acknowledgement settles the shared page/Player pending intent, not a separate stale retry store.
2. Other membership writes wait behind the listener's revision-owned pending write.
3. Explicitly unknown identity suspends prior-account membership/private access; ordinary page loading does not revoke independently validated identity.
4. A matched current401 suspends identity rather than inventing confirmed anonymous state; superseded failures cannot invalidate a newer owner.
5. Independently confirmed sign-out shows Sign in, not unavailable membership or an unnecessary lookup.

Player's 54-case ledger records 49 retargets and five approved differences, with zero unresolved mapping HOLDs. This approval does not waive private-output checks, exact retry/receipt/revision checks, or any other original assertion.

## Pure-suite and consent preservation

All **51 original pure suites remain**: 14 import-only retargets passed **78/78**; 37 retained existing imports. Fifty import-stripped whole-suite body hashes match. The remaining suite, `server/http-dispatch.test.ts`, preserves all 17 original case blocks verbatim and adds the approved origin-isolation regression and fixture origin field. Original assertions and import bindings remain intact; the seven KEEP suites remain byte-identical. Shared server, telemetry, issuance, upload, player and Spotify adapters are current native dependencies even under legacy-looking directories.

Method: compare each original path with `git show afa0d476:<path>`, remove only top-level `import … from` declarations, trim boundary whitespace, then compare UTF-8 SHA-256 values. For the additive HTTP suite, compare its 17 original case blocks separately and inspect the added regression and fixture field. Here `<path>` is repository-relative, for example `apps/www/src/page/connect/view.test.ts`. Separately compare import bindings while ignoring module specifiers/import formatting. Do not normalize assertions, expected strings, calls, titles or body comments.

The relative audit breadcrumbs are `.git/effect-ui-b13-pure-retarget.{md,json}` and `.git/effect-ui-b13-pure-retarget.final-vitest.json`. They are optional local audit detail, not portable prerequisites: the historical Git tree, retained suites and commands below permit independent review without copying raw bodies into this document.

[Original consent assertions][consent-original] are retained, not deleted: both false/true editorial headings and all four expanded-scope rows retain their expected values, including no implicit read/offline/drafts/undefined grants. [Native consent][consent-native] independently preserves private-artwork boundaries, no unrequested publish/delete/live-edit rights and the explicit `assets:upload` union case. Renderer equality is not a substitute for these assertions.

## Reproduce from retained source

These are review commands, not commands executed by this documentation task. Run from `apps/www`, with existing dependencies and disposable fixtures; do not install or build to inspect the map.

```bash
bun run unit src/features/creator
bun run unit src/features/player/retirement-*.test.ts src/features/public-actions/retirement-*.test.ts src/app/nativeplayer-root-retirement.test.ts
bun run unit src/app/*retirement.test.ts src/features/reader
bun run unit src/features/dashboard/*.test.ts src/features/spotify/*.test.ts
bun run playwright test --config test/dashboard-retirement.playwright.config.ts
bun run unit src/server src/observability/navigation.test.ts plugins/default-config.test.ts
bun run playwright test --config playwright.observability.config.ts --project Chromium
bun run unit src/page/connect/{callback,client-logo,continuation,server}.test.ts src/page/creator/upload/{errors,protocol,runtime,storage}.test.ts src/page/shows/host-links.test.ts src/page/tweet/{navigation,position,timeline}.test.ts src/view/rich-content/{music-mentions,spotlight-presentation}.test.ts
```

The broad Root command includes the unchanged current401 proof and its exact-null supplement. Run narrower files to reproduce an individual table row. For a body-preservation review, inspect `git diff afa0d476 -- <original-suite-path>` alongside that path's historical source; pure-suite changes are limited to imports and the explicitly recorded additive HTTP regression/fixture field.

## Evidence limits and review breadcrumbs

- Creator: 168/168; 42 templates / 54 expanded original cases, both prior HOLDs closed. Details: `.git/effect-ui-retirement-creator-b13-handoff.json`.
- Dashboard: 71/71 mapped rows; 118 native tests plus six Playwright DOM tests. Details: `.git/gbfm-dashboard-retirement-assertion-map.json`. Node-only execution is not DOM proof.
- Public/Root: 466/466, including all 459 original cases and Creator lease 62/62. The unchanged current401 proof passes; a separate exact-null supplement also passes. Details: `.git/effect-ui-b13-root-suspension-final-handoff.json`.
- Main reports 125 native HTTP/config/[SSR-isolation](../../apps/www/src/server/server-entry-isolation.test.ts)/[observer](../../apps/www/src/observability/navigation.test.ts) contracts, including [default config](../../apps/www/plugins/default-config.test.ts) and the exact homepage JSON test, plus five [actual local SDK browser cases][sdk-browser]. Fake DSN and intercepted transport prove local integration, not Sentry ingestion, upload or hosted delivery.
- These counts are overlapping owner snapshots, not an additive final total. Historical failed ledgers remain failures; later bounded passes do not prove their root causes fixed.
- Keep UI/UI-kit `87a704b`, Effect `4.1.6`, Alchemy/provider `2.0.0-beta.87`, and the committed textarea/HarfBuzz patches in [the dependency contract](../../EFFECT-UI.md#installed-versions-and-patch).
- The initial unrestricted full-suite run recorded 1,749 passes and one SSR-import timeout. Bounded four-worker execution passed all 1,750 tests with the same assertions and 15-second deadline; the normal command and fresh combined precommit/WWW gate also passed after making that resource bound explicit. The original failure log remains unchanged.
- Final post-retirement build/browser acceptance is reported in the cutover PR, not inferred from the pre-retirement counts above. Real-account authorization, WebKit/physical-iPhone coverage and production delivery are not established here. No screenshots or raw result logs are added to Git.

[keep-scroll]: ../../apps/www/src/nav-scroll.test.ts
[keep-spotlight]: ../../apps/www/src/spotlight-page.test.ts
[keep-platform]: ../../apps/www/src/player/runtime.platform-integration.test.ts
[keep-ui]: ../../apps/www/src/page/dashboard/ui.test.ts
[keep-nav]: ../../apps/www/src/page/dashboard/navigation.test.ts
[keep-review]: ../../apps/www/src/page/connect/review.test.ts
[keep-mcp]: ../../apps/www/src/server/mcp-guide.test.ts
[spotify]: ../../apps/www/src/features/spotify/ownership.test.ts
[root-spotify]: ../../apps/www/src/app/root-spotify.retirement.test.ts
[connect-pending]: ../../apps/www/src/features/spotify/pending-connect.retirement.test.ts
[player-model]: ../../apps/www/src/features/player/retirement-model.test.ts
[drag]: ../../apps/www/src/features/player/drag-events.test.ts
[favorite-notices]: ../../apps/www/src/features/player/retirement-favorite-notices.test.ts
[account]: ../../apps/www/src/features/public-actions/retirement-account-ownership.test.ts
[player-root]: ../../apps/www/src/app/nativeplayer-root-retirement.test.ts
[queued]: ../../apps/www/src/features/public-actions/retirement-queued-track.test.ts
[membership]: ../../apps/www/src/features/public-actions/retirement-membership.test.ts
[artwork]: ../../apps/www/src/ui/artwork.test.ts
[rich]: ../../apps/www/src/ui/rich-content/render.test.ts
[reader-nav]: ../../apps/www/src/app/reader-navigation.retirement.test.ts
[upload-departure]: ../../apps/www/src/app/reader-upload-departure.retirement.test.ts
[public-guards]: ../../apps/www/src/app/reader-public-retention-guards.retirement.test.ts
[creator-query]: ../../apps/www/src/features/creator/CreatorPage.query-ownership.retirement.test.ts
[creator-parity]: ../../apps/www/src/features/creator/CreatorPage.parity.test.ts
[creator-publish]: ../../apps/www/src/features/creator/CreatorPage.publication-ownership.retirement.test.ts
[creator-named]: ../../apps/www/src/features/creator/CreatorPage.named-edit.retirement.test.ts
[creator-cache]: ../../apps/www/src/features/creator/CreatorPage.preview-cache.retirement.test.ts
[dashboard-projection]: ../../apps/www/src/features/dashboard/projection-parity.test.ts
[dashboard-admin]: ../../apps/www/src/features/dashboard/admin-parity.test.ts
[dashboard-collection]: ../../apps/www/src/features/dashboard/collection-controls.retirement.test.ts
[dashboard-transport]: ../../apps/www/src/features/dashboard/transport-parity.test.ts
[dashboard-library]: ../../apps/www/src/features/dashboard/library-operations.retirement.test.ts
[dashboard-dom]: ../../apps/www/e2e/dashboard-retirement-dom.spec.ts
[dashboard-shows]: ../../apps/www/src/features/dashboard/show-parity.test.ts
[dashboard-catalog]: ../../apps/www/src/features/dashboard/catalog-parity.test.ts
[dashboard-gates]: ../../apps/www/src/features/dashboard/retirement-gates.test.ts
[dashboard-account]: ../../apps/www/src/features/dashboard/account-controls-parity.test.ts
[listening]: ../../apps/www/src/features/listening/page.test.ts
[reader-order]: ../../apps/www/src/app/reader-visit-ordering.retirement.test.ts
[reader-matrix]: ../../apps/www/src/features/reader/reader-matrix.retirement.test.ts
[resume-failure]: ../../apps/www/src/app/reader-resume-failure.retirement.test.ts
[membership-recovery]: ../../apps/www/src/app/membership401-recovery.integration.test.ts
[recovery-controls]: ../../apps/www/src/features/public-actions/recovery.integration.test.ts
[home-json]: ../../apps/www/src/server/home-metadata.test.ts
[document]: ../../apps/www/src/server/effect-ui/document.test.ts
[host]: ../../apps/www/src/server/effect-ui/host.test.ts
[spotify-ssr]: ../../apps/www/src/features/spotify/provider.test.ts
[reader-requests]: ../../apps/www/src/features/reader/requests.test.ts
[current401]: ../../apps/www/src/app/reader-current401-private.retirement.test.ts
[metadata-null]: ../../apps/www/src/app/reader-current401-metadata-null.retirement.test.ts
[lease-time]: ../../apps/www/src/app/creator-lease-timing.retirement.test.ts
[lease-boundary]: ../../apps/www/src/app/creator-lease-boundaries.retirement.test.ts
[lease-revoke]: ../../apps/www/src/app/creator-lease-revocation.retirement.test.ts
[consent-original]: ../../apps/www/src/page/connect/view.test.ts
[consent-native]: ../../apps/www/src/features/connect/view.test.ts
[sdk-browser]: ../../apps/www/e2e/observability.spec.ts
