# Save flows and invariants

Status: design-only. Read with [typed contracts](03-contracts.md). The same flows apply to either proposed storage choice. E1/P1 export names remain integration decisions, not assertions that a new API exists.

## MCP set: no body replacement

1. MCP transport parses the command using its strict input schema and size limits. Persisted OAuth verification supplies a current principal. Require P0's three scopes, current account role, authored unpublished editorial access; no admin ownership bypass.
2. Build the existing editorial receipt key from actor/request ID. Hash the operation discriminator, post ID, expected version, ordered case-normalized target keys and explicit primary. This normalization is pure and does not need catalogue resolution. An existing identical receipt replays only after current grant/account/post access and stored display-target visibility checks; it does not re-resolve identities, fetch providers, re-render display or mutate. Changed payload conflicts; expired keys fail. A formerly public playlist that is now private denies the enriched replay rather than leaking the stored title/artwork.
3. Load one coherent authored snapshot: post, creators, tags, current list and primary. Compute PostVersion over existing authored fields plus the reference value, not resolved display data. Compare expected version. A concurrent identical receipt may already have won; check replay before reporting conflict.
4. Validate every submitted target via bounded stored catalogue lookup: exact type/ID, public projection, playlist publication predicate. No provider fetch or import. Resolve to canonical stored IDs and reject duplicates. Use at most the proposed 50 targets and one relationship hop; do not expand album or playlist tracks.
5. Prepare next post state with unchanged body/title/tags and one monotonic updated-at increment. The existing primary projection matches explicit primary/null. Prepare the saved output and receipt under existing editorial semantics.
6. In one bounded D1 transaction/batch, enforce the full expected authored state, creator/account eligibility, draft state, target integrity and receipt absence. Apply the collection replacement, post projection/update and receipt as one transition. Guard dependent statements before they can delete/insert anything. The adapter must prove its affected-row/receipt gate belongs to the winning post mutation, not an unrelated relation statement.
7. Return the authorized receipt's saved result. If there is no committed receipt after the attempt, return conflict or safe unavailable as appropriate. Do not manufacture success from a proposed in-memory next state.

Any failure in step 6 rolls back the entire transition. A transaction cannot be held open across provider work; this command does none. Persisted grants/account and public-target eligibility are checked at the owning boundaries and rechecked at commit where they can change. P1/E1 must define the grant revocation race policy and implement it consistently, not only at discovery.

## Browser combined save

1. Editable draft read loads local content and references with remote updated-at. Keep a submitted snapshot and an editor/request identity. Source URL lookup can suggest an existing catalogue target but does not attach/save.
2. Local add/remove/reorder changes only local state. Removing primary asks the user to select another or none. Reordering does not change primary.
3. Submit text fields intended for this save, optional collection replacement and mandatory expected updated-at for reference-bearing edits. The server applies existing session/PAT authorization, parses values and joins the same atomic post-save path. Browser drafts must not gain MCP publication authority or vice versa.
4. On success, reconcile only the matching editor/request. If typing/reordering continued while saving, retain those later edits in memory and local storage while updating the acknowledged remote revision. A reference-only response never replaces local text. A later save uses the new acknowledged revision and the current local values intentionally selected for saving.
5. On conflict retain local text, reference order and the old base revision. Fetch a separate comparison copy if requested; never silently replace the form or advance its base and auto-resubmit stale text. Reload/discard is an explicit user action. Local-storage reconciliation failure after a remote success must state that split outcome rather than repeat the remote mutation.

## Cross-surface race

Given one initial version V0, browser B has unsaved text and MCP M submits a reference reorder. If M commits first, the post becomes V1; B's save at V0 fails without writes and keeps text locally. If B commits first, M fails at V0 without reference/receipt changes. Read-only catalogue title/artwork changes must not generate a new authored PostVersion. Removing a primary, changing it, or reordering references must.

An old `get_post` reader without catalogue scope can still obtain the current opaque version and use text-only `update_draft`; that update preserves all references. It cannot mutate or infer hidden catalogue enrichment. P0 confirmed that the single scope-independent version is compatible, but optional get_post enrichment requires a narrow owner-approved amendment. Do not silently broaden legacy create/update results or their receipt decoders through a shared result schema.

## E1 and legacy primary writers

- Attach selects/adds the named typed target as primary; an existing target keeps its position; a new target appends. At capacity, reject rather than evict another association.
- Detach primary sets primary null and retains the ordered list. Explicit association removal uses E3 replacement, including explicit null/new primary where needed. Never treat an omitted collection as clear-all.
- Embeds remain body operations with their own occurrence/position identity. Neither embed insertion nor mention detection adds associations unless a separate deliberate command requests it.
- Existing browser saved-post resolve may perform canonical/provider work under its existing authority. E3 must not route its URL lookup through that mutating service. After resolution, any attachment write must join the shared revision/association save and preserve secondary references. No writes to published posts are added by E3.
- Micro posts keep their single-attachment behavior. Existing published content/public feeds keep their current primary projection. Their new multi-reference publication/backlink behavior is outside this slice; no auto-publication or public draft edges.

## Read and visibility

Authorize draft before querying/displaying associated targets. Load one snapshot, decode stored shape, then project only authorized public target fields. Existing references to a target that is now non-public keep a safe unavailable state for an authorized author, without private title/artwork/links. New submissions containing that target fail. Text-only saves preserve the stored identities; later hard deletion is prohibited by target integrity until an approved removal/replacement is complete. An already-corrupt missing target is a repair condition, not permission to create new dangling rows.

Public list/count/backlink paths never include unpublished post associations. Private reads remain no-store. A public parent cannot expose an unpublished playlist. Check visibility before counts/pagination/snippets, not after response assembly.

## Retry, cancellation and bounded output

Retry exact actor/request ID/payload after a lost response; within 24 hours the original authorized result returns even after a later edit. A new key is a new command, not a timeout recovery. After expiry read current state before deciding whether a new edit is needed. The operation discriminator prevents a tag/text/reference command from accidentally sharing a receipt's meaning. Receipt keys and old receipt decoders remain compatible with the four existing tools.

P0's 256 KiB JSON cap must be checked against the complete encoded success (including escaping, endpoint metadata and optional reference display). Before commit, detect any result that cannot be returned/replayed and fail safely without mutating. Do not commit then reject a too-large result or silently truncate a complete reference list/body. Limit display fields using the existing bounded public projection, not attacker-controlled raw provider metadata. A failure envelope remains safely bounded. Existing legacy size behavior must not change accidentally; the P1 composed fixture must include escaped 100,000-character body cases already tested by the legacy MCP route.

Cancellation does not undo a committed result. Use existing Effect interruption and request lifetimes; do not introduce detached jobs, operation polling, compensating imports, or a new workflow engine. Keep private input/result content out of logs.
