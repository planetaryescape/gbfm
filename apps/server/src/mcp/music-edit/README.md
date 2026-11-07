# M1 #523: music edits and shared guarded writer

## Resumed implementation authority (2026-11-07)

P1 relayed Guide Fari's blanket approval at 17:30:38.618Z, source coordinator
message `M-25AnVGIQb4kP4RIwEzygur`:

> everything that needs my approval, you have my thumbs up; the claude threads that got stuck because of limits, you can take that wrok over as a medium sol thing instead

This records a relay, not direct human-message provenance. The approval covers
the surfaced consolidated receipt/revision/guarded-writer recommendations, not
production operations or merging MCP PRs. See #523's resumed-scope comment.
Earlier proposal/approval language below describes the reviewed preview baseline;
the remaining requirements are implementation and verification work, not another
approval request. P1 has now allocated the exact edit/delete music service
methods, genre-only writer and existing edit/read API/HTTP envelopes to M1.
I1 retains creates/canonical/artwork. Dashboard shared command/update/model/message
remain P1-only; M1 may change `page/catalog.ts` only. Domain schema owner supplies
0017 revisions and 0018 facts; common operations owner supplies 0016 receipts.
No triggers are assumed: allocated service/raw writers must implement all
invalidation and projection changes explicitly in the guarded batch.

Current local continuation extends read-only preview to all eight command forms.
Metadata allowlists: artist name/bio; album title/releaseDate (canonical UTC ISO);
track title/trackNumber; label name/description. Identity, owner, publication,
content authoring and managed artwork are excluded. Genre sets are distinct,
ordered, at most 30 trimmed names; empty clears. Credit roles are exactly existing
primary/featured/producer/null, ordered by displayOrder then artistId. Each plan
reads target, relationship and reference state in one SELECT; oversized existing
collections fail closed rather than truncate a purported complete observation.
Mutation registration remains absent until the actual common executor and all
browser/API/PAT/canonical writers are integrated and verified.

`artist-fanout.ts` is the canonical/MCP shared SQL-statement seam: append after
the artist CAS marks the physical attempt, before the shared receipt outcome.
Every statement requires common fence plus the artist's matching attempt marker;
parent projection and revision invalidation occur in the same batch. It does not
prove canonical caller compliance until integrated. M2 alias observations bind to
the same artist revision, so rename does not delete valid alias facts. Primary
name/alias-name-key collisions must reject before rename; recording-credit FKs
restrict artist deletion. `version.ts` provides M2's opaque resource-bound token
from this same integer revision, not another ledger.

Base: verified remote `feat/514-mcp-foundation` at
`2d1b5592826e66e3a198dc117c153e062264fc5c` (PR #548), above P0 #547;
prod baseline `aec2782a97bd91e2f030ef05095f76b54fcc79b1`.
Effect 4.0.6, Drizzle 0.45.4, Miniflare 5.20260801.1-alpha, MCP 2026-07-28.
No #551 dependency. Ownership is the confirmed scope above; the earlier
exact-pair fix remains limited to `album.service.ts`'s import/predicate.
I1 owns music-import; M2 uses the shared revision/receipt seam, not another ledger.

## Delivered surface

`MusicEditPreviewToolkit`, `MusicEditPreviewHandlers`, `MusicEditPreviewLive`,
`MusicEditPreview`, `PreviewMetadataInput`, `PreviewMetadataResult` are exported
from `preview.ts` for P1 composition. No central registry/OAuth/consent change.
Composition requires existing `Database`, `McpAuthorization`, and
`EditorialMcpConfig` services; results include the configured endpoint identity.
The real MCP test composes this toolkit with the actual request-scoped adapter;
its principal is injected, **not** evidence of persisted OAuth admission.

Input is `{ change: { operation, entityId, ...operationSpecificFields } }`;
`commands.ts` defines the exact per-operation forms and metadata allowlists.
Required nullable fields distinguish explicit clearing from missing input.
Only supported album types/credit roles are accepted. A missing target or
proposed reference returns `not_found`. Shared music records have no per-user owner
policy: current admin + `catalogue:write` is required even for this preview.
No actor IDs, content bodies, provider metadata, URLs or other unrelated fields are read.
No network calls, writes, receipts or cache enrichment occur.

Output is bounded observed before/after state with `status: preview_only` and
`applyAvailable: false`. It is **not** a revision, reservation, guarded apply
plan or authorization. Changes can occur after preview. Full preview acceptance
must later use the same validated command planner as the approved writer.

Protocol behavior differs from direct service validation: Effect Toolkit decodes
parameters before invoking the handler. Malformed tool arguments return framework
`isError` text ("Invalid parameters…"), not typed `McpToolError.invalid_input`.
That decode also precedes per-service authorization: a malformed request from a
catalogue-read-only principal gets the schema error; valid arguments reach
`access_denied`. The schema is public; this does not expose target state. The
protocol test pins this existing P1 framework behavior. Changing error mapping or
authorization ordering belongs to P1, not a domain-specific transport override.

| Selected capability | This PR | Remaining contract / gate |
| --- | --- | --- |
| `update_music_metadata` | Preview only; no mutation tool | Explicit per-kind metadata allowlist; guarded apply remains |
| `set_music_genres` | Preview only; no mutation tool | Desired ordered set, empty clears; atomic revision + genre junctions must preserve tags |
| `set_album_type` | Preview only; no mutation tool | LP, EP, single, compilation or null; shared guarded writer + receipt |
| `set_track_album` | Preview only; no mutation tool | Existing album or null; validate reference in atomic batch, guard track and relevant reference state |
| `set_artist_credit` | Preview only; no mutation tool | Existing album/track credit and existing roles/order; atomic projection apply remains |
| `remove_artist_credit` | Preview only; no mutation tool | Exact parent+artist pair; atomic junction, display names and parent revision |
| `set_label_affiliation` | Preview only; no mutation tool | Existing label ↔ artist/album only; atomic guards for both endpoints remain |
| `remove_label_affiliation` | Preview only; no mutation tool | Exact pair, same endpoint guards and receipts |
| `preview_metadata_changes` | All eight proposal forms | Actual revision observation and shared guarded apply integration remain |

All eight write capabilities remain undelivered, not registered stubs. #523 is
not complete. Apart from the exact-pair bug fix, no shared writer changed.
No storage, migration, replay list, exports, browser,
production resource policy, merge or deployment change is included.

## Reproducible evidence

From `apps/server`:

```sh
bunx vitest run --config vitest.d1.config.ts src/mcp/music-edit
```

`preview.d1.test.ts` runs the actual service against migrated D1, including a real
`updateAlbumEffect` browser-service change, scope loss, account-role reduction,
ban, unsupported/extra fields, missing references, clearing/no-op and persisted
state equality around preview. It also exercises the actual MCP tools/call route.
It does not prove production OAuth or browser concurrency is safe.

`remove-credit.d1.test.ts` exercises the existing public album service with two
albums and two artists. Before the fix, removing X/A1 also removed X/A2 (red);
after replacing JS `&&` with Drizzle `and()`, X/A2 and Y/A1 both remain (green).
This fixes the delete predicate only, not revisions, receipts or artistNames.

`revision-proposal.d1.test.ts` contains the **exact candidate SQL**. It creates
an isolated migrated Miniflare D1 binding and applies test-only revision/receipt
DDL there; disposal destroys it. The candidate conditional receipt acquisition
and attempt-token-gated writes run in one D1 batch. Assertions distinguish:

- browser CAS first → stale MCP has no receipt or junction;
- two submitted same-key attempts, serialized by local D1 → one receipt, one
  junction, one revision advance (revision and unique-key guards both apply);
- MCP first → stale browser CAS changes zero rows;
- same key with changed payload/current revision cannot mutate again; this later
  `attempt-c` probe isolates unique-key protection from the stale-revision guard;
- missing artist FK and failure after junction/projection both roll back the batch;
- clearing expired result payload leaves key evidence that prevents reapplication.

The candidate output is revision 2, `artistNames: ["Zed"]`, one receipt and one
credit after contention/failure/expiry. This is a feasibility proof, **not** a
production receipt implementation or proof of existing writer compliance. The
probe intentionally omits full authorization, replay classification, multi-kind
triggers, artist rename fan-out, genre and affiliation plans. Those require real
service/protocol/browser tests after approval, not extrapolation from this probe.

## One proposal for P1 consolidation (not implementation authority)

Existing `editorial_operations` is post-bound (`post_id`); `draft-store.ts`
inserts receipts by selecting guarded `posts` rows. Do not use fake post IDs,
copy that store per lane, or create another music-only request ledger.

Candidate columns in `apps/server/src/db/music-entity.schema.ts`: `revision`
INTEGER NOT NULL DEFAULT 0 on artists, albums, tracks and labels. Playlists
already have their own revision and remain PL2-owned. Prefer DB invalidation
triggers for every mutation that changes the observable state, plus explicit
caller-revision guards in user-driven writes. Timestamps alone are insufficient.
Revisions are opaque monotonic values, not a promise of exactly one increment
per command: projection triggers may invalidate multiple affected parents.

Candidate **single P1-owned** receipt schema path:
`apps/server/src/db/mcp-operation.schema.ts` (name not reserved).
Key: actor + OAuth client + resource audience URL + operation + UUIDv4 request ID.
Columns: scoped key components, normalized input hash, target kind/ID,
per-attempt commit token, bounded authorized result, created/expiry timestamps.
Hash includes target and every expected revision, explicit null versus omission,
and normalized desired state. Unique key prevents parallel retry application;
attempt-token predicates prevent an old receipt authorizing fresh writes.

One D1 batch must combine eligible live account/target/revision checks, conditional
receipt acquisition, metadata/junction/genre mutations, ordered `artistNames`
projection, all affected revision invalidations and saved outcome. A failed
statement rolls back all of it. Changed payload under the same key returns conflict; identical
retries replay the saved result after checking current grant, account, role,
client/resource/operation ownership and target access. Missing non-lifecycle
targets do not replay. A timeout after commit is ambiguous, not "not applied".
No transaction spans provider calls. One receipt implementation is shared with
I1/L1/L2/L3 as P1 decides; the probe table is never a runtime dependency.

24-hour result expiry is the proposed replay window, not approval of indefinite
storage. At expiry remove result/private payload, retain only minimal approved
anti-replay evidence (scoped-key digest, input digest, expiry/status as needed).
**Retention horizon, digest/key rotation and deletion rules require the combined
schema/privacy decision.** Actor/client deletion must immediately deny all replay
and remove private result/identifying material as approved; cascading the entire
anti-replay key away is unsafe if that key namespace can ever become eligible
again. Choose approved minimal opaque tombstones or irrevocably retire the
namespace so old keys can never execute. Do not claim indefinite retention or a
particular anonymization policy is approved. Current probe checks result expiry
only, not account/client deletion or an approved retention mechanism.

### Exact writer coverage requested

- `services/music-entity/{artist,album,track,label}.service.ts`: update methods,
  artist rename and delete fan-out; album/track create/update and add/remove credit
  methods. Junction inserts/updates/deletes and ordered display names must commit
  together; tie break `displayOrder, artistId`. No direct `artistNames` override
  may contradict credits. Artist rename updates linked names and invalidates
  parents. Deleting a referenced artist/album must invalidate affected parents.
  Review reproduced a pre-existing `removeArtistFromAlbumEffect` defect: JavaScript
  `&&` discards the album predicate, deleting the artist's credits on every album.
  This PR fixes that exact predicate with an asymmetric red/green D1 regression
  under P1's narrow serialized reservation. Revision/receipt/display-name work
  remains gated; the pair fix does not establish safe MCP mutation behavior.
- `services/music-entity/label-affiliation.service.ts`: all four affiliation
  methods compare expected endpoint revisions and invalidate both endpoints.
- `db/labels.ts`: genre-only replacement must preserve tags and share the guarded
  entity batch; today's replacement deletes both kinds and uses a separate batch.
- `packages/api/src/music.ts`, `http/music.handlers.ts`: return revisions in reads,
  require expected revisions on updates/relationships, preserve current admin
  checks; no legacy browser/PAT bypass that re-reads a revision just before writing.
- `apps/www/src/page/dashboard/{command.ts,page/catalog.ts}`: carry the revision
  observed when loading the form into save commands. Current `WriteCatalog` PATCH
  sends form state without any entity precondition. Other callers of those API
  endpoints must adopt the same contract before mutation tools enable.
- `services/canonical-music-identity/repository.ts`: `updateArtwork` and
  `updateEntityMetadata` write ORM/raw SQL state independently; coordinate with I1/U1,
  including canonical insert statements and artist/genre writers. These paths
  must invalidate revisions and preserve credit projection invariants; a provider
  refresh cannot overwrite an intervening browser/MCP change using a stale plan.

Proposed integration seam is one shared guarded writer, serialized with I1,
not a parallel MCP backend. Outside the exact-pair correction above, M1 has
**not** reserved or edited those paths.
P1 alone coordinates migration filename, `db/exports.ts`, and
`test/migrate-d1.ts` after explicit schema approval. Before enabling mutations,
test composed real browser/API/PAT/canonical/MCP contenders, durable receipt
replay after lost response, changed payload, expiry and revoked/deleted accounts.
