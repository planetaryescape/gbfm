# P3: Explainable music recommendations and sequencing

Status: **design approved by Guide Fari on 2026-11-07; PR #545 awaiting review**. Design only for
[#516](https://github.com/planetaryescape/gbfm/issues/516), under
[#512](https://github.com/planetaryescape/gbfm/issues/512). This document neither
registers tools nor approves R2 implementation, production policy or deployment.

## Approved design decision

Return deterministic catalogue evidence, not server-generated musical judgments.
The client may use that evidence to suggest an editorial angle, but must label its
own interpretation as a suggestion. Use no model provider, embeddings, audio
analysis, external fetches or private listening data. The three selected capability
IDs remain separate read-only tools; no selected behavior is silently consolidated.

For sequencing, offer **album blocks in recorded track order**, not a DJ mix or an
energy curve. Preserve every playlist member. A proposal never applies itself.
Guide Fari approved this limited meaning of “similar” and this sequencing
strategy. Other algorithms require another explicit decision.

## Evidence checked at the base revision

Base: `aec2782a97bd91e2f030ef05095f76b54fcc79b1` (prod, release 2.127.0).

| Source | What it supports; limits |
| --- | --- |
| `apps/server/src/db/music-entity.schema.ts` | Track → album; album/track → artist junctions with nullable role; artist/album → music-label affiliations; playlist membership, position and revision. No typed BPM, key, energy, listening or influence relation. Denormalized artist names are display text, not identity evidence. |
| `apps/server/src/db/{tags.schema,labels}.ts` | Genre/tag assignments have stable label IDs and a kind. A genre label is not a record-label affiliation or proof of sound. |
| `apps/server/src/services/music-entity/{track,album,artist,playlist,playlist-tracks,label-affiliation}.service.ts` | Existing reads and writes are distinct. Several raw reads are unbounded or not visibility-filtered; they are not ready-made safe recommendation seams. Public affiliation reads check publication time. |
| `packages/api/src/music.ts` | Current entity projections include nullable metadata. Track response does not expose all relationship/genre evidence. Do not pretend the future R1 projection already exists. |
| `apps/server/src/db/post.schema.ts`, `services/post.service.ts` | One primary structured music reference (album, track or playlist); public/authored source reads. Candidate coverage must use authorized structured references, not guessed free-text mentions. |
| `apps/server/src/services/rich-content-music.service.ts` | Inert render-time snapshots from explicit references; not a complete searchable coverage index or proof that every body mention resolves. |
| `apps/server/src/mcp/{server,contracts,editorial,model}.ts`, `packages/core/src/editorial-mcp.ts` | Four shipped editorial tools, current principal/scopes and version/error conventions. No recommendation toolkit. Keep existing authorization unchanged. |

Effect is pinned to **4.0.6**. The installed `effect/ai/McpProtocol` exports
`v2026_07_28`, used by the current server. Future implementation must use its
schema/tool APIs, not an older SDK example. Protocol reference:
[MCP 2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
The parent-mentioned parallel-work and protocol-reference documents were not
present in this branch; the issue's self-contained rules govern this proposal.

## Shared wire contract (proposal v1)

This is a semantic contract, not new TypeScript exports. P1 owns final shared
schemas, principal, scope spelling, discovery, error mapping and protocol fixtures.
Reject unknown fields and unsupported strategy values; never silently reinterpret
an ID or resolve/import a URL. IDs are nonempty opaque strings, at most 200
characters. `MusicRef` is `{entityType: artist|album|track, entityId}`; narrower
cases below are intentional. Identity matching uses `(entityType,entityId)`, never
names or URLs. These are the canonical P0 wire/fixture key names, not `{type,id}`.

Every success includes:

- `contractVersion: 1`, `algorithmVersion` (specified per tool), endpoint identity,
  `observedAt` (UTC), and `status: sufficient|insufficient_evidence`.
- `inputs`: canonical seed references and their read versions; a `basisDigest`
  over canonical inputs, algorithm version and all evidence used. Use the encoding
  below; it is a content fingerprint, not authorization or a promise of a global
  database snapshot.
- `evidence[]`: local result IDs, a typed relationship kind, subject/object stable
  references, source entity/relationship locator, observed values and source
  version/fingerprint. Public GBFM URLs may accompany locators; no raw database
  rows, private creator IDs, provider metadata blobs or bodies. IDs within a result
  resolve locally; there are no hidden server-side suggestion handles.
- `limits[]`: typed missing-data/truncation notices; `candidateWindow` gives the
  number of visible candidates examined, the cap, and whether that window was
  truncated. No total counts or hints about invisible rows.
- Each returned candidate or changed sequence block cites its evidence IDs and
  a bounded template explanation (at most 500 characters). No confidence percentage,
  affinity score, popularity score or historical-fact field.

Evidence kinds are `same_album`, `shared_artist`, `shared_music_label`,
`shared_genre`, `post_music_reference` and `album_track_order`. Each relationship
locator names its relation kind and endpoint IDs; shared relations include the
common album/artist/label ID. `album_track_order` includes each member's track ID,
original position and nullable recorded track number. Every evidence record has
`id`, `kind`, `subjects`, `sourceLocator`, `sourceFingerprint` and `observedAt`;
the kind selects the allowed values, not an arbitrary metadata bag. Fingerprints
cover junction values too, since entity updatedAt alone cannot version a relation.

Fingerprint encoding: use SHA-256 over UTF-8 JSON with object keys sorted by
Unicode code point, no whitespace, arrays in their specified order and no Unicode
normalization. Values are JSON strings, booleans, null and safe integers only;
represent timestamps as UTC ISO strings. Encode the result as `sha256:` followed
by 64 lowercase hexadecimal digits. Source fingerprints cover the authorized
source reference and the projected values used, including junction endpoints and
roles when used; do not hash inaccessible fields or whole raw records.

For `basisDigest`, encode `{contractVersion, algorithmVersion, inputs, evidence,
result, limits}`. Here `inputs` includes effective defaults and source versions;
`result` contains the ordered candidates with tiers or the complete original and
proposed sequence with its revision. Sort evidence by `(kind, sourceLocator)`
using code-point comparison of the encoded locator; assign local evidence IDs
`e1`, `e2`, etc. in that order. Deduplicate identical locators. Sort limits by
code then affected reference. Exclude observation timestamps, endpoint identity,
explanation text and the digest itself. Canonical fixtures use P0's
`entityType`/`entityId` keys and `sufficient` status; the earlier P3 spelling
`evidence_found` means exactly `sufficient`, not a different evidence threshold.
The digest envelope includes this canonical status in `result.status` for both
outcomes. Freeze this representation in R2 fixtures; do not hash a pre-mapping
`type`/`id`/`evidence_found` object. Any later wire-name change requires an explicit
contract version and fixture update, not a transparent digest-preserving rename.

Three distinctions are mandatory:

1. **Recorded relationship**: “These tracks share recorded artist A.” Proves only
   the catalogue assertion at observation time; a role is quoted only if recorded.
2. **Assistant suggestion**: “Consider writing about A's appearances together.”
   Generated by the client, outside server result facts; must cite evidence and
   remain a proposed angle, not become an asserted collaboration or influence.
3. **Sourced historical claim**: requires a source that actually states the claim,
   with a locatable passage and date. V1 provides none. Provider links, bios and
   dates alone do not substantiate influence, chronology of a movement or causation.

## `find_similar_music`

Meaning: find **catalogue-related** entities, not “sounds like” recommendations.
Description must state this distinction despite retaining the selected tool ID.

Algorithm version: `catalogue_relations_v1`.
Input: `{seed: MusicRef, limit?: integer 1..20}` (default 10). Output candidates
have the same entity type as the seed, exclude the seed and have at least one
evidence edge. Rank by the first applicable tier, then ascending opaque ID:

1. Tracks in the same known album (tracks only).
2. Shared recorded artist ID (albums/tracks only).
3. Shared explicit music-label affiliation (artists/albums only).
4. Shared direct genre-label ID of kind `genre` (all three types).

An artist seed does not match a track simply by having the same display name.
Do not inherit an album's genre or label onto a track in v1. Do not treat an
artist junction as detailed recording credits; P2's future model is independent.
Playlist co-membership, saves, favorites and listening history are not ranking
signals. Return only the ranking edge as required evidence; optional extra edges
must fit the same bounds and cannot change the specified ordering.

Discovery is one bounded, visibility-filtered union of these relation tiers,
deduplicated by candidate ID at its lowest tier before selecting the first 201
rows in tier/ID order. For several witnesses in that tier, use the lowest common
relation ID as the ranking evidence.
At most 200 candidates enter the evidence window; row 201 only signals truncation.
Rank within that window and return `limit` results. Say “within examined catalogue
relationships,” not “best in the catalogue.” An empty window returns
`insufficient_evidence`, empty candidates and missing relation kinds, not a fallback
to fabricated similarity. Missing fields are unknown, not dissimilarity.

## `suggest_editorial_connections`

Algorithm version: `editorial_relations_v1`.
Input is exactly one of `{music: MusicRef, limit?}` or
`{postId, expectedVersion?, limit?}`; limit is 1..20, default 10. An explicit post
seed may be the caller's authorized draft; it does not enable searching drafts.
An expected post version mismatch is `conflict`, not a result built on new text.
Use E2's structured primary references only; do not scan arbitrary body text,
resolve embeds on demand or require P4's unapproved multiple-reference storage.
A playlist-only primary reference is currently unsupported as a music seed:
return `insufficient_evidence` with `unsupported_seed_relation` and do not expand
its entire membership implicitly. A post with no structured reference similarly
returns `insufficient_evidence` with `missing_structured_reference`.
An eligible `artist` music seed is also unsupported: posts can reference only an
album, track or playlist. Return empty candidates, `insufficient_evidence` and
`unsupported_seed_relation`; do not implicitly traverse the artist's releases.
Keep artist input valid so this outcome is explicit rather than silently dropping
that input type. Same-type matching is intentional: a track seed does not discover
posts about its album unless a future approved contract adds cross-type traversal.

Candidates are published editorial posts (`post`, not micro posts), excluding the
seed post. Rank: (1) same structured music reference, then (2) a structured
reference to a related music entity found by the preceding algorithm's evidence
window (not its default ten-result projection), ordered by that entity's tier,
then post ID. Deduplicate posts before the window cap. Bound
related entities to 200 and candidate posts to 200 (+1 truncation sentinel each).
Evidence is the explicit post → music reference, plus any music → music ranking
edge. Cap each post to its title (200 characters), canonical public URL and
evidence; no body excerpts or unsourced generated angle text in server output.
Omit the seed from public candidate explanations when it is private; its evidence
is returned only to the authorized caller in this request.

This returns possible connections, not comprehensive coverage or a claim that
unreturned music has never been covered. No visible connections yields empty
candidates with `insufficient_evidence`. Retain truncation notices from both
windows; never claim catalogue-wide absence from a capped window.

## `suggest_playlist_sequence`

Input: `{playlistId, expectedRevision: nonnegative safe integer,
strategy: "album_blocks_v1"}`. Read only an authorized, **complete** PL1 playlist
of 0..100 distinct track IDs. An oversized playlist is `invalid_input`; never
propose a partial reorder. Missing/invisible member data needed for a complete
proposal is `unavailable`, without identifying hidden members. Revision mismatch
is `conflict`. PL1 must return a consistent membership/revision read or fail.

Algorithm `album_blocks_v1`:

1. Read original order by `(position ascending, trackId ascending)`; tied stored
   positions produce a notice, not nondeterministic results.
2. Build album blocks ordered by each album's first appearance. A missing or
   unreadable album relation makes that track a singleton block. Never drop it.
3. Within a known album block, sort positive integer track numbers ascending;
   unknown/nonpositive numbers go last. Ties retain original order. Explain this
   as recorded track numbering, not verified release/disc order: no disc-number
   contract exists here.
4. Flatten the blocks. Every input ID occurs exactly once; output new positions
   are contiguous and zero-based. Output `originalTrackIds`, `proposedTrackIds`,
   `basisRevision`, and block evidence (album IDs, recorded numbers and original
   positions), plus `changed: boolean`.

With fewer than two members sharing a visible album, return unchanged order and
`insufficient_evidence`. With a supported album block already in order, return
`sufficient` and `changed:false`. A missing track number does not invent one.
Do not promise harmonic transitions, timing, mood, enjoyment or an optimal order.
No arbitrary prompt, random seed, BPM, provider playlist or playback operation.

The proposal is not a write command or durable approval token. A later explicit
PL2 apply must reauthorize and validate its own expected revision, exact member
set and current write contract. R2 never calls the reorder service. Membership
or metadata may change after any read; recompute before relying on stale evidence.

## Visibility, errors, retries and budgets

All three tools use the stricter P3 evidence rule adopted by approved P0 D3/D5
([P0 design PR #547](https://github.com/planetaryescape/gbfm/pull/547)). Every
artist, album, track or music-label used as a music seed, candidate or evidence
node must be public **and** have non-null `publishedAt` no later than `observedAt`.
Null/future timestamps do not qualify even when D3's broader public catalogue
projection permits the record. Genre labels in `labels` have no publication
field: a `kind: genre` label qualifies only through eligible entities on both
sides of that relation. Do not confuse these labels with music-label entities.

An explicit missing, inaccessible or non-qualifying music seed returns the same
`not_found`. A readable post seed with a structured reference to non-qualifying
music returns empty candidates, `insufficient_evidence` and
`missing_eligible_reference`, without exposing that music's metadata. The authored
draft-seed exception applies only to the post, never to its referenced music.
Related editorial candidates must satisfy the actual published-post predicate
and their referenced music must qualify too; rank 1 is not an exception.

Sequence proposals require a published public playlist (non-null `publishedAt`
not in the future), otherwise `not_found`. Any non-qualifying member track makes
the complete proposal `unavailable`, with no identification of the failing member;
never omit it or reorder only eligible members. A null/future or otherwise
non-qualifying album is an unreadable relation: retain its qualifying member track
as a singleton, omit the album's identity/metadata from evidence and digest, and
do not sort it using that album. If this leaves no shared eligible album block,
return unchanged order, `changed:false` and `insufficient_evidence`; otherwise
sequence only eligible blocks and return `sufficient`. Apply PL1 authorization
first; none of these rules widens its public-read surface.

| Capability | Required read permissions, subject to approved P0 scope names |
| --- | --- |
| Similar music | `catalogue:read`; eligible published evidence under the common rule above. |
| Editorial connections | `catalogue:read` + `content:read`; an explicit authored draft seed additionally requires `posts:read` and current authored-read role checks. Published candidates and eligible referenced music only. |
| Playlist sequence | `catalogue:read`; published public PL1 playlist and qualifying member tracks. Non-qualifying albums remain unknown singleton relations. No private-library or write permission. |

Filter visibility **before** ranking, counting, capping and digesting. Recheck
authorization on every call, including retries. Missing and inaccessible explicit
seeds share a non-disclosing `not_found`; absent grants are `access_denied` at the
P1 boundary. Malformed/oversized input is `invalid_input`; dependency failure or
exceeded execution budget is `unavailable`, not insufficient evidence. Stale
expected versions/revisions are `conflict`. Do not return successful partial
rankings on database failure. P1 owns final wire codes and isError mapping.

Use MCP 2026-07-28 output schemas and conforming structured results, with serialized
JSON text for compatibility. Insufficient evidence is a successful domain result;
execution errors use `isError:true`. Proposed annotations: readOnly=true,
destructive=false, idempotent=true, openWorld=false. Annotations do not authorize.
Idempotent means no writes, not immutable results across changing data.

Per call: at most 20 result candidates, 100 sequence members, 400 evidence records,
64 KiB complete serialized result (including compatibility text), 16 database
statements and 5 seconds server work, with request cancellation propagated. Bound
seed relationships before expansion: at most 50 per relation kind, stable ID order,
and report truncation; no unbounded materialization or per-candidate queries.
If even the mandatory bounded result cannot fit, fail `unavailable`; do not silently
drop sequence members or evidence. R2 must demonstrate these budgets against real
queries rather than assume a SQL LIMIT bounds database work.

No automatic retry inside a tool after the deadline. The client may retry one
transient failure; reread and return current versions. No write receipts, background
jobs, external work or persisted recommendation cache. Logs contain operation,
duration and safe error class, not private seed IDs, text, credentials or bodies.
Do not cache private-seed responses across principals.

## Reproducible R2 verification gate (not executed by P3)

Use migrated disposable D1, real R1/E2/PL1 reads and the composed MCP HTTP boundary:

- Same album beats shared artist, which beats shared genre; use asymmetric IDs
  so lexical order would give the wrong answer. Same display name with different
  artist IDs must not match. Null genre is unknown, not a negative fact.
- Add/remove a hidden intermediary, draft or future-published candidate: visible
  output, counts, ordering and digest stay identical. An unrelated caller cannot
  read the explicit draft seed. Revoke its grant between identical calls.
- Seed post with no reference, playlist-only reference, unresolved body mention,
  empty relation set, exactly 200 and 201 candidates: assert outcomes and notices.
- Give an eligible artist seed recorded albums/tracks that do have published
  editorial coverage: still expect empty candidates, `insufficient_evidence` and
  `unsupported_seed_relation`, not implicit traversal. An eligible album seed
  pointing directly to that coverage succeeds; a track seed does not match its
  album's coverage by inheritance.
- Test null, future, exactly-observedAt and past publication timestamps for music
  seeds, music candidates and intermediate artists/music-labels across all tools.
  A genre label with no publication field connects two eligible entities; replacing
  one endpoint with null/future music must remove that evidence. A post's exact
  reference to non-qualifying music is not a rank-1 bypass.
- Sequence input `[a2,b1,a1,u]` with a2/a1 in album A numbered 2/1, b1 in B,
  u unknown yields `[a1,a2,b1,u]`. Add tied/missing/nonpositive track numbers,
  equal stored positions, zero/one members, 100/101 members and an unreadable
  member. Assert exact permutation, stable ties and no claimed sonic properties.
- Already-ordered album block is unchanged with evidence; unrelated singleton
  tracks are unchanged with insufficient evidence. Stale revision conflicts.
- A null/future playlist yields `not_found`; a null/future member track makes the
  entire sequence `unavailable`. For eligible tracks sharing a null/future album,
  retain their original singleton order with no album ID in evidence/digest;
  compare with the same album published exactly at observedAt, where recorded
  numbering may reorder the tracks with `sufficient`. Mixed eligible blocks and
  unknown-album singletons preserve the complete track set.
- Repeated calls over a frozen dataset produce the same order, evidence and
  basis digest (observation time may differ). Change relevant metadata and show
  the digest changes; never mistake a playlist revision for a metadata version.
- Digest fixtures use `entityType`/`entityId` and `result.status: sufficient` (or
  `insufficient_evidence`). Compare against an otherwise identical object using
  `type`/`id`/`evidence_found`: its hash must differ and it is not a valid canonical
  fixture. Renaming a key is not an evidence-strength change or an invisible map.
- Compare database state before/after success, empty, failure and cancellation:
  no playlist, import, enrichment, post, receipt or policy writes. Assert no
  provider/model requests. Check query count, payload bytes and deadline failures.
- Validate tool discovery, schemas, structured/text parity and execution errors
  through installed Effect MCP; then run `bun precommit` at the integrated head.

P3 supplies a design, not runtime proof. No D1/protocol/service behavior has changed.

## Ownership and remaining gates

P3 session: https://ampcode.com/threads/T-01a1b543-db61-74a4-bfb9-d9d517d99ac3.
Isolated worktree `/home/user/workspace/gbfm-p3`, branch
`design/p3-recommendation-contracts`, independent single-layer gh-stack rooted on
`prod`, [PR #545](https://github.com/planetaryescape/gbfm/pull/545). Sole reservation:
this file; claim recorded in #516 before editing. Parent Space coordinates review
and integration. Leave unmerged with auto-merge disabled for owner overview; a
separate Claude actual-PR review is required. No shared-file, schema or runtime
reservations; P0/P2/P4 keep their lanes.

1. Guide Fari approved the deterministic evidence-only/provider-free choice,
   bounded catalogue-related meaning and `album_blocks_v1` strategy on 2026-11-07.
   [Recorded owner approval](https://github.com/planetaryescape/gbfm/issues/516#issuecomment-6704967458)
   quotes the owner's reply in this thread. #516 remains open for document delivery
   and integration; approval alone does not satisfy R2's other prerequisites.
2. P0/P1 approve exact permissions, discovery and wire conventions. P3 does not
   invent an active scope or change OAuth policy.
3. R1 #518, E2 #531 and PL1 #533 deliver merged, authorized, bounded evidence/read
   seams, including stable fingerprints and complete playlist revision reads.
   Existing raw services alone do not satisfy this gate. If a seam cannot meet
   this contract, revise it with its owner rather than bypass authorization.
4. R2 #535 remains blocked by #514/#516/#531/#533. Implement only after all gates
   settle, from stable merged prerequisites, not a multi-parent sibling stack.
   PL2 alone owns any later explicit application; no schema/provider is needed
   for this proposal. Merge/deploy authority remains separate.
