# I1 #521: import execution and durability integration

This lane depends on P1 #548 at remote commit
`2d1b5592826e66e3a198dc117c153e062264fc5c`, not coordinator-local changes.
P0 D1–D6 in `docs/architecture/mcp-expanded-contracts.md` governs the design.
**No tools are registered yet.** Implementation approval is recorded below;
the atomic receipt runtime is published at `e01bc5547713b8d3d1680c3eb5cf03a467b8c6fa`
([PR #573](https://github.com/planetaryescape/gbfm/pull/573)), but is not integrated
into this head. Domain revisions and staged artwork remain prerequisites.
These are technical integration dependencies, not another owner-approval wait.
No production operations or provider-account writes are authorized here.

## Superseding implementation approval and allocation

At 17:30 on 2026-11-07 Guide Fari approved the surfaced implementation gates:

> everything that needs my approval, you have my thumbs up; the claude threads that got stuck because of limits, you can take that wrok over as a medium sol thing instead

Source: [P1 coordination thread](https://ampcode.com/threads/T-01a1b54f-7ac1-7503-9b0f-ffaf3fbc6c3e),
relayed to I1 and recorded in [#521](https://github.com/planetaryescape/gbfm/issues/521#issuecomment-6710735486).
This supersedes the earlier receipt/revision/canonical-writer/staged-artwork
approval wait, including MCP label audit without creator association. It does
not establish technical correctness, production access or merge permission.

P1 allocated I1 the four manual createEffect methods; canonical index
resolvePrepared/readReference/adoptLegacy and reuse/type authorization; repository
commit/updateArtwork/updateEntityMetadata; statement batching and artwork recovery.
M1 retains update/junction/affiliation/rename/delete methods. P1 serializes shared
physical integration. The common receipt owner alone owns mcp/operations and
migration 0016; the domain schema owner owns entity revision schema. I1 edits no
schema, migration/replay list or db exports. All MCP PRs stay OPEN, unmerged and
auto-merge off. Controlled providers and disposable D1 remain the proof environment.

`execution-authority.ts` supplies a required live-grant checkpoint service for
admission, provider work, guarded mutation and replay. P1 must provide fresh
persisted OAuth verification for the configured audience on every check; there
is no cached-principal fallback. The checkpoint rejects actor/client substitution,
rechecks live account/scopes, and checks playlists:write for the actual inferred
or reused type even when the URL input claimed track. Its D1 tests use controlled
grant verification plus real account persistence, not a claimed composed OAuth
proof. No in-memory receipt or pretend writer is provided.

## Delivered module boundary

`commands.ts` exports five bounded Effect schemas and `MusicImportCommandsLayer`.
Provide P1's `McpAuthorization` (live layer requires `Database`); each `prepare`
call requires request-scoped `McpActor`. Its only operation accepts
`{ operation, input }` plus the configured, branded `McpResourceUrl` as a separate
trusted composition argument, never a client-selectable field. P1 must supply the
same configured audience its persisted OAuth verifier used. Preparation returns
the parsed command, complete receipt scope (including resource), typeAuthority
and SHA-256 payload fingerprint. Authorization failures are normalized to the
same `McpToolError` failure schema as input/dependency failures, so a future tool
can encode denials without remapping. This is **preparation**, not accepted/applied/replayed work.
It writes nothing and calls no providers. It must not become a wire preview tool
(preview import is explicitly deferred). P1 alone owns registration/composition.

| Selection | Input and authority | Eventual application owner |
| --- | --- | --- |
| `import_music_url` | UUIDv4 requestId, URL, optional artist/album/track/playlist type, explicit artwork policy; admin + catalogue:write + catalogue:import + providers:read; playlists additionally playlists:write | CanonicalMusicIdentity.resolveSource, after durable acceptance exists |
| `create_artist` | UUIDv4, name/slug, optional bio/image/genres; admin + catalogue:write | music-entity/artist.service.ts createArtistEffect |
| `create_album` | UUIDv4, title/slug, optional ordered artists/releaseDate/cover/genres/albumType; same authority | album.service.ts createAlbumEffect |
| `create_track` | UUIDv4, title/slug, optional ordered artists/cover/album/trackNumber; same authority | track.service.ts createTrackEffect |
| `create_label` | UUIDv4, name/slug/content, optional description/artwork/tags/genres; same authority | label.service.ts createLabelEffect validation, but requires the approved writer seam to suppress creator association |

MCP manual creation must not assert ownership. The live actor supplies audit
createdById, never client input. **Existing createLabelEffect does not meet this
contract**: passing createdById also inserts music_label_creators, which grants
release-management authority through requireCreatorOrAdmin even after admin
demotion. The browser path does this today; browser parity is not permission to
extend that grant through MCP. The approved shared writer must retain actor audit
attribution but skip that creator association for MCP create_label, while keeping
browser/PAT behavior unchanged. This approved shared-service seam is not
implemented here yet; do not call the existing function unchanged. Artist, album
and track createdById currently have no equivalent authority side effect.
Publication timestamps are not accepted by this
initial preparation contract. Label imports are not canonical URL imports:
`label` is rejected as expectedType; manual label creation remains separate.
Existing HTTP/PAT/browser inputs and success behavior are unchanged; the shared
HTTP error mapper now exposes typed authorization denial as 403 Forbidden,
including the resolvePostMusic endpoint's declared error schema. Strict unknown-key
rejection prevents silently accepting unsupported options. Fields are bounded,
arrays max 50, decoded encoded JSON max 256 KiB; transport must separately enforce
the original raw request/response JSON ceiling before parsing. Canonical ISO UTC
releaseDate strings avoid timezone-dependent fingerprints. Manual artwork URLs
are references only, not permission to fetch or upload assets.

Fingerprint semantics: sorted field names, canonical source URL, operation name;
requestId is in the receipt key, not the payload hash. Null differs from omission;
array order and exact manual strings remain meaningful. Changing expectedType or
artwork policy changes the fingerprint even for the same canonical source.
URL normalization reuses the canonical parser rather than inventing identity.
Generic source URLs may yield a provider-inferred playlist: the future execution
owner must check playlists:write again after type resolution **before commit**.
The prepared result exposes `typeAuthority: 'pending'` for generic URLs without
an external ID unless playlist authority was already required, and for videos.
A caller-supplied expectedType does not resolve generic URL authority: the
type-independent URL identity can reuse a stored playlist even when the hint is
track. Provider identities with a known non-video type and manual creates return
`resolved`. Neither
value is authority to commit later: every execution/replay still rechecks live
authorization. Pending imports require a hook in canonical index.ts immediately
after inferredType and before any identity/metadata commit (including reuse of
an existing reference); fail closed on a resolved playlist without playlists:write.

`outcome.ts` exports `ImportPersistenceOutcome` and `projectImportPersistence`.
It projects a **single resolver attempt**, not an exactly-once command result:
created/reused follows the resolver; typed artwork-upload failure yields partial
with a committed reference but unknown original disposition. Other typed failures
map to safe MCP codes; storage errors explicitly retain an unknown outcome.
No raw provider payload/message, conflict source key, internal actor or link
metadata is returned. Resolver success does not prove artwork delivery (even
required mode can skip an unsuccessful fetch), so artwork stays `not_reported`.
P1 must wrap eventual wire output with EndpointIdentity, observed version and
safe review URL after the writer supplies them; these are not fabricated here.

## Evidence from current persistence

Run in `apps/server`:

```sh
bunx vitest run --config vitest.d1.config.ts src/mcp/music-import
bunx vitest run --config vitest.unit.config.ts src/mcp/music-import/outcome.test.ts
```

The D1 harness replays the repository's real flat migrations into disposable
Miniflare D1. Controlled scraper/fetch/object-store adapters never use the
network. Six fresh resolver layers concurrently resolve one source: exactly one
created result, five reused results, one persisted identity and entity. A fresh
layer after a discarded response returns the same ID but `created: false`;
**canonical identity cannot replay the original created outcome**. Changing the
provider title for the same source returns the original metadata without a
changed-input conflict: source identity is not a command receipt.

Required artwork upload failure leaves the entity and source identity committed.
Retry with preserve returns that same entity and known-good metadata. This proves
the transaction boundary, not reliable remote-effect completion. Preparation
tests separately exercise the real live-account D1 authorization path, all five
commands, each import scope, inferred playlist scope, role downgrade, ban,
deletion, fingerprints, strict fields and escaped-byte limits. Synthetic actors
do not prove persisted OAuth revocation: P1 owns that composed fixture and must
run it again at final integration. No durable command replay, expired tombstone
or command-level changed-payload conflict is claimed proven before storage exists.

## Approved shared storage requirements (integration pending)

Use M1/P1's **one shared receipt and guarded writer**, not a lane-specific ledger.
Relevant existing schema: `apps/server/src/db/music-entity.schema.ts`
(`music_source_identities`, aliases, conflicts, entities and junctions),
`editorial-operation.schema.ts` (post-bound receipt), `tags.schema.ts`
(genre/tag junctions), and `auth.schema.ts`/`oauth.schema.ts` for actor/client and
live grant authority. Migration directory, replay list and exports stay
coordinator-owned: `apps/server/drizzle-d1/`, `src/test/migrate-d1.ts`,
`src/db/exports.ts`. No filename is requested or reserved.

Required shared receipt fields/constraints, for consolidation with M1/L2:

- Unique `(actorId, clientId, resource, operation, requestId)`; resource is the
  configured MCP resource audience (environment separation), not the entity ID
  which does not exist yet on create. If the shared schema also has a target
  column, retain it separately. Operations are the five exact selection IDs.
- Immutable inputHash and acceptance/expiry instants; 24-hour replay window.
  Retain the unique identity and expired evidence after response pruning so the
  same key never creates again. Same key/different hash conflicts, including
  while pending. Same key after expiry returns expired, never starts new work.
- Stable operationId, nullable resolved entity type/ID and committed revision,
  bounded saved outcome with original created/reused disposition. Retrying the
  command must not infer its original disposition from a later source lookup.
- Durable phase/lease fencing for accepted import work, catalogued state and
  enrichment state; enough safe error evidence to distinguish pending,
  committed-partial, completed and unknown external-effect outcomes. Store no
  credentials/provider payloads; retention of command content needs privacy
  review. Store hashes/normalized source and the minimum resumable metadata.
- Atomic manual create + artist/label/tag junctions + derived artistNames +
  initial revision + terminal receipt. Existing create functions allocate IDs
  inside themselves and can mutate labels after the entity batch; wrapping
  them with a later receipt INSERT leaves a crash gap. The shared writer must
  own the statement batch, or expose a statement-building seam with one owner.
- Atomic canonical catalogue commit + identity claims/aliases/links/junctions +
  initial revisions + receipt transition recording created/reused and reference.
  Source leases remain the existing canonical mechanism; request receipts must
  not replace or duplicate them. Reuse must record its disposition durably too;
  it must not rewrite known-good metadata. If reuse attaches links/aliases that
  affect visible state, the shared writer decides/bump guards consistently.
- Authorization is fresh before acceptance, provider work, each guarded write
  and replay, including actual provider-inferred type. Re-read current account
  and persisted grant through P1; check resource/client/actor/operation and
  current target access/existence before returning a saved result. Preparation
  is not a reusable authorization token and a receipt does not grant authority.

Remote scraper reads happen outside D1 batches. Catalogue commit must durably
record that artwork is pending before attempting remote upload. Upload and DB
artwork association cannot be one transaction; use a stable per-entity object key
and a fenced guarded revision update plus receipt phase transition after upload.
If upload succeeds and association fails/disconnects, retain a resumable partial
state and reconcile the same operation, not claim rollback or definitely absent.
Reliable background acceptance requires the existing import-status owner #200
and approved delivery/outbox semantics; do not implement an in-memory worker or
infer durable delivery from a live request. Original command outcome and latest
enrichment status need distinct fields; retries must not rewrite the original
created/reused fact. Only controlled provider/storage adapters are used here;
production execution and provider-account writes remain prohibited.

### Staged artwork protocol sent to the common receipt owner

The atomic v1 runtime is catalogue-only. The common receipt owner owns the
approved 0021 extension; this branch does not create a second stage table.
The recovery contract submitted for that extension is:

- Phases: pending → uploading → association_pending → delivered, with failed
  reserved for known terminal failures. Preserve mode creates no stage or remote
  effect. Catalogue reference, observed revision and original created/reused
  disposition are saved atomically with pending, before upload.
- Freeze SHA-256 content digest, MIME type, bounded size (1 byte–10 MiB) and stable
  object key before upload. Key identity is
  `music/type/id/imports/operationId/sha256/cover`; never overwrite a shared cover.
  A retry may upload only matching content. Persist a source key, never signed
  URLs, candidate/provider URLs, credentials or provider payloads.
- Lease duration is 60 seconds, renewal every 20 seconds, takeover only after
  expiry. Every transition checks an unexpired lease, physical UUID attempt and
  monotonic generation. Upload remains outside D1; a lease is not a network
  transaction and cannot undo an object-store effect.
- Association checks the saved expected entity revision and increments the
  revision with the same attempt marker and delivered phase in one atomic batch.
  It must not silently rebase over a later administrator edit.
- Upload success followed by association failure retains association_pending;
  reconcile the same immutable key and descriptor. Ambiguous timeouts remain
  recoverable, not proof of absence or terminal failure. Fresh authorization is
  mandatory before provider work, upload, association and result disclosure.
- Redacting the original outcome after 24 hours never expires in-flight recovery
  or deletes an asset. I1 provides no garbage collector; cleanup must never
  delete an associated asset.

## Allocated shared-writer collision map

P1 allocated the create/canonical methods below to I1 and serializes physical
integration with M1. Shared schema, migration/replay lists and db exports remain
outside this branch's allocation.

| Path | Methods / required coordination |
| --- | --- |
| services/canonical-music-identity/repository.ts | commit: receipt transition in same D1 batch, no fast-path receipt omission; updateArtwork: guarded revision/receipt association; updateEntityMetadata: guarded refresh and affected relationship revisions |
| services/canonical-music-identity/repository-statements.ts | entityInsertStatements/newArtistStatements/primaryEntityStatement and relationship/link statements: initial revisions for newly created entities and derived artists; reuse mutations invalidate the same version as M1/U1 |
| services/canonical-music-identity/index.ts | resolvePrepared/readReference/adoptLegacy reuse and commit paths: carry request context to the ONE approved writer; add resolved-type authorization immediately after inferredType and before commit, also check reused reference type before recording reuse; preserve source lease fencing; no independent import writer |
| services/canonical-music-identity/entity-operations.ts | refresh/enrich/attach/release coordination with M1/U1/Q2: provider snapshot must not overwrite a newer admin edit; artist rename must fan out parent artistNames/revisions atomically |
| services/canonical-music-identity/artwork-delivery.ts | deliverMusicArtwork: durably staged effect and guarded association; preserve known-good state; do not treat skipped required fetch as confirmed delivery |
| services/music-entity/{artist,album,track,label}.service.ts | create methods only: contribute statements to the shared writer; label create needs an explicit audit-without-creator-association seam so MCP inserts no music_label_creators row; M1 owns proposed update/junction changes, including artist rename fan-out |
| db/labels.ts | Genre/tag insertion during creates must participate in the same receipt/revision batch; coordinate M1's genre replacement lane, no separate writer |

Refresh is not one of I1's five commands and is not implemented here. Its raw
repository writes are nevertheless a bypass if M1 revisions land without that
integration. Canonical create initializes revisions; canonical reuse reports
existing revisions and only increments on actual visible mutation; refresh and
artwork association compare/increment the same guarded entity revision. Playlist
revision/visibility remains PL1/PL2-owned and must join the same integration
before playlist imports become executable. R1/#551 integration/production HOLD is unchanged.

M1 owns update/junction/affiliation/rename/delete methods and the shared
artist-fanout/name-key helpers, not creates or canonical writes. Domain revision
DDL (0017, no triggers) is separately owned. R1 owns its read indexes; neither
allocation grants I1 schema, migration or replay-list ownership.

Until the approved shared prerequisites are integrated and proved, all five
commands stay unregistered. Required integration proof: concurrent identical
command keys, concurrent differing keys
for one source, changed-payload conflict, discard response then exact receipt
replay, expired tombstones, revoked replay, browser/MCP revision conflict, and
upload-success/DB-association-failure recovery on disposable D1.
The label-writer proof must also show no music_label_creators row is added
by MCP create_label, audit attribution survives, and a demoted creator gains no
release-management authority from that create. Existing browser/PAT label creation
must retain its current behavior.
