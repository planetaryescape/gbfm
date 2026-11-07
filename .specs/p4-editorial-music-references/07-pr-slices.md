# Delivery boundaries

Design only. Latest direction authorizes finishing the P4 document PR, not implementing its proposal. **All MCP PRs remain UNMERGED for Guide Fari's overview review. No merge or auto-merge.** Use a dependent stack only for a real prerequisite. This document depends on approved P0 #547 (`design/513-mcp-permissions`), not on runtime P1/R1/E1 changes. P1 coordinates the later implementation stack. Pending P4 policy/schema choices are not approved by document delivery.

Every PR, including documentation, requires a separate `anthropic/claude-opus-5-5` review thread that loads `code-review`, reviews the actual GitHub PR, and posts actionable inline GitHub findings. Address findings and checks before handoff. Reviewer approval is not owner design approval or implementation authority.

Prefer one E3 vertical feature layer above P1's coordinated prerequisite chain after approved P4 and explicit schema approval. Schema, domain save, legacy writer compatibility, browser/MCP projection and tests must stay together if splitting would expose multi-reference state to unsafe old writers.

## One proposed E3 slice

- Delivers browser reference editing/save, shared post version/receipt behavior and existing-primary preservation under the consolidated approvals. MCP `set_draft_music_references` registration additionally requires the approved authorized reference read; without the get_post amendment or a separately approved alternative, keep that write unregistered. No blind-overwrite fallback.
- Includes [contracts](03-contracts.md), [flows](04-flows.md), reserved parts of [the file map](05-file-map.md), approved storage change plus disposable migration evidence, and [test slices](06-test-plan.md).
- Leaves publication, public multi-reference backlink/recommendation behavior, catalogue import/merge, private media and all deferred tools out.
- Requires the migration coordinator to choose and approve exact storage/integrity/legacy preservation before code; no independently deployed schema/data phase is assumed or authorized here.

Do not wait for or perform prerequisite merges as a delivery step. A future E3 implementation layer follows P1's coordinated foundation/R1/E1 prerequisites and the consolidated gate in [00-problem.md](00-problem.md). Record each dependent PR/base and its actual review evidence in the PR. Queue shared registry/schema/post patches with their owners. Checks apply to the cumulative stack head, and every PR stays unmerged. Do not split one unsafe intermediate representation into several independently deliverable layers merely to make each diff smaller.
