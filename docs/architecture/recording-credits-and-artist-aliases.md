# P2: recording credits and artist aliases

Status: design approved by Guide Fari in this thread, after the simplified summary and approval question. Nothing here approves schema edits, implementation, production policy, migration, merge or deployment. Tracks #515 under #512; implementation successor #524 also needs #514 and #523.

## Evidence and boundary

Inspected at `prod` base `aec2782a97bd91e2f030ef05095f76b54fcc79b1`:

- `apps/server/src/db/music-entity.schema.ts`: album/track artist junctions have a composite target/artist primary key, one nullable free-text `role` and `displayOrder`. One artist cannot have several distinct role rows on the same target. Album and track `artistNames` are separate JSON display fields.
- `apps/server/src/services/music-entity/{album,track}.service.ts`: create/update accepts `artistIds` and `artistNames` separately. Nonempty `artistIds` upserts junctions/order, rather than replacing the set; an empty array does not clear them. Direct junction writers also exist. Do not reinterpret these old inputs as recording credits.
- `apps/server/src/services/music-entity/artist.service.ts`: names are not unique; `findOrCreateArtist` uses a case-insensitive name lookup. New aliases must not extend that lookup or silently resolve a new name to an existing artist.
- `apps/server/src/services/canonical-music-identity/{contract,entity-record}.ts` and schema: source identities bind provider IDs/canonical URLs to entities. `music_source_aliases` contains alternate URLs, not artist names. These remain separate.
- `packages/api/src/music.ts` and `apps/server/src/http/music.handlers.ts`: current public music reads and admin-only music writes are not a credit/alias contract. Catalog creation ownership does not grant non-admin write permission.
- `apps/www/src/page/dashboard/page/catalog.ts`: browser catalog writes include `artistNames`; existing responses and cards consume it. New facts must not overwrite this display field.
- `packages/core/src/editorial-mcp.ts` and `apps/server/src/mcp/server.ts`: current scopes are editorial, with four tools and no music-credit or artist-alias command. Installed Effect is 4.0.6; the server selects MCP 2026-07-28. P0/P1 own future scopes, composition, shared errors and receipts. No protocol API is proposed here.

The optional parallel-work and MCP-reference documents were absent in this checkout; the issue's self-contained gates apply. No relevant music-model ADR appeared in `docs/adr/`.

## Recommended domain decisions

1. A **recording credit** states who contributed, what they did and how the source credits them. It does not determine headline artist billing. Support track credits and explicitly album-wide credits; never copy album credits onto tracks or infer that they apply to every recording. A track ID is the current catalog target, not a claim that GBFM has a distinct recording/work/edition model.
2. Support four role codes initially: `performer`, `instrument`, `producer`, `engineer`. `instrument` requires an instrument name; the other roles forbid that field. Use `performer` for vocals or performance when no instrument is specified. Do not infer producer/engineer facts from `primary`, `featured`, `producer` or other old junction values. Do not silently broaden roles into composer, mixer, mastering engineer or free-text role synonyms.
3. A credit always retains `creditedName`, exactly as approved after trimming outer whitespace. It may also link to an existing `artistId`. A name-only credit is allowed: a documented engineer need not become a public catalog artist. Linking requires explicit ID selection, not fuzzy name matching. Neither linking nor editing creates an artist, alias, source identity or junction.
4. An **artist alias** is an evidenced alternate name attached to one artist ID. It is not an edge between artist IDs. Two artists may share an alias. Separate public projects or personas remain separate artists even when one person is involved. Same-person/project relationships and merges belong to another design, not this table.
5. Evidence is required for each new fact, but not a full provenance system. Keep a short public source label and optional public HTTP(S) source URL; without a URL require a short evidence note (for example liner notes and page). Record asserting account and assertion time server-side. Store no private notes, source bytes, provider credentials or URL credentials/tokens. Do not fetch URLs during a write or imply source verification. Attribution means an admin asserted the fact, not that GBFM independently verified it.

## Proposed inputs and observable behavior

These are application operations projected later by M2, not new implementations or approved exports. Capability IDs are retained one-to-one:

| Capability | Proposed input | Result and side effects |
| --- | --- | --- |
| `set_recording_credits` | Existing target `{type: track or album, id}`, required `expectedVersion`, `requestId`, complete ordered `credits` array | Replace only that target's structured credits atomically; return the saved ordered set and new version. No target metadata, artist billing, identity, publication or external work changes. |
| `set_artist_aliases` | Existing `artistId`, required `expectedVersion`, `requestId`, complete `aliases` array | Replace only that artist's alternate names atomically; return the saved set and new version. No rename, slug change, artist merge, redirect, link claim or import resolution change. |

Credit item: optional existing credit ID for edits, optional `artistId`, required `creditedName`, role, optional instrument as above, and evidence. Alias item: optional existing alias ID for edits, required `name` and evidence. No client-supplied actor, timestamps, target ownership or display order; array order supplies credit order. Aliases have no preferred/display-name meaning and return in normalized-name then ID order.

Each submitted item is a complete value, not a field patch. Omitting `artistId` on an existing credit explicitly unlinks it while retaining its submitted credited name. Omitting an optional instrument, source URL or evidence note clears that field, subject to role and evidence validation; explicit null is invalid. Required fields must be resubmitted. Evidence uses `sourceLabel`, optional `sourceUrl` and optional `evidenceNote`; a note is nonempty when required. Accept only public HTTP(S) URLs without user information, query strings or fragments, so a source cannot carry access credentials. This is syntax validation, not a network fetch or proof that a source is public.

Recommended bounds: 100 items per replacement; names/instruments 1–200 Unicode code points after trimming; source label 1–200; evidence note at most 1,000; source URL at most 2,048; whole decoded input at most 128 KiB. Reject control characters, unknown fields, duplicate IDs, foreign-parent IDs, nonexistent artist/target IDs and over-limit input before mutation. Empty arrays explicitly clear the owned collection. Missing/null arrays are invalid, not clears. Omitted items are removed; never partially accept a batch or silently truncate an existing larger collection. Read contracts must disclose over-limit state so editors cannot accidentally replace a partial page.

Admin collection reads return the complete ordered collection and its write version, not a version for one page. A collection larger than the write limit must return an explicit non-editable/over-limit result rather than a replacement-ready partial array. Public projections may omit fields but must never supply their redacted output as a complete editable collection. Concrete read-tool names and shared DTO exports belong to R1/P1, not P2.

Required failure meanings are invalid input (including duplicate facts and invalid supplied row IDs), access denied, target not found or not visible, stale version, changed retry payload, expired retry and storage failure. Authorize before disclosing row/target details. Each failure leaves the collection unchanged; a storage failure must not claim success. P1 owns exact error codes and transport mappings. These meanings are fixed by this design; choosing shared names is an integration task, not a new P2 owner decision.

### Identity and duplicates

- Normalize comparison keys with Unicode NFC, trim/collapse whitespace and locale-independent Unicode lowercase. Preserve accents, punctuation and the approved display spelling. This is duplicate detection, not proof of identity; do not use SQLite `lower()` as a substitute for the specified Unicode normalization. Version the normalization rule in the implementation contract.
- Credit duplicate key within one target: participant key + role + normalized instrument (empty for other roles). Participant key is the explicit artist ID if supplied, otherwise normalized `creditedName`. Thus one artist may play piano and bass and also produce. The same artist/role/instrument under two spellings is rejected rather than double-counted.
- Distinct explicit artist IDs may share the same credited name. A name-only row and an ID-linked row remain distinct unless the editor explicitly reconciles them; do not infer their identity. Linking a row that would collide with another must fail the whole replacement and request reconciliation.
- Alias uniqueness is `(artistId, normalizedName)`, never global. Reject an alias equal to that artist's current normalized primary name. Alias spelling or evidence edits retain the alias ID when supplied. Removing an alias does not reserve its spelling or delete credits bearing that name. Renaming an artist neither creates an old-name alias nor rewrites credited names; check the new name against existing aliases and require explicit reconciliation, not silent deletion.
- Existing row IDs retain identity across field/order changes; unknown supplied IDs are rejected, omitted IDs allocate new rows. Clients retain request IDs across timeouts to avoid creating duplicate facts.

### Authorization, visibility, versions and retries

Recommendation: retain admin-only catalog mutation, enforced in the application service for both browser and MCP. Also require an active, unbanned account and P0/P1-approved music-write authority for MCP; exact scope names and production enablement remain undecided. `createdById` is not a delegation to edit, and `drafts:write` never grants this authority. Check authorization again on retries before returning a receipt.

Treat names, roles, instruments and public evidence as catalog data. New public read projections should expose facts only for published target entities; omit a linked artist ID if that artist is not publicly visible, retaining `creditedName`. Public aliases require a published artist. Admin reads may include unpublished entities and assertion metadata; public reads omit actor IDs and private target existence. Do not silently change current legacy GET visibility in this package. R1/P0 must agree the new projection rather than presume existing GET routes enforce these rules.

All writers of the new collections must use the same version guard. M1 owns the concrete revision/version mechanism; do not use `updatedAt` alone or invent a second ledger. A collection read must supply its complete-set version, including ordered credit fields/evidence and alias comparison dependencies such as current artist name. Artist renames/deletions and any future collection writer must invalidate or check the relevant version atomically. Missing/deleted parents fail; stale versions conflict without writes. A write must guard and replace in a single D1 atomic unit, with the receipt, so a failure cannot leave a partial collection or receipt-only success.

Reuse P1/M1's approved request-key scope, receipt retention and replay semantics; this design does not approve copying the editorial-only receipt storage. Required behavior: same request ID plus same payload replays the original saved result after later edits; different payload conflicts; two concurrent edits from one version have one winner; expired retries never execute a second mutation. A no-op returns the current version without changing facts, and records/replays its result under the same rules. Shared error codes and retention duration must be recorded before M2 starts.

## Smallest proposed storage change — review only

Two new fact tables, not replacements for junctions or canonical identities:

| Proposed table | Columns and constraints |
| --- | --- |
| `music_recording_credits` | UUID primary key; nullable track FK and album FK with an exactly-one-target check; target deletion cascades. Optional artist FK with delete restricted until explicit unlink/removal. Credited name and comparison key; role checked to the four codes; nullable instrument and comparison key with role/instrument check; participant comparison key; nonnegative display order; evidence fields; asserting account reference and timestamps. Partial unique indexes on each target + participant key + role + instrument key, with target/order/ID read indexes. |
| `music_artist_aliases` | UUID primary key; required artist FK with delete cascade; name and comparison key; evidence fields; asserting account reference and timestamps. Unique artist/name-key index; normalized-name lookup index returns candidates, never a canonical match. |

Asserting account references should allow account deletion (`SET NULL`) without deleting public facts. Updates record the current asserting account/time; this is last-assertion attribution, not an audit history. Comparison keys are non-null; absent instruments use an empty key so SQLite uniqueness still rejects duplicate non-instrument roles. Prefix participant keys with `artist:` or `name:` to keep ID and name namespaces distinct. Clients cannot write comparison keys; services must keep the participant key consistent with artist ID/name. FK checks, role/target checks and duplicate indexes remain database constraints. Cross-row primary-name and normalization rules need the common guarded service, not schema claims that SQLite cannot enforce.

No new generic contributor entity, role registry, provenance graph, editions, aliases between entities or operation ledger. The approved M1 revision mechanism may require additional parent columns; those changes need a separate explicit schema reservation and review. No migration number or SQL is allocated here.

### Migration and coexistence plan

1. After recorded approval, a named migration coordinator reserves schema, migration filename, replay list and exports. M2 waits for approved P0/P1 and M1 contracts; merge prerequisites before an independent M2 branch unless one exact unmerged prerequisite warrants a documented stack.
2. Create empty fact tables on disposable migrated D1 first. Backfill nothing: old junction roles and name strings do not prove instrument, production, engineering or alternate-name facts. No source identity data moves.
3. Keep existing junction APIs, browser forms, artistNames and responses unchanged. New credit writes do not rebuild artistNames or junctions. Old full-state browser saves must leave the new collections untouched. Imports/refreshes do not add, replace or clear these facts unless a later approved writer uses this same contract.
4. Extend artist rename/delete service paths only under coordinated ownership to enforce alias collisions and restricted credit links. Parent track/album deletion removes credits atomically; artist deletion with linked credits fails until an admin explicitly unlinks/removes them. Artist aliases alone may cascade on artist deletion. No hidden mass credit deletion or name-to-ID reassignment.
5. Add explicit read projections for the new collections through the existing application boundary. Browser and MCP must see the same facts/order/version when they request that projection; this does not require a new browser editor in P2. Coordinate schema and service changes with M1 and read projection changes with R1. P4 references continue to use canonical IDs; they do not acquire alias or credit semantics.
6. Verify forward migration/replay against the repository replay list. If rollout fails, disable the new writers and retain tables/data; do not drop facts to roll back an application deploy. Destructive rollback or production migration needs separate approval.

## Required M2 evidence, not tests claimed by this design

Run on disposable migrated D1 through application/HTTP/MCP boundaries, not only domain mocks:

- Same artist plays piano and bass and produces on one track; an exact duplicate fails. Two distinct artists credited as “Echo” remain distinct; alias “Echo” on each artist is allowed. Composed/decomposed accented aliases collide for the same artist; accented versus unaccented names do not.
- Unknown name-only engineer remains name-only after an alias with that spelling is created elsewhere. Canonical provider IDs and source URL aliases are unchanged.
- Update one row, remove another by omission, then clear with `[]`; omitted/null input fails. Reordering retains IDs. Album-wide credits never appear as asserted track credits.
- Admin and non-admin browser/API/MCP callers exercise denial, approved/missing scope, unpublished read redaction and revoked-account retry denial.
- Two clients replace from the same version; only one wins. Exact retry after another write returns the saved result without undoing it. Changed request payload conflicts. Injected storage failure rolls back both collection and receipt. Check deletion/rename races too.
- An old browser full-form save, junction write and canonical refresh preserve the new facts; a credit replacement preserves old billing and display names. Artist rename collision needs reconciliation; artist deletion cannot orphan linked credits. Public actor IDs never leak.
- Reject 101 items, an over-limit payload and malformed evidence before writes; never offer a truncated collection as a complete replacement input.

P2 changes only this document. No new runtime, migration or end-to-end behavior exists to verify. Record precommit outcome separately; do not label the base SHA as a tested M2 implementation. Design verification checks the documented behavior and boundaries, plus repository precommit checks; the scenarios above remain required M2 evidence, not P2 test claims.

## Approval record and remaining gates

Owner: Guide Fari. Approval: **design approved**. In https://ampcode.com/threads/T-01a1b543-d431-710a-876e-9037353d2be3, Guide Fari answered “yeah” to the design approval question after the simplified summary. That question explicitly excluded implementation and database migrations. The approved design decisions are:

1. Domain: keep old billing separate; support track and explicit album-wide credits with the four roles and name-only contributors; aliases attach to one artist and never merge IDs.
2. Behavior: whole-collection replacement; required public evidence; admin-only writes; proposed bounds and new-read visibility; explicit reconciliation on artist rename/delete.
3. Storage direction: the two-table additive proposal with no inferred backfill. Approval of this design is not approval to edit the schema, run a migration or ship M2. Record schema-edit approval explicitly and name the migration coordinator before schema edits.

P1 integration owner and migration coordinator are roles, not assigned people in this document. P0 exact permission/visibility decisions, M1 versions and P1 receipt/error contracts remain integration gates for #524. No shared source files are reserved by P2. This design has no stack; its only owned file is this document on `design/p2-recording-credits-aliases` in `/home/user/workspace/gbfm-p2`.
