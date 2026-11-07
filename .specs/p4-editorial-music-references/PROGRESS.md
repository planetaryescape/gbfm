# P4 editorial music references — Progress

## Status: Consolidated design approved; E3 allocation requested

- [x] Layer 0: Problem frame and behavioral contract (design approved)
- [x] Layer 1: Shape (design approved)
- [x] Layer 2: Alternatives (ordered relation selected)
- [x] Layer 3: Detailed typed contracts (design approved)
- [x] Layer 4: Detailed flows (design approved)
- [x] Layer 5: Implementation file map (allocation still required)
- [x] Layer 6: Executable test plan (approved plan; future feature tests not run)
- [x] Layer 7: PR delivery slices (normal OPEN PRs, unmerged)
- [x] Owner design approval (exact relayed quote recorded in 00-problem.md)

Checked means design complete/approved, not implementation complete. See [00-problem.md](00-problem.md) for the superseding approval and remaining technical allocations, and [08-validation.md](08-validation.md) for current-code checks and environment diagnosis. Actual independent PR review evidence is recorded on the PR.

## Log

- 2026-11-07 — Claimed #517 on `design/p4-editorial-music-references`, isolated worktree `/home/user/workspace/gbfm-p4`, prod base `aec2782a97bd91e2f030ef05095f76b54fcc79b1`.
- 2026-11-07 — Inspected current post storage, rich-content parsing/rendering, browser revision reconciliation, MCP versions, authorization, receipts and guarded D1 writes.
- 2026-11-07 — Drafted the problem frame with a concrete proposed behavioral contract for owner review. No implementation, schema edits or production changes. Detailed layers await direction; issue remains open and unapproved.
- 2026-11-07 — Guide Fari accepted the purpose of separate references. Storage/limit/detailed model were not approved.
- 2026-11-07 — Continued all independent detail on direction to move idle work along: typed contracts, flows, file map, six vertical test slices and one delivery slice. Storage/limit remain proposals; existing owner question is not repeated.
- 2026-11-07 — Reconciled approved P0 D1–D6; P0 confirmed scope/visibility/version/receipt compatibility and flagged optional get_post enrichment as a narrow owner-approved amendment, not implicit permission. Legacy create/update results/receipts remain unchanged.
- 2026-11-07 — Diagnosed initial root-only dependency link failure. Proper isolated frozen install resolved it; bun precommit passed, and 3 existing D1 suites / 14 tests passed on the unchanged runtime baseline.
- 2026-11-07 — Recorded corrected standing delivery rule: all MCP/doc delivery uses dependent stacked GitHub PRs coordinated by P1, left unmerged with no auto-merge; each actual PR requires its own anthropic/claude-opus-5-5 code-review thread and inline findings. No P4 PR or reviewer thread authorized/created while owner choices remain pending.
- 2026-11-07 — Superseding direction authorizes completing the document PR without serial owner checkpoints. Consolidated storage/privacy/read-amendment/schema gate; ordinary bounds/order/primary details have explicit recommendations. Delivery base is P0 #547, head `78701b3e52d4a4b64a2d66482c1f2a7d982c7f5a`; P1 notified. No runtime prerequisite is needed for the document layer. Recorded current P0 playlist consistency and strict whole-token rules.
- 2026-11-07 — Recorded Guide Fari's blanket approval relayed by P1 in [00-problem.md](00-problem.md). Consolidated surfaced recommendations are approved. Resuming E3 #532 in this thread subject to P1/E1/PL1 technical prerequisites. Requested exact E1 head, migration/coordinator allocation, shared post/save/version/get_post/receipt/registry exports and browser serialization before shared edits. Existing final Claude review is healthy; no replacement needed. Production activation remains excluded.

## Ownership and integration

Claim: https://github.com/planetaryescape/gbfm/issues/517#issuecomment-6704883425

Own only this folder. All runtime and shared documentation files remain read-only. P0/P2/P3 can proceed independently. P1 owns registry, scopes, principal, OAuth and central errors and coordinates implementation stack bases. E1 owns the prerequisite editorial save behavior; E3 (#532) must follow P1 (#514), approved P4 (#517) and E1 (#530). This document PR is based on P0 #547, not the runtime foundation. A later E3 owner must reserve PostService/version/browser files before edits; a migration coordinator must separately reserve and approve schema work. Document delivery grants no runtime, merge, deploy or migration authority.
