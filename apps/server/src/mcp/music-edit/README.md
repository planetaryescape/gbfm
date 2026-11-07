# M1 #523: guarded music edits

## Authority and stack

P1 relayed Guide Fari's blanket approval at 2026-11-07 17:30:38.618Z, coordinator
message `M-25AnVGIQb4kP4RIwEzygur`:

> everything that needs my approval, you have my thumbs up; the claude threads that got stuck because of limits, you can take that wrok over as a medium sol thing instead

This records a relay, not direct human-message provenance. Approval covers the
surfaced receipt/revision/guarded-writer recommendations, not merging MCP PRs or
production operations. No repeat approval wait applies to that implementation.
No new Claude calls are allowed; independent follow-ups use Sol.

The runtime follow-up #578 is rooted at P1 #575 exact
`695bb12d2149bcbe123f0b6e7661909c4c3ea5ee`, carrying the five M1 leaf commits once.
The reviewed #561 leaf remains preserved. No sibling schema or central read
history is woven into this branch. Tests use real 0016–0019 migration replay;
the earlier disposable candidate ledger/trigger proof is removed. Runtime writes
use only `mcp/operations/store.ts`.

## Delivered domain slice, not activation

`createMusicEditExecutor(checkpoint).apply(command, now)` uses the shared durable
store for all eight edit forms. The checkpoint is mandatory and structurally
matches P1's frozen `CommandAuthority.checkpoint(ReadonlyArray<McpScope>)`:
fresh actor/client/resource plus persisted `liveGuard: SQL`, or `McpToolError`.
There is no default provider, captured-principal shortcut or duplicated grant SQL.
Composition requires `Database` and `McpOperationStore` using the same D1 binding.
P1's actual production provider is still a prerequisite.

| Operation | Domain contract |
| --- | --- |
| `update_music_metadata` | Artist name/bio; album title/canonical UTC releaseDate; track title/trackNumber; label name/description |
| `set_music_genres` | Ordered distinct trimmed names, at most 30; empty clears genres without deleting tags |
| `set_album_type` | LP, EP, single, compilation or explicit null |
| `set_track_album` | Existing observed album or explicit null |
| `set_artist_credit` | Album/track existing primary/featured/producer/null role; displayOrder then SQLite BINARY artistId |
| `remove_artist_credit` | Exact parent/artist pair; ordered artistNames recomputed in the same batch |
| `set_label_affiliation` | Artist/album to existing observed label; both endpoint revisions advance |
| `remove_label_affiliation` | Exact pair and both endpoint revisions |

Wire command: `{requestId: UUIDv4, expectedRevision, references, change}`. References
are the exact zero-or-one artist/album/label observation required by the change.
Identity, ownership, publication, content authoring and managed artwork are excluded.

`MusicEditPreviewToolkit`, handlers/live service and input/result schemas remain
exported for P1 composition. Preview reads target, relationship and reference
revisions in one SELECT and returns bounded before/after plus expectedRevision
and references. Oversized existing collections fail closed, not partial reads.
It remains read-only, `preview_only`, `applyAvailable:false`: observations are
not reservations, credentials or apply authorization.

Effect Toolkit decodes public parameters before per-service authorization.
Malformed tool calls get framework parameter errors; valid read-only-principal
calls get access_denied. Existing protocol tests pin that P1 behavior.

## Atomicity, replay and shared seams

Every statement includes the common receipt fence and supplied live SQL guard;
coupled DML additionally requires the winning physical attempt marker. Final
assertion failure rolls back root, junctions, projection and receipt together.
Checkpoint again before saved-result disclosure and reject identity substitution.
Current-state validation failures are deferred until the store's build callback:
replay occurs first, so later edits or removed references do not reject a valid
saved result. Changed payload under the same key conflicts. Expired keys remain
non-reusable redacted tombstones under the common store's policy.

Changed root revisions, changed affiliation labels and all rename fanout parents
must have safe-integer capacity inside the root CAS. No-ops retain revision and
still mark the physical attempt. Fanout defensively aborts rather than skips an
exhausted parent, rolling back earlier updates too.

- `artist-fanout.ts`: `artistNameFanoutCapacity`, `artistPrimaryNameAvailable`,
  `artistNameFanoutStatements`. I1 must include capacity and normalized alias
  collision predicates in its artist CAS, then append fanout under the same
  physical attempt and combined common fence/live guard before receipt completion.
- `statements.ts`: `MusicParent`, `musicParentCas`, `musicParentGuard`, `musicParentWinner`,
  `musicEditStatements`. Live SQL authority is required explicitly, not implied
  by eligibility or the receipt.
- `version.ts`: `MusicObservation`, `MusicVersion`, `musicVersion`. M2 decodes a
  complete artist/recording observation, hashes the bound kind/ID/integer revision,
  compares against its expectedVersion, then CASes the same integer. No second ledger.
- `services/music-entity/name-key.ts`: `musicFactNameKey`, exact NFC/trim/whitespace
  collapse/lowercase/NFC normalization shared with M2 and canonical rename.

Rename preserves valid alias facts and rejects a proposed primary name matching
an existing normalized alias. Parent artist revision invalidates earlier alias
reads. Schema FKs cascade aliases on deletion and restrict recording-credit
references; allocated artist-delete integration still needs verification.

## Evidence and remaining delivery

Run `bun precommit` at root. From apps/server:

```sh
bunx vitest run --config vitest.d1.config.ts src/mcp src/services/music-entity
bunx vitest run --config vitest.unit.config.ts src/mcp
```

Real migrated-D1 executor tests run all eight mutations through the actual common
store, preserve tag/genre and junction/name invariants, reject alias collisions,
project rename fanout, replay original results after later edits/reference removal,
reject changed-payload retries, redact expiry, arbitrate stale contenders, and
roll back a live-predicate revocation after root CAS. Their explicit injectable
policy table is NOT the production OAuth/session/PAT provider. These tests prove
enforcement of a supplied guard, not production credential admission.

Separate regressions pin safe-integer exhaustion, late-track fanout rollback,
Unicode SQL/JS ordering and the exact-pair album credit removal bug (asymmetric
two-album/two-artist public-service red/green). Read-only preview protocol tests
exercise the actual tools/call route, not persisted production OAuth.

#523 remains incomplete. No central mutation toolkit registration or activation,
shared browser/API/PAT writer cutover, canonical caller integration, real-provider
privacy proof, merge, auto-merge or production operation is claimed here.
M1's allocated next work covers artist update/delete; album update/credits/delete;
track update/credits; four affiliations; label metadata; genre-only guarded writer;
existing edit/read API and HTTP envelopes. I1 owns create/canonical/artwork members.
Shared index edits must remain disjoint. Dashboard shared command/update/model/
message belongs to P1; M1 only owns page/catalog.ts. UI saves must carry the
actually loaded revision, stable request ID for identical retries, new ID on
changed intent, and preserve edits on conflict—never re-read latest before save.
No schema/migration/replay/export edits are owned by this lane.
