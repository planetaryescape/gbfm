# Multiple structured music references in an editorial draft

Status: **P4 consolidated design approved; E3 implementation allocation pending**. Design for #517, under #512. Guide Fari's approval below covers the surfaced recommended model, bounds, storage direction, privacy/read amendment and published managed-state compatibility rule. Runtime work belongs to E3 #532 after its technical prerequisites and serialized P1 allocations. Production migration, deploy and live-policy/data activation remain excluded.

## Summary

Let an author deliberately associate several existing catalogue albums, tracks or playlists with one unpublished editorial draft. Keep their order and an optional primary association separate from body mentions and embeds. Save associations under the same post revision as text. Never publish, import music, rewrite the body, or replace unsaved browser text as a side effect.

## Current state and evidence

Inspected at prod `aec2782a97bd91e2f030ef05095f76b54fcc79b1`:

| Source | Observed behavior |
| --- | --- |
| `apps/server/src/db/post.schema.ts` | Posts store one nullable `musicEntityType`/`musicEntityId` pair and an index on that pair. Allowed attachment types are album, track and playlist. There is no ordered association collection here. |
| `packages/rich-content/src/source.ts` | Body source can contain many `MusicCatalog` or `MusicUrl` embed references. Embeds express authored layout, including repeats and track display options. |
| `apps/server/src/services/rich-content-music.service.ts` | Rendering reads existing catalogue identities and builds inert snapshots. Unavailable music renders as unavailable; the resolver does not import or scrape. |
| `apps/server/src/services/post.service.ts`, `compilePost` | `richContent` is rendered from `post.content` on reads. It is not a separate persisted reference list. |
| `apps/server/src/services/post-music-resolution.ts` | Saved-post resolution can call canonical source resolution, then writes the single attachment with an updated-at comparison. Multiple body candidates are rejected; artist links cannot attach. This is not a side-effect-free association lookup. |
| `apps/www/src/page/creator/services.ts` | Editorial saves send `expectedUpdatedAt`; local-draft reconciliation keeps later local edits and advances the known remote revision after successful saves. |
| `apps/www/src/page/creator/update.ts`, `PostMusicResolved` | A matching resolve response changes attachment metadata and revision while retaining current text. Editor/request identity rejects stale responses. |
| `apps/server/src/mcp/model.ts` | `PostVersion` hashes authored post fields, creators, tags, updated-at, and the current single attachment pair. Resolved catalogue snapshots are not hashed. |
| `apps/server/src/mcp/contracts.ts`, `drafts.ts`, `draft-store.ts` | MCP draft updates require expected version and request ID, enforce creator membership and unpublished editorial type, and atomically save an update with its receipt. Identical retries replay for 24 hours; changed inputs conflict; expired receipts do not rerun writes. |
| `apps/server/src/db/guarded-post-update.ts` | The existing PAT save path guards dependent writes and saves the post last in a D1 batch. The ordinary browser path is not the same batch; do not assume all current save paths already provide multi-row atomicity. |

Installed server dependencies declare Effect 4.0.6 and Drizzle 0.45.4. The MCP specification reviewed is https://modelcontextprotocol.io/specification/2026-07-28/index.md. This proposal adds no protocol extension or SDK call. Server authorization remains mandatory; annotations and confirmation UI do not authorize writes.

## Problem, callers and goals

One primary pair cannot represent an ordered set of deliberate associations. Extracting every embed or URL would mistake a mention for an association and couple reference removal/reordering to text edits.

Callers are the browser editorial composer and a later E3 MCP projection of the same application behavior. Success means both can read, replace, reorder and remove associations without losing the existing primary or silently overwriting another writer.

## Proposed behavioral contract

These are recommendations, not approved requirements. Detailed Effect schema/service sketches are in [03-contracts.md](03-contracts.md); those contracts supersede preliminary transport assumptions below. Storage alternatives are in [01-shape.md](01-shape.md), flows in [04-flows.md](04-flows.md), ownership in [05-file-map.md](05-file-map.md), test slices in [06-test-plan.md](06-test-plan.md) and delivery boundaries in [07-pr-slices.md](07-pr-slices.md).

### Collection, order and primary

- A collection contains 0–50 distinct catalogue targets. A target is `(entityType, entityId)`, where type is `album`, `track` or `playlist`, and ID uses the existing catalogue UUID format. Fifty is a proposed product limit, not an observed current limit.
- Array order is editorial order. Reject duplicates rather than silently deduplicating or sorting. The same UUID in different entity types is not the same target.
- The collection has an explicit `primary` target or `null`. A non-null primary must occur exactly once in the collection. Primary does not have to be first. Reordering does not change it.
- Removing the primary requires the submitted replacement to choose another member or `null`; never silently promote the first reference. Removing an association never removes an embed or text mention.
- References have no per-item visibility, free-form URLs, captions, import state, provider snapshots or generated reference IDs in this slice. Their catalogue target is their identity within the post.

Example wire-shaped value (illustrative IDs; not a committed API schema):

```json
{
  "references": [
    { "entityType": "track", "entityId": "f3d18616-3f22-4ad7-9d78-813be037717d" },
    { "entityType": "album", "entityId": "21c8e414-c8c9-4f35-b8bb-2a22d258b8b8" }
  ],
  "primary": { "entityType": "album", "entityId": "21c8e414-c8c9-4f35-b8bb-2a22d258b8b8" }
}
```

### Read and save semantics

- Expose this value as `musicReferences` on an authorized editable draft read. The successful save returns the saved value, post identity, `updatedAt`, opaque `PostVersion` and the existing review URL. Response snapshots are display data, not writable author data.
- A patch omitting `musicReferences` preserves all associations and the primary. Providing it replaces the entire set and primary. An empty list plus `primary: null` explicitly removes all. Reject a null collection, unknown fields, malformed pairs, a nonmember primary, invalid types, duplicates and oversized input before writing.
- Browser saves can change references alongside text or as a reference-only patch. MCP uses the selected `set_draft_music_references` command, leaving legacy create/update inputs and outputs unchanged. Do not require callers to resend text to change associations. One accepted command advances the post revision once. Do not introduce per-reference versions, merge-on-conflict, or extra incremental tools in this slice.
- Existing single attachments remain represented as a one-item collection with that item primary. A draft with no attachment starts empty. An update that omits the collection must never erase a legacy attachment. Invalid legacy pairs must surface as a repair-required read/save failure rather than silently becoming empty; the implementation gate must establish whether any such rows exist using an authorized, non-production fixture or separately approved audit.
- Existing single-pair readers continue to see the selected primary. A legacy single-pair update, when supported for editorial drafts, must preserve secondary references: selecting a new primary adds it if absent; clearing the pair clears primary only. Reject contradictory old-pair and new-collection input. Micro-post semantics remain unchanged. E3 must enumerate all single-pair writers, including saved-post resolve, before allowing multi-reference drafts through those routes.

### Source validation and visibility

- Accept only existing catalogue targets on draft save. Validate type and existence server-side, and apply the target's actual read policy. Do not infer access from a title, URL, embedded snapshot, or caller-supplied type alone.
- URL lookup may suggest an existing resolved target using the canonical parser/repository; attaching it requires deliberate author action. Unknown, unresolved, ambiguous or type-mismatched sources do not attach. Artist/label targets are excluded.
- Saving or reading associations performs no provider fetch, catalogue import, identity merge, artwork upload, metadata update or background job. A URL that needs import goes through the separately authorized import lane first, never through an implicit save fallback.
- Association visibility follows the post. Draft associations must not appear in anonymous post reads, public music backlinks, recommendations, public counts, cache entries or research output. Private target details must never become public through a draft association. This proposal restricts new associations to publicly readable catalogue targets; private library records are not catalogue targets for this operation.
- A later missing/unreadable target does not silently drop or reorder the association. Authorized draft reads retain its target identity with an unavailable display state, without leaking hidden target details; the author may remove it. A save that explicitly submits such a target rejects the whole replacement. Text-only saves can preserve unchanged stored associations. Target deletion/merge policy is not changed here.
- Public rendering, publication validation, backlink expansion and changes to already-published posts remain outside P4/E3 draft writes. No association change publishes a post or sends notifications. Public readers may continue to use the existing primary projection until separately designed public behavior is approved.

### Authorization

- MCP reads require the approved read permission; mutations require an approved draft-write permission plus a current eligible, non-banned account and creator membership on an unpublished `type: post`. An admin role alone does not bypass the MCP authored-draft rule.
- P0 D1–D6 now have recorded design approval. E3 requires `posts:read` AND `drafts:write` AND `catalogue:read`; public albums/tracks follow the public projection rather than a publication-timestamp gate, while public playlists require non-null publication time not in the future. P1 must implement the approved shared contract; production policy activation remains separately unapproved. Optional reference enrichment on existing `get_post` is a narrow additional design amendment, not covered by P0's unchanged-results approval.
- Browser/session and PAT paths retain their own current role/owner/scope rules, including explicit admin behavior where it exists. They must not gain a role bypass or publication privilege by supplying the new field. PAT field allowlists must reject or deliberately authorize it, not ignore it.
- Recheck authorization at commit and before receipt replay; reject deleted, published or no-longer-owned drafts. Use existing not-found/access-denied projections without disclosing another author's content or target details.

## Revision and atomicity invariants

1. Hash the canonical ordered target list and explicit primary into the existing post version, alongside the existing fields. Do not sort the list. Do not hash mutable provider titles/artwork or rendered snapshots. Reads must obtain one coherent post/reference/creator/tag snapshot, not combine revisions across sequential queries.
2. Every writer that changes references or the primary must advance the same monotonic `updatedAt`, including browser, PAT and saved-post resolution paths. Browser reference-bearing edits require `expectedUpdatedAt`; MCP keeps mandatory `expectedVersion`. Both represent one post revision, not independent clocks.
3. Check the expected version against stored authored state and enforce the same prior state at commit. A preflight hash comparison alone is not a concurrency guard. Preserve the existing stronger MCP creator/tag/field predicates or an equally strong shared invariant; do not reduce them to an unguarded read followed by a write.
4. Replacement rows, primary projection, text changes, updated-at and MCP receipt must commit together or not at all. A failed/stale/unauthorized request must not delete rows, change ordering, leave a receipt or partially save text. Guard every dependent write, not just the final post update. Revalidate target existence/read eligibility within the commit boundary where mutable.
5. Use one bounded D1 transaction/batch through the existing save ownership boundary. Do no network work inside it. If future storage is relational, the receipt insertion cannot rely on a changed `changes()` value from a reference insert/delete; prove it is gated by the winning post transition. Preserve receipt replay semantics rather than adding a second operation ledger.
6. A successful explicit save may advance the revision even when values are identical, matching current update behavior. An identical MCP request-ID replay does not advance it again. Include field presence, ordered references and primary in the input hash: omitted, empty, reordered and different-primary requests are not interchangeable.
7. Retain the 24-hour MCP retry window: same actor/request ID plus identical input returns the original saved result after access recheck, even after later edits. Changed input conflicts; expired retries do not mutate. A replayed historical result is not evidence of the current version; read again before another edit.

## Browser and MCP save flows

**Browser:** Load editable draft and revision. Keep text and references in the local draft. Add/remove/reorder changes locally; perform side-effect-free target lookup separately. Submit only the fields intended for this save with the loaded expected revision. On success reconcile the submitted snapshot with the current local draft: keep text/reference edits typed during the request, advance remote identity/revision only for the matching editor/request, and do not replace the form with the server body. On conflict keep all local state and the old base revision; offer an explicit compare/reload/reapply flow. Never automatically take the latest revision and resubmit stale local content. An explicit reload that discards local edits requires user action.

**MCP:** Read the authorized draft, including associations and version. Submit new request ID, post ID, expected version, and a complete replacement only if references change. Parse, authorize, check replay, load a coherent snapshot, validate targets, compare version, then execute the guarded atomic save and return its stored result. After a lost response retry the exact input/request ID; after conflict read again and make a deliberate new edit. MCP never carries or overwrites unsaved browser text. A later stale browser save must conflict and retain its local draft.

## Storage decision for owner review

**Existing rich-content storage is not sufficient for deliberate associations.** It stores body source and derives embed snapshots; it does not own an independently ordered set with an optional primary. Deriving from embeds changes the meaning of the body; hiding JSON/directives in body source would make reference-only edits rewrite text. Do not overload `richContent` or scrape mentions.

Recommend a small ordered post-to-catalogue relation in a later approved schema change, with unique `(postId, entityType, entityId)` and `(postId, position)` constraints and explicit primary projection. Retain the current single pair as the primary projection for existing consumers, with one transactional writer for both representations. This compatibility requirement comes from #517's explicit no-loss gate, not a general dual-storage framework. Exact DDL, polymorphic target integrity, primary-membership enforcement and existing-row preservation must be reviewed with the migration coordinator; **no table, column, migration or backfill is approved or created by this document**.

A dedicated JSON field on `posts` is the credible alternative: one-row CAS and less multi-row write risk, but weaker relational constraints and less direct reverse lookup. It still needs approved schema work. Decide this before storage-specific DDL/implementation; the logical contracts and test slices can be drafted without that choice. Do not pretend the current text embeds avoid a schema decision.

## Discriminating implementation evidence required later

- Keep an existing album primary while adding a track before it; reorder with no primary change; remove the primary only with an explicit replacement primary/null. Removing a body embed must not alter associations, and vice versa.
- Missing collection versus explicit empty collection must differ; reject duplicate/type-mismatched/nonmember-primary/51-item inputs. Exercise the 50-item boundary with mixed, distinct targets.
- On migrated disposable D1, race MCP reference reorder against a browser text save from the same revision. Exactly one wins; losing text stays local and the stored body, list, primary and receipt all describe the winning revision.
- Inject failure between relation writes, post update and receipt insertion; verify complete rollback. Race creator loss, publication and target deletion at the actual commit boundary.
- Retry the same request after a later edit: replay the original result without restoring its list. Reuse its ID with a changed order/primary: conflict. Retry after expiry: no write.
- Read another author's draft, its music backlinks and public lists: no draft association leak. Verify target disappearance does not expose private metadata or silently change association state.
- Exercise existing single-pair HTTP/PAT/resolve routes against a multi-reference fixture: preserve secondary targets or fail explicitly, never truncate the list. Prove URL lookup and draft save do not invoke imports/providers.
- Run the composed browser/MCP scenario and real D1/service/protocol tests on the final integrated E3 SHA, plus `bun precommit`. Domain mocks alone do not satisfy the gate. P4 has run no new behavior because it implements none.

## Non-goals and constraints

No tool is added by P4. E3's selected behavior is association of music with drafts, not deferred `validate_draft_music`, new artist references, batch imports, arbitrary external URLs, recommendation sequencing, publication, public backlinks, private-media authorization or catalogue merge design. P2 owns credit/alias models; P3 owns recommendation contracts. P0/P1 own permission/registry integration. E3 must build on E1 rather than race its save/version changes. No schema or shared runtime files are reserved by this design lane.

## Validation and delivery state

Only this design folder is changed by P4; runtime files are unchanged. The first `bun precommit` attempt used only a root dependency symlink, omitted workspace-local dependency links and failed lint/type resolution. After `bun install --frozen-lockfile` in this isolated worktree (including the existing prepare patch), `bun precommit` passed, as did three existing real D1 suites: 3 files, 14 tests. This distinguishes a worktree dependency/setup failure from a demonstrated baseline code failure. Exact commands and limits of this evidence are in [08-validation.md](08-validation.md). No new reference behavior exists to exercise; the new test slices remain future E3 acceptance evidence. Document delivery follows [07-pr-slices.md](07-pr-slices.md); no merge or deployment is authorized.

## Owner decisions and approval record

### Five choices in plain English — recommended answers

1. **What can an author link?** Use albums, tracks and playlists that already exist in the catalogue. Keep the list separate from the article text. Do not import music during a save.
2. **What does the main link mean?** Let the author choose one main link or none. It need not be first. Keep list order. Keep existing links when old tools save the draft.
3. **How much can a draft link, and who can see it?** Recommend at most 50 links. Accept only public catalogue targets. Keep draft links private with the draft. This is a proposed bound and privacy policy, not a new permission grant.
4. **Where should links be stored?** Recommend a small ordered relation with checks that prevent broken links. Keep the current main-link fields for old readers. A new JSON field is the alternative. Both need separate schema approval and a named migration owner.
5. **How should an agent read links?** Recommend an optional field on `get_post`. Return it only with catalogue read permission. Keep old create/update replies and saved retry results unchanged. P0 recommends this narrow amendment but its approval does not cover it.

### One consolidated gate before implementation

Guide Fari must record approval of the P4 model, its public-target/draft privacy boundary and the narrow `get_post` amendment, and select storage/integrity direction. Recommend the five answers above as one design package, rather than five serial checkpoints. Without an approved reference read, keep the complete-replacement MCP write unregistered. Recommend freezing primary and collection on published posts with managed reference state, rejecting legacy pair changes there rather than splitting their meaning; existing published single-pair behavior remains unchanged. This compatibility restriction also belongs to this gate. Exact DDL/migration, legacy-row preservation and a named migration coordinator still need explicit schema authority before any schema edit. Production migration/activation, merge and deployment remain excluded even after design approval. PL1 #533 must deliver verified shared playlist visibility before affected reads/consumers enable; P1 must coordinate shared result/version ownership and E1's save seam. These are implementation prerequisites, not reasons to withhold this document PR.

Owner response on 2026-11-07: Guide Fari said, “ok this seems okay” after the explanation of separate draft-to-music connections. This accepts the purpose, not every rule or schema work. Later direction authorizes completing the review-ready document PR with conservative recommendations and one explicit gate. #517 remains open until recorded owner design approval. E1's actual save exports, P1 shared-file coordination and the migration owner remain implementation gates. Do not infer approval from document publication or reviewer approval.

### Superseding recorded approval — 2026-11-07

Guide Fari's direct approval, relayed by [the Space coordinator](https://ampcode.com/threads/T-01a1b54f-7ac1-7503-9b0f-ffaf3fbc6c3e):

> everything that needs my approval, you have my thumbs up; the claude threads that got stuck because of limits, you can take that wrok over as a medium sol thing instead

The coordinator explicitly applies this approval to the consolidated P4 recommendations already surfaced. It resolves the owner design gate for ordered album/track/playlist references, optional independent primary, maximum 50, public catalogue targets/private draft associations, ordered-relation/integrity direction, optional scope-gated get_post enrichment, and published managed-state freeze with no backfill-induced freeze. Earlier unapproved/proposed labels record the review history; this approval supersedes their owner-decision status, not technical prerequisites.

E3 implementation is authorized within the lane, but P1 still serializes exact migration filenames/replay/exports, durable managed representation, shared save/version/get_post/receipt seams and file allocations. No shared-file edits precede that allocation. E1 #530 and P1 #514 remain hard technical dependencies; PL1 shared playlist privacy consistency must be verified before affected consumers enable. Keep MCP PRs open and unmerged with no auto-merge. No production migration, deployment or live-policy/data activation is authorized. The completed #557 Claude review has no remaining findings and is not limit-blocked; no replacement reviewer is needed for it.
