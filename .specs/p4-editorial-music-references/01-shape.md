# Shape and storage alternatives

Status: review-ready design proposal, not implementation or schema approval. Guide Fari accepted the purpose of separate references. Ordered relational storage and 50 items are recommendations within the consolidated gate in [00-problem.md](00-problem.md), not approved policy. Document delivery proceeds without serial decision checkpoints.

## Boundaries

- The post owns ordered deliberate associations and optional primary. Body source owns mentions and embeds. A catalogue entity owns its title, artwork, source links and visibility.
- The shared post save boundary owns authorization, one coherent snapshot, expected revision, target checks, atomic persistence and receipt. Browser/PAT/MCP adapters translate their own credentials and DTOs into it; no second editorial backend.
- P1 owns the expanded principal, scope/error exports and registry. R1 owns the public catalogue projection/read predicate. E1 supplies the guarded editorial command/receipt seam. E3 adds references to that seam after P4 approval.
- Domain parsing checks shape, bounds, uniqueness and primary membership. The service checks live account, grant, post authorship/state and target existence/visibility. Persistence enforces the winning transition and target integrity. The projection checks scopes again before exposing catalogue details.

## Proposed value

`musicReferences` contains an ordered list of distinct typed catalogue targets plus explicit primary/null. No separate reference UUID is needed: `(entityType, entityId)` identifies an association inside a post. E1's reference IDs for occurrences/positions in body embeds are not these association identities. Reordering associations does not move embeds.

PostVersion includes authored reference identity/order/primary even for legacy readers that cannot see catalogue enrichment. Mutable catalogue titles and artwork do not invalidate the post. Target visibility is checked at each read and new association save; it is not frozen by a post version.

## Storage alternatives (both unapproved)

| Choice | Benefits | Costs and gates |
| --- | --- | --- |
| **Recommended: ordered relation** | Uniqueness and position constraints; bounded reverse lookups; clear deliberate association ownership | Multi-row atomic save; coherent snapshot read; migration approval/coordinator; target-integrity strategy and legacy-primary preservation |
| Dedicated post JSON field | One-row CAS; fewer statements; no transient duplicate-position problem | Boundary decoding and uniqueness checks; reverse lookups less direct; deletion/merge integrity still needs an explicit strategy; schema approval still needed |
| Derive from embeds / hide reference data in body | No new column/table | Rejected: changes body meaning, couples layout to association order and makes reference-only edits rewrite text |

The logical contract and test slices do not depend on the first two choices. No SQL or migration file is supplied here. If relational storage is selected, the migration coordinator must settle exact DDL, constraints, replay list, exports and legacy preservation. A concrete candidate for polymorphic target integrity is three nullable typed foreign-key columns (track/album/playlist), exactly one non-null, with restrictive deletion; the application still exposes one typed target. A loose `entityType/entityId` pair alone is not a foreign-key guarantee. JSON storage needs equivalent integrity at every target deletion/merge boundary; if that cannot be proved, do not select it merely for easier CAS.

Existing primary columns remain the compatibility projection, not a competing source of truth. Every writer updates the collection and projection together. Enumerate legacy resolve, browser, PAT and E1 attach/detach before enabling E3. No publication or canonical merge changes are authorized here; a target delete/merge that would break associations must fail or use its separately approved atomic relation-preservation path. Do not let unapproved target handling silently produce dangling references.

## Risks to settle before implementation

1. E1 may not yet expose a reusable guarded transition. Agree its actual names/exports, not this document's illustrative ones.
2. A relation read separate from its post row can construct an impossible version. Use one transaction/batch snapshot including creators/tags and associations.
3. D1 `changes()` reflects the latest statement. Adding relation statements between the winning post update and receipt insertion could create false receipts; the receipt condition must derive from the actual winning transition.
4. Replacing positions under unique constraints must not fail mid-swap or expose partial lists. Validate complete replacement and execute only inside the guarded transaction.
5. E1 removal semantics must be explicit: detaching the primary clears primary only and retains other associations; removing a named association requires that typed target. Removing an embed remains a separate operation.
