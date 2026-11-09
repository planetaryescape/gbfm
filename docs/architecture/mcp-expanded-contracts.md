# Expanded MCP contracts — P0 proposal

Status: **D1–D6 approved for design only; implementation remains unauthorized**.
Owner: Guide Fari. Issue: #513; parent map: #512. Baseline: release 2.127.0,
`aec2782a97bd91e2f030ef05095f76b54fcc79b1`. This document authorizes no runtime,
schema, OAuth resource-policy, production data, merge or deployment change.

## Owner approval record

Guide Fari (`user_01KFN1X6DQDCGJ6AEZX2W6FF5W`) approved proposal revision 1
in [the P0 thread](https://ampcode.com/threads/T-01a1b543-cb49-714e-9f8b-64745fd4d198):

> Approve D1–D6 for proposal revision 1 as design only; no implementation or production activation

Approved proposal SHA-256:
`ea82518c6c2d5628665d5fd7b53b3aced82ad8aaf60b30b6118fa7490ead7551`.
This update records approval without changing the approved contracts. References
below to proposals or approval gates describe the reviewed design; D1–D6 are now
resolved. Independent P2/P3/P4/backend approvals, P1 ownership, delivery and
verification gates remain. No implementation or production activation is authorized.

## Evidence and constraints

- `packages/core/src/roles/index.ts`: roles are `user`, `creator`, `editor`, `admin`;
  `canCreatePosts` starts at creator. There is no current curator role. The older
  `docs/architecture/RBAC.md` is not the authority for current roles.
- `packages/core/src/editorial-mcp.ts`: existing grants are `posts:read`, optional
  `offline_access`, and separately granted `drafts:write`. Existing scope sets
  require `posts:read`; retain their meaning and existing clients.
- `apps/server/src/services/editorial-oauth.service.ts`: requests verify persisted
  token/grant revocation, client/resource status, account/role, resource audience,
  scope policy and session expiry. The current verifier rejects listener-only users.
  `apps/server/src/lib/editorial-oauth.ts` also gates authorization/token exchange.
- `apps/server/src/mcp/editorial.ts`, `drafts.ts`, `draft-store.ts`, `contracts.ts`:
  authored private sources; account rechecks; hash-based post versions; atomic
  guarded draft writes and persisted 24-hour retry receipts already exist.
  Receipt replay rechecks current draft access. Do not rebuild these features.
- `apps/server/src/http/music.handlers.ts`: shared music writes use `requireAdmin`.
  Artist-by-ID and playlist-list services do not apply a `publishedAt` predicate
  (`services/music-entity/artist.service.ts`, `playlist.service.ts`). Thus neither
  a timestamp field nor today's API exposure proves an approved privacy policy.
- `packages/api/src/listening.ts`, `services/listening.service.ts`: saved mixes and
  collections have independent publication state; public reads filter both mix
  and collection and require matching owners. Notes share the mix's visibility.
- `packages/api/src/admin.ts`: the current overview includes emails and user and
  subscriber details. MCP must project a smaller result, not return that DTO whole.
- `packages/api/src/upload.ts`: current upload responses include public URLs.
  These contracts do not establish private draft-byte storage; #203 gates C3/C4.
- Installed Effect is **4.0.6**. Existing server uses `effect/ai`,
  `McpServer.layerHttpRequestScoped` and `McpProtocol.v2026_07_28`; the installed
  `effect/src/ai/McpProtocol.ts` exports that adapter. Use the official
  [2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28/index.md)
  and [tools contract](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md).
  The two new guidance files mentioned by #512 were absent at this baseline;
  the issue's self-contained gates apply.

## Alternatives and recommendation

1. One broad MCP/admin grant: few names, but bundles private reads, shared edits,
   publication and deletion. Reject: selection does not grant blanket authority.
2. One scope per selected ID: precise but forces 118 consent concepts onto users
   and couples permissions to provisional tool names. Reject.
3. **Recommended:** domain/action scopes below, AND current role, owner, visibility
   and operation checks. A write scope never implies read, publish, delete, upload
   or provider authority. Do not add a new role or generic policy engine for P0.

Every new scope, role choice and numerical limit below is a proposal. The parent
map's exclusions and blockers remain binding regardless of scope consent.

## Proposed capability matrix

All rows require a live authenticated connection; "public" describes the data
projection, not a new anonymous MCP endpoint. `U` = any active recognized account
(including listener-only, **subject to D1**); `C` = creator/editor/admin;
`A` = admin only (**subject to D2**). Roles never override private ownership.
Scope combinations mean AND, not OR. No implicit wildcard or scope inheritance.

| Capability group / issue | Required scopes | Role and visible target | Effects / retry class |
| --- | --- | --- | --- |
| Existing four editorial tools | Keep `posts:read`; create/update also `drafts:write` | Existing C and authored-source checks unchanged | Existing read / 24-hour receipt |
| R1 #518 catalogue search, lookup, batch lookup, filters, relationships | `catalogue:read` | U; public catalogue predicate D3 | Read, no fetch-on-miss |
| R3 #519 public content, profiles, shows, collections, micro threads | `content:read` | U; published/public fields only | Read |
| R4 #520 stored links/equivalents/missing links/source comparison | `catalogue:read` | U; public entity and safe stored link evidence | Read |
| R4 `check_music_link_health` when it probes a URL | `catalogue:read` + `providers:read` | U; public entity, allowlisted probe only | External read; bounded, freshness returned |
| I1 #521 manual create artist/album/track/label | `catalogue:write` | A; shared records, never an ownership claim | Receipt |
| I1 `import_music_url`; I2 #522 batch/Spotify playlist import | `catalogue:write` + `catalogue:import` + `providers:read`; playlist import also `playlists:write` | A; shared import, #200 gates batch status | Accepted operation / receipt |
| I2 `get_import_status` | `catalogue:import` | A; initiating actor/client's operation only | Read; no cross-owner operation lookup |
| M1 #523 edits and existing credits/affiliations; M2 #524 aliases/recording credits | `catalogue:write` | A; shared entity; M2 waits for P2 approval | Version + receipt |
| M1 `preview_metadata_changes` | `catalogue:write` | A; same target access as apply, no mutation | Read; proposal is not authority |
| M3 #525 correction proposal | `catalogue:propose` | U proposed; public target, own submission only; #89 approval required | Receipt; no direct catalogue edit |
| U1 #526 attach/reject/remove stored links | `catalogue:write` | A; shared target | Version + receipt |
| U1 discover/refresh links; Q2 #528 refresh metadata | `catalogue:write` + `catalogue:import` + `providers:read` | A; explicit provider/enrichment work | Version + accepted operation |
| Q1 #527 duplicate/incomplete/conflict/quality inspection | `catalogue:inspect` | A; safe internal catalogue evidence only | Read; no account/provider payload dumps |
| Q2 resolve identity conflict; Q3 #529 merge preview/apply | `catalogue:repair` + `catalogue:inspect` | A; all affected shared targets; #316 gates merge | Preview read; apply versions + receipt |
| E1 #530 attach/detach/embed/tags; E3 #532 multiple references | `posts:read` + `drafts:write`; referenced music also `catalogue:read` | C; own unpublished draft, public music; P4 gates E3 | Same post version + receipt |
| E1 find mentions / preview editorial; E2 #531 draft context | `posts:read`; resolved public evidence also `catalogue:read` | C; explicit authored draft, no wider draft search | Read; no provider/model calls |
| E2 remaining public research and sourced coverage | `catalogue:read` + `content:read` | U; public candidates and stored sources | Read |
| PL1 #533 playlist/tracks/compare/export | `catalogue:read` | U; public GBFM playlists only, bounded export | Read; no Spotify account export |
| PL2 #534 create/update/add/remove/reorder and preview | `playlists:write` | A; shared GBFM playlists, unpublished targets only through this authorized curation surface | Version + receipt; preview read |
| PL2 add track from URL / sync links | `playlists:write` + `catalogue:write` + `catalogue:import` + `providers:read` | A; playlist plus affected shared records | Versions + accepted operation |
| PL2 publish / unpublish playlist | `playlists:write` + `playlists:publish` | A; explicit visibility transition D3/D4 | Version + receipt |
| R2 #535 similar music / sequence suggestion | `catalogue:read` | U; public evidence only; sequence is not a playlist write | Read, insufficient-evidence result |
| R2 editorial connections, public seed | `catalogue:read` + `content:read` | U; public evidence only | Read |
| R2 editorial connections, explicit private draft seed | Above + `posts:read` | C; one authored draft seed, published candidates only; D5 | Read; never expose seed to another owner |
| L1 #536 saved mixes/collections list | `listening:read` | U; own records, counts, notes and memberships | Read |
| L1 save/notes/status/create/update/membership | `listening:write`; read-back also `listening:read` | U; own mix AND collection for membership | Version + receipt |
| L1 change public/private state via update | Above + `listening:publish` | U; own target, notes warning, D4 | Version + receipt; no implicit publication |
| L2 #537 favorites / subscriptions list and set | `favorites:read` / `favorites:write`; `subscriptions:read` / `subscriptions:write` respectively | U; own records only | Read / desired-state receipt |
| L3 #538 reminder list / create / reschedule / cancel | `reminders:read` / `reminders:write` respectively | U; own target, recipient from actor only; D4 | Read / version + receipt; may schedule email |
| C1 #539 creator drafts / metadata edit | `creator:read` / `creator:write` respectively | C; authored mix/show, not another creator's records | Read / version + receipt |
| C2 #540 micro post / reply | `micros:publish` | C; actor's identity, visible reply target, D4 | Receipt; public side effect, no announcement |
| C3 #541 existing artwork selection | `assets:read` + destination's write scope | C; public or own authorized asset, owned destination | Destination version + receipt |
| C3 upload / upload status | `assets:upload` | C; own upload handle, destination authorization; #203 | Accepted upload / read; bounded signed URL |
| C3 QR PDF | `content:read` for public target; `creator:read` for own private target | U public / C own; #203 for private bytes | Bounded read/generation, no stored publication |
| C4 #542 publish / unpublish | `content:publish` + target write scope | C own content; no admin ownership bypass proposed; #203, D4 | Version + receipt |
| C4 delete | `content:delete` + target write scope | C own content; no cascade implied; D4 | Version + receipt, explicit destructive result |
| A1 #543 overview | `admin:read` | A; aggregate counts only, D6 | Read; no email/user/subscriber rows |
| PF #544 label-profile prompt | `catalogue:read` + `content:read` for any hydrated evidence | U; public sourced evidence, no model/provider execution | Read/template; same authorization as tools |

The matrix covers all selected groups; exceptions within a group override its
general row. A receipt response containing private state additionally requires
the read authority for that state. Scope names do not activate any selected tool.

## Visibility and discovery

Proposed D3 rule: catalogue `publishedAt` is **not** itself a privacy boundary for
artists/albums/tracks/labels; use an explicit approved public catalogue projection
that omits actor IDs and internal provenance. GBFM playlists differ: require a
non-null publication instant not in the future for public reads. Null/future
playlists appear only in the A curation surface, never recommendations. This
distinction is approved by D3, but its application-service/API behavior change
still requires an explicit implementation approval and named owner. PL1 #533
is the proposed owner of shared public playlist service/API/embed visibility
reconciliation, not an assignment of runtime authority. Before its MCP reads or
playlist consumers (including R2 and E1 embeds) enable, that owner must establish
the same predicate for browser, public HTTP, embeds and MCP, with distinct
authorized admin curation access. Existing unfiltered services are not evidence
of compliance. Until that prerequisite is delivered and verified, affected
consumers stay blocked. P1 must not implement the visibility change as foundation
work or add an MCP-only filter that leaves the public API/embed path exposed.
If shared public behavior conflicts with an owner requirement, record the conflict
for owner decision rather than invent an exception to D3.

Public posts/shows/mixes/profile/collection projections use their actual domain
publication predicates. A published parent never makes a private child public.
No scope permits returning another owner's notes, drafts, receipts, uploads or
reminders, including to admins. Guessed IDs return the same `not_found` as absent
records. Counts, joins, source snippets, URLs and pagination must filter first.
Do not return unsigned private media URLs while #203 remains unresolved.
P3's stricter published-candidate rule also applies to recommendation evidence:
null/future publication timestamps do not qualify, even if D3 allows the record
in the wider public catalogue. P3 must settle its evidence eligibility against
that rule before R2 registration; P0 does not choose its ranking algorithm.

Discovery is deterministic and per-request: show only currently enabled tools
whose scope and role requirements are met, including the four editorial tools.
Their unchanged wire names, input schemas and result schemas do not promise
unconditional discovery: hiding registered write tools from a read-only grant is
an intentional change from the baseline's static four-tool listing. A valid
guessed/cached call to a registered tool hidden by missing scope/role reaches the
service authorization boundary and returns `access_denied`; it is not an unknown
tool. A truly unregistered name remains a protocol unknown-tool error. A
dual-mode recommendation tool may
remain listed for its public mode; its private-seed path checks extra scope and
authorship at invocation. Cached lists never authorize calls. Check every call,
including receipt/status lookups, with fresh account and persisted grant state.
No automatic upgrade of existing grants; new scopes need fresh consent. Do not
require `posts:read` for a future listener-only grant or repurpose it for public
content. P1 must add a separate expanded scope-set validation path while retaining
existing editorial scope semantics. `offline_access` only permits refresh.
Mixed editorial/expanded grants are eligible only while the account satisfies
its scope-set admission requirements, at consent/exchange and again during live
persisted-token verification. Preserve strict admission in P1's `canAuthorizeMcp`:
`catalogue:write`, `catalogue:import`, `catalogue:inspect`, `catalogue:repair`,
`playlists:write`, `playlists:publish` and `admin:read` require admin; editorial
and other creator-class scopes require creator or above. Listener-only grants
remain limited to eligible U-row scopes under D1. A creator therefore cannot
obtain a `catalogue:write` grant through real OAuth, and a token containing that
scope becomes wholly invalid if its account loses admin status. This preserves
admin-only authority under D2; no relaxed admission is inferred from a synthetic
service test or the per-call denial contract. Per-call scope/role/target checks
remain defense in depth even when OAuth already excludes that principal.
Preserve fail-closed whole-token validation: if a creator is downgraded to
listener and its token includes
`posts:read` plus `catalogue:read`, reject the entire token at the HTTP OAuth
boundary. Do not silently downscope it or serve catalogue calls under that token.
A separately consented catalogue-only listener grant remains eligible, provided
all its own account, revocation, audience and resource checks pass. Neither refresh
nor discovery repairs an ineligible mixed grant; a new consented grant is separate.

## Command and projection contracts

These are contract sketches, not new runtime exports or schema approval. Use
Effect Schema at JSON/storage boundaries and typed Effect failures internally.
Keep domain services authoritative; do not add a generic command dispatcher.

```ts
// Existing domain IDs remain stable; slugs/provider URLs are lookup inputs only.
type MusicRef = { readonly entityType: 'artist' | 'album' | 'track' | 'label' | 'playlist'; readonly entityId: string }
type UpdateDraft = { readonly requestId: string; readonly postId: PostId; readonly expectedVersion: PostVersion; readonly content?: string }
// Proposed per-domain commands use that domain's actual ID and revision schema.
type ReorderPlaylist = { readonly requestId: string; readonly playlistId: string; readonly expectedRevision: number; readonly trackIds: ReadonlyArray<string> }
type CommandOutcome<Result> =
  | { readonly status: 'applied'; readonly result: Result; readonly replayed: boolean }
  | { readonly status: 'accepted'; readonly operationId: string; readonly pollAfterSeconds: number }
type Recommendation<Candidate> =
  | { readonly status: 'sufficient'; readonly candidates: ReadonlyArray<Candidate>; readonly limitations: ReadonlyArray<string> }
  | { readonly status: 'insufficient_evidence'; readonly candidates: ReadonlyArray<Candidate>; readonly limitations: ReadonlyArray<string> }
```

The four editorial wire names (`list_drafts`, `get_post`, `create_draft`,
`update_draft`), input schemas and result schemas stay unchanged. Filtered discovery
and the encoded JSON ceiling below are intentional compatibility changes, not
exceptions that preserve the baseline's listing or accepted payload sizes.
New results include endpoint
identity (environment, resource URL, frontend URL), canonical IDs, observed
revision/version, explicit completion state and safe review URLs. Domain-specific
results must not be forced through this illustrative union if their existing
service already expresses these outcomes. Accepted is not completed; no success
claim for enrichment that is unavailable or still queued.

Proposed bounds: default list 20, max 50; explicit batch max 50 IDs/URLs;
request and response JSON max 256 KiB; one default relationship hop, never an
unbounded graph. Existing draft content retains its 100,000-character field
limit (both field and byte limits apply). D5 intentionally tightens the baseline
`drafts:write` request ceiling from 640 KiB to 256 KiB; it does not raise existing
lower read-request limits. The cap measures encoded JSON bytes, not schema string
length. Thus schema-valid content, including the baseline's 100,000 U+0001
character fixture or 100,000 CJK characters, can fail the byte ceiling. Existing
schemas stay unchanged, but not every previously accepted request/result size
remains supported. The response ceiling applies too. Oversize full bodies return
an explicit bounded failure (HTTP 413 for request admission), not silently
truncated content. Lists return explicit pagination;
exports use pages, not an unbounded string. Provider probes: max 10 targets,
concurrency 2, 5 seconds each and 15 seconds total, no redirects to private IPs,
no credentials, allowlisted hosts. Import jobs use #200's bounded service contract,
not these probe timeouts. Ordinary reads never start imports, repair, cache
enrichment, provider fetches or model calls. Explicitly scoped provider probes
are the only external-read exception. `lookup_music_url` is stored lookup only.

### Versions and retries

- Creates require a UUIDv4 `requestId`; updates/publication/deletion require it
  plus the latest target version. A preflight read alone is not a concurrency
  guard: apply comparison and mutation atomically in the owning service/store.
- Post mutations share existing `PostVersion`, including browser changes and
  P4 references. Playlist order/membership/metadata/visibility must share one
  revision; existing revision storage is precedent, not proof that every writer
  increments/checks it. Music relationship edits must invalidate the relevant
  entity version. Merges compare all affected versions atomically.
- Propose the existing 24-hour receipt behavior for new commands. Existing
  editorial receipt keys remain unchanged. For new operations, actor + client +
  operation + requestId identify a receipt; normalized payload hash includes
  expected versions and explicit null/omitted semantics. Identical retries replay
  the original authorized result; changed payload conflicts. Parallel retries
  apply once. Recheck current actor, grant, role and receipt actor/client/operation
  ownership before replay, plus current target access for non-lifecycle commands
  whose target must still exist. This includes current ownership/authorship, not
  merely possession of a read scope: an E1 attach/tag retry after removal of the
  actor from the draft's co-authors must deny access and not replay private draft
  state. A missing non-lifecycle target does not gain the lifecycle exception.
  A stored receipt never substitutes for current authority. Existing create/update
  draft replay still rechecks current authored draft access; its receipt key and
  response behavior are unchanged. Only the lifecycle commands below use the
  post-transition replay rule, and that exception grants no private-read bypass.
- Future delete/publish/unpublish commands need post-transition replay
  authorization, not a copied unpublished-only `loadDraft` check. After delete,
  the row may be gone; after publish, the row is no longer a draft. Verify the
  current live actor/grant/role, the matching owned receipt and its evidence of
  authorization at commit time, then replay the bounded saved operation outcome
  without repeating the mutation. Do not require the removed row or pre-transition
  visibility state to exist. Receipt evidence permits only acknowledging that
  operation, not reading newly private state, undoing a transition or acting on a
  target whose ownership has changed. Private payload fields still require current
  read authority; without it, return only a safe saved acknowledgement if the
  operation's result contract supports one, otherwise deny the private payload.
  If existing persistence cannot prove these guarantees without an unapproved
  schema change, keep that consumer blocked; do not add a second ledger or weaken
  authorization. The existing draft receipts are not claimed to meet this future
  lifecycle-command contract.
- Expired keys never apply again. Clients reconcile status/current state, then
  use a new key only for a new intended command. A new key is not a timeout retry.
  Retain enough expiry evidence to prevent duplicate creates after pruning;
  storage/retention changes require separate schema approval.
- Desired-state setters are not toggles. Concurrent browser/MCP edits conflict
  rather than overwrite. Delete retries replay the original authorized receipt;
  an unrelated absent ID remains `not_found`. No implicit cascade.
- Provider/import work returns the same durable handle on retry. Do not keep a
  DB transaction open during network work. Reuse canonical identity and import
  owners, not a second ledger. If existing services cannot meet atomic receipt,
  revision or outbox guarantees, that command remains blocked until its owner can.
- Cancellation stops uncommitted work when supported. Disconnect after commit
  does not undo a command or cancel an accepted job; recover using the same key.
  An ambiguous timeout must never be labelled definitely-not-applied.

### Failures and annotations

Preserve existing `EditorialToolError` codes: `access_denied`, `not_found`,
`unavailable`, `conflict`, `invalid_input`, `expired`. Proposed expanded failures
add `rate_limited` (bounded retry delay) and `precondition_required` (missing
version). Reasons distinguish stale revision, changed retry payload and blocked
dependency without leaking unauthorized target state. Domain failures use
`isError: true` with safe typed data; structured success matches `outputSchema`.
Malformed JSON-RPC/truly unregistered tool remains a protocol error;
registered-but-hidden calls use the service `access_denied` contract above.
Invalid/expired/revoked or role-ineligible mixed-grant
bearer credentials fail at the HTTP OAuth boundary, not as a successful tool call.
Valid grant but missing scope/role yields `access_denied`; other-owner/hidden ID
yields `not_found`. Transport scope challenges follow the OAuth contract.

Retry reads/probes only on bounded transient `unavailable`/`rate_limited` outcomes.
Never automatically retry conflicts, denied access, validation or expired keys.
Mutating transient/unknown outcomes retry only the identical key and payload.
Empty search is successful empty data; insufficient recommendations are the
typed outcome above, never fabricated results or an automatic provider fallback.

Read-only annotations describe actual side effects; provider probes are open-world,
publication/deletion are destructive, and idempotent is true only where service
evidence supports it. Annotations and confirmation dialogs grant no authority.
Logs/traces contain operation, safe correlation ID, outcome/error tag and retry
count, never tokens, signed URLs, private bodies or provider payloads.

## Composition and ownership handoff

Current flow: request-scoped MCP transport → persisted OAuth verification →
editorial actor → read/draft service → PostService or guarded store → projection.
Proposed flow preserves that shape: parse transport/input → verify live grant and
account → select authorized domain operation → apply scope/role/owner/visibility
checks in its server service → atomic revision/receipt transition or bounded read
→ explicit projection → MCP result. No extra HTTP call back into GBFM itself.

- P0 reserves only this file on `design/513-mcp-permissions`, independent from
  prod baseline above. Claim: issue comment 6704887805. No shared code changes.
- P1 owns shared principal/scope/error exports, registry, OAuth/consent composition
  and shared fixtures (`apps/server/src/mcp/`, core editorial scope contracts,
  API connection contracts and OAuth modules). Agree exact exports before edits.
- PL1 #533 is the proposed owner of D3 public playlist service/API/embed
  reconciliation under separate implementation approval; named ownership and
  verified shared visibility behavior are prerequisites to its MCP reads and
  playlist consumers. This is not P1 runtime scope. Track the gate in #533 before
  enabling those consumers; the D3 design approval alone does not authorize it.
- P2 owns credit/alias design; P3 owns recommendation evidence/algorithm; P4 owns
  draft reference design. This document does not select their schemas/algorithms.
  P3's public-only/no-provider/no-model/no-mutation requirements are adopted as
  a proposed boundary, not imported implementation or owner-approved policy.
- Canonical identity writes I1/U1/Q2 serialize; M1/M2 coordinate music versions;
  E1/E3/C1/C4 serialize shared post/version changes; PL2 owns playlist revisions.
  The parent must name the actual P1 integration owner and migration coordinator
  before their shared-file work starts. No migrations are requested in P0.
- Merge order remains approved P0 → P1 composed fixture → issue-specific
  consumers. P2/P3/P4 approvals and #89/#200/#316/#203 remain independent gates.

## Verification handoff, not implementation authority

P1 first extends a real composed fixture: persisted grant verification, one public
catalogue read and existing authored draft read/write, preserving legacy grants.
For each slice, write one failing public-interface test, implement minimally,
then refactor. Keep actual migrated local D1/service paths; do not prove permission
with registry metadata or domain mocks alone. Required distinguishing cases:

1. Listener grant with only catalogue scope versus listener using `posts:read`;
   revoked grant, disabled client/resource, banned/deleted/downgraded account.
   After creator-to-listener downgrade, a mixed `posts:read`/`catalogue:read`
   token fails entirely at the HTTP boundary; an independently consented
   catalogue-only grant remains eligible. No silent token downscoping.
2. Creator with catalogue write scope still denied shared mutation under D2;
   admin with missing scope denied; admin cannot fetch someone else's private ID.
   Distinguish test seams: an injected creator principal with `catalogue:write`
   must fail with service `access_denied`; this is not proof that real OAuth can
   issue such a token. Real OAuth must refuse the role-ineligible scope set, and
   persisted-token verification must invalidate the whole high-trust grant after
   admin-role loss. Test admission and service defenses separately; do not relax
   consent/token validation merely to make the synthetic principal reachable.
3. Null/future playlist versus published playlist; public collection with private
   mix; hidden child/source omitted from counts, links and joins.
4. Public recommendation cannot read private listening; explicit authored draft
   seed requires extra scope and yields only published candidates. No provider
   request or playlist mutation; insufficient evidence stays explicit.
5. Two browser/MCP edits from one revision: one applies, one conflicts; reference
   or playlist membership changes invalidate the same corresponding version.
6. Lost-response create retry and concurrent retry return one identity; changed
   payload conflicts; 24-hour boundary expires; revoked replay cannot leak data.
   Add lost-response delete and publish retries: after the row is removed or
   its draft state changes, the owned authorized receipt acknowledges the same
   completed operation without repeating it. Revoked/downgraded actors and
   other-owner/operation receipts fail; private payload access is checked anew.
   For non-lifecycle E1 attach/tag replay, remove the actor from draft co-authors
   after commit: the identical owned-receipt retry denies access and returns no
   private draft state, despite unchanged read/write scopes and unexpired receipt.
7. Accepted import/provider failure remains honest; bounded work, cancellation,
   no private-network fetch and no public URL before draft-byte privacy gates.
8. Read-only grants omit registered write tools from discovery; valid guessed
   calls still return service `access_denied`; unregistered names return protocol
   errors. Separate below/above encoded-byte tests from draft character bounds;
   the baseline's escaped 100,000-character fixture now fails request admission.

Run `bun precommit` and targeted protocol/OAuth/D1 tests at the final integrated
head. For this design-only proposal, source inspection establishes current-state
claims; it does not prove any proposed policy has been implemented or deployed.

## Owner decisions required before closure

**D1–D6 are approved for design only**, as recorded above. The table retains the
reviewed recommendations and alternatives; alternatives were not selected.

| ID | Recommended decision | Alternative / consequence |
| --- | --- | --- |
| D1 | Allow active listener-only accounts to consent to the U rows, including own listening/favorites/subscriptions/reminders, never editorial scopes | Keep creator-only connections; L1/L2/L3 are not generally available to listeners |
| D2 | Keep shared music/playlist mutation admin-only for now; “curator” is descriptive, not a new role | Authorize editor/creator or a new curator role explicitly, with application-wide service gates first |
| D3 | Artist/album/track/label timestamps are not privacy gates; approve explicit public projections. Playlist null/future timestamps are private | Apply timestamp visibility to all catalogue types, requiring consistent query behavior before reads ship |
| D4 | Require separate publish/delete/upload consent; listening visibility also separate; reminder scheduling consent states email delivery; no announcement authority | Specify a narrower public-action policy; affected commands stay blocked |
| D5 | Approve scope matrix/discovery/errors/retry rules and proposed bounds, including P3's one explicit authored draft seed and published-only candidates | Restrict recommendations to public seeds, or revise exact scope/error/bounds rows before P1/R2 registration |
| D6 | Admin MCP overview is aggregate-only, without emails, user/subscriber rows or raw operational failures | Enumerate any additional fields and privacy purpose explicitly before A1 |

The required owner choices are recorded for proposal revision 1, D1–D6, with no
additional exclusions. Design approval does not authorize implementation,
production policy activation, schema changes, merge or deployment. Repository
delivery and the remaining integration gates must be tracked separately.
