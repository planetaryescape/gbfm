# Future vertical test slices

Status: proposed acceptance evidence for E3, not tests executed by P4. Each slice starts with one public-interface regression, implements only that behavior, then refactors with the same tests. Use migrated disposable D1 and actual HTTP/MCP/service paths. The existing receipt and composed OAuth fixtures are the starting point; do not replace authorization with a mocked actor in the final proof.

## Slice 1 — Preserve the primary and deliberate associations

- **Red:** Start with existing album A primary and body embedding unrelated track X twice. Save `[track B, album A]`, primary A. Authorized draft read returns B then A and primary A; body/embeds are byte-for-byte unchanged. Reorder to `[A, B]`: order and version change, primary does not. This defeats extraction-from-embeds, sort-by-ID and primary-is-first implementations.
- **Green:** Parse full replacement, validate canonical IDs and targets, save/read using selected storage under the shared post guard. Existing legacy one-pair draft is visible as one-item primary state before its first reference mutation.
- **Refactor:** Keep canonical value rules in one owner; reuse its parser across browser/API/MCP boundaries.

## Slice 2 — Clear versus preserve and legacy writes

- **Red:** Text-only `update_draft` and browser PATCH omission preserve `[A, B]` and primary B. Explicit empty replacement with null clears; missing primary or primary A with empty list fails with no writes. Legacy primary C appends it and selects C without losing A/B; clearing legacy primary retains the list. Reject simultaneous legacy/new fields. At capacity attaching C fails without eviction. Micro-post control remains single-attachment.
- **Green:** Add collection patch presence semantics and normalize all legacy primary writers into the same post transition. Leave legacy MCP input schemas unchanged.
- **Refactor:** Remove duplicate path-specific association mutation logic only after both surfaces pass unchanged.

## Slice 3 — Browser/MCP race and unsaved text

- **Red:** Real browser/session edit and persisted-OAuth MCP reference edit start at V0. Use the existing gated database/test fixture to hold one write at the actual commit boundary. Run both winning orders. Exactly one applies; the loser changes no text/associations/primary/receipt. Browser unsaved text and any reorder typed during the request stay in local state/storage. A late response for a different editor/request changes neither. A reference-only save never submits/overwrites unrelated local text.
- **Green:** Share one monotonic post revision, snapshot/CAS and submitted/current draft reconciliation. Do not auto-advance revision on conflict or resubmit stale local data.
- **Refactor:** Reuse current editor ownership and reconciliation rules; do not introduce a parallel draft store.

## Slice 4 — Atomicity and target integrity

- **Red:** Through the actual command/save interface, inject a D1 statement failure after some reference work but before receipt/post completion. Snapshot stored body, primary, association order, version and receipts independently before/after; all stay equal. Repeat with stale guard, publication/creator loss at commit, and two identical concurrent requests. Exercise swapping two positions under uniqueness constraints. A target deletion must fail or atomically preserve references via its separately approved path, never leave orphan/dangling association rows.
- **Green:** One guarded D1 batch/transaction, target constraints/revalidation and receipt gating tied to the winning post transition; no partial list, false receipt or second operation ledger.
- **Refactor:** Keep tests on observable saved state, not internal SQL call order. Use generated SQL tests only where repo guidance requires them, not as the only proof.

## Slice 5 — Exact retry identity

- **Red:** Apply request R at V0; apply a later edit S at V1. Retry R exactly: original R result returns but current state stays S. Reuse R with changed order, primary, operation kind or explicit/omitted fields: conflict. At exactly the 24-hour boundary the existing key is expired and never reapplies. Changed grant/role/ownership before replay denies without leaking the old saved result. A referenced playlist becoming private also prevents enriched replay; no old title/artwork leaks. Existing create/update receipts still replay correctly with their original shape and no reference enrichment or re-rendering.
- **Green:** Existing editorial key and window, normalized presence-aware operation hash, current authorization before original-result replay.
- **Refactor:** Share E1's receipt operations; no new receipt schema for references.

## Slice 6 — P0 permissions, visibility and bounds

- **Red:** Creator with `posts:read drafts:write` but no `catalogue:read` can still use existing text tools, cannot set references or receive catalogue enrichment. The same post at the same instant produces the same PostVersion across scope sets. If the read amendment is approved, omitted enrichment differs from authorized empty `{ references: [], primary: null, display: [] }`. All three scopes still fail for another author's draft; admin without authorship also fails. Revoked/expired OAuth fails before dispatch. Album with null publication timestamp is allowed under R1 public projection, but playlist with null/future timestamp is not; playlist at now is allowed. Check public lists/backlinks/counts exclude the draft before pagination.
- **Green:** Apply P0's approved scope/role/visibility contract at service/invocation/replay; discovery is not authorization. Return safe unavailable display for an existing target becoming non-public, without private metadata.
- **Refactor:** Reuse R1 predicate/projection rather than building a different MCP visibility rule.
- **Boundaries:** Distinct 50-item collection succeeds and 51 fails if that proposal is approved. A repeated ID with different spelling cannot bypass canonical deduplication; same UUID in two actual different types remains distinct. Reject invalid/nonmember primary. Test whole encoded JSON immediately below/at/above P0's 256 KiB bound, including escaped Unicode/control characters and existing 100,000-character content. Response too large must fail before commit, not silently truncate or write then error. Pure catalogue lookup/save must cause zero external requests through the production injected fetch capability, not a mocked import-service call count.

## Commands and final evidence

Run `bun precommit` from the isolated checkout with workspace-local installed dependencies. Run affected suites using `bunx vitest run --config vitest.d1.config.ts ...` from `apps/server`, narrowing to the existing paths listed in [the file map](05-file-map.md), then broader affected suites at the final integrated head. Browser state behavior uses existing Foldkit tests plus `apps/www/e2e/editorial-drafts.spec.ts`; use the repo's runnable browser fixture. Record DOM state, local draft state, actual requests and DB results for the composed race. If visual controls change, inspect default/non-default UI states and record pointer/keyboard behavior under the repo's browser workflow.

Final evidence must name exact integrated SHA, migration fixture, commands/results, before/after state for conflict/rollback, and unavailable evidence. None of these proposed new-behavior cases has run in P4; source inspection and current-code checks are not implementation proof.
