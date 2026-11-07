# I1 #521: schema-free preparation and durability handoff

This lane depends on P1 #548 at remote commit
`2d1b5592826e66e3a198dc117c153e062264fc5c`, not coordinator-local changes.
P0 D1–D6 in `docs/architecture/mcp-expanded-contracts.md` governs the design.
**No tools are registered or executable by this change. #521 remains blocked
on the consolidated storage/guarded-writer decision.** No migration, production
policy, provider access, object storage or email execution is authorized here.

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
browser/PAT behavior unchanged. This required shared-service seam is gated and
not implemented here; do not call the existing function unchanged. Artist, album
and track createdById currently have no equivalent authority side effect.
Publication timestamps are not accepted by this
initial preparation contract. Label imports are not canonical URL imports:
`label` is rejected as expectedType; manual label creation remains separate.
Existing HTTP/PAT/browser schemas and behavior are untouched. Strict unknown-key
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

## One consolidated storage decision requested (not a migration allocation)

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
created/reused fact. Provider/storage execution remains separately gated.

## Shared-writer collision map: allocation needed before edits

No shared edits or reservations are taken by I1. Proposed exact scope for P1's
serialized integration (not permission for this branch):

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

Narrow reservations already allocated elsewhere: M1 has only the album.service.ts
`and` import and removeArtistFromAlbumEffect WHERE bug fix; leave both untouched.
R1 alone has the music-entity.schema.ts index declarations,
0015_music_catalogue_read_indexes.sql, migrate-d1.ts replay append and conditional
schema-test parity. Those reservations grant no receipt/revision/canonical-writer
schema approval. I1 remains disjoint and imports none of R1's code.

Until P1 records storage approval, allocates this method scope to one owner and
delivers the atomic service seam, all five commands stay unregistered. Required
post-approval proof: concurrent identical command keys, concurrent differing keys
for one source, changed-payload conflict, discard response then exact receipt
replay, expired tombstones, revoked replay, browser/MCP revision conflict, and
upload-success/DB-association-failure recovery on disposable D1.
The gated label-writer proof must also show no music_label_creators row is added
by MCP create_label, audit attribution survives, and a demoted creator gains no
release-management authority from that create. Existing browser/PAT label creation
must retain its current behavior.
