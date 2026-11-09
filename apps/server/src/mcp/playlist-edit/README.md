# PL2 #534 — guarded local commands; cutover incomplete

This is **not full PL2 delivery**. Seven local mutation handlers plus preview
execute through the common receipt store and existing playlist service. The
toolkit is composed in isolated real OAuth/MCP tests, not centrally registered.
Browser/API writers and provider commands have not been cut over. PL1 PR #577
remains unchanged and its reviewed delta is included in the named base once.

Branch `feat/534-playlist-commands` starts from P1's named PR #575 prerequisite
`b1b3345d92bb1455f1e942c21e9b361d7a394073`, then adds only new PL2 changes.
No sibling schema/provider code is incorporated. Schemas 0020–25 are already in
that base; this lane does not edit DDL.

## All selected capabilities retained

Every mutation carries UUIDv4 `requestId`; every existing-target mutation carries
GBFM `playlistId` and safe nonnegative integer `expectedRevision`. Scope mapping
does not confer authority: the service enforces current persisted
grants, admin role, target access and SQL-time authority, including on receipt
replay. Curator attribution is not a role. No Spotify-account authority exists.

| Selected wire name | Additional input | Scopes | Present preparation |
| --- | --- | --- | --- |
| `create_playlist` | Complete title/slug/description/cover metadata | `playlists:write` | Unpublished empty desired state, revision 0; no identity allocated |
| `update_playlist` | Nonempty metadata patch | `playlists:write` | Omitted preserves; explicit null clears nullable fields |
| `add_playlist_tracks` | 1–100 distinct existing GBFM track IDs | `playlists:write` | Append absent IDs in caller order, retain existing membership dates/positions |
| `remove_playlist_tracks` | 1–100 distinct IDs | `playlists:write` | Remove named members; absent members no-op, surviving gaps retained |
| `reorder_playlist_tracks` | Complete distinct ordered ID set, max 500 | `playlists:write` | Exact set required, positions become 0..n−1, dates retained |
| `add_playlist_track_from_url` | HTTP(S) URL without credentials | `playlists:write catalogue:write catalogue:import providers:read` | Input/scope contract only; import/execution/preview unresolved |
| `sync_playlist_links` | Target and revision | Same four import/provider scopes | Input/scope contract only; accepted/completed status unresolved |
| `preview_playlist_changes` | A complete proposed mutation command | Same scopes as proposed mutation | Envelope contract; local planner returns exact before/after, no receipt/write |
| `publish_playlist` | Target and revision, no timestamp payload | `playlists:write playlists:publish` | Immediate publication at trusted captured time; already public no-op |
| `unpublish_playlist` | Target and revision | `playlists:write playlists:publish` | Explicit null publication; already unpublished no-op |

Metadata cannot carry publication, creator or curator fields. Boundary decoding
rejects excess fields rather than silently stripping an attempted publication
change. No broad update payload publishes a playlist. A future-dated row can be
published immediately only by the explicit publish command. This is not a
scheduled-publication feature.

## Planner seam

`contracts.ts` exports the nine mutation schemas, their union `PlaylistCommand`,
`PreviewPlaylistChanges`, `decodePlaylistCommand` and `playlistCommandScopes`.
`LocalPlaylistCommand` excludes URL-add and sync. Preview inherits the exact
proposed mutation's complete scopes; previewing a provider command does not call
providers or pretend that unresolved import effects are known.

`planner.ts` exports:

```ts
planPlaylistChanges({
  command: LocalPlaylistCommand,
  snapshot: PlaylistState | null,
  now: number,
  catalogueTrackIds: ReadonlySet<string>,
})
```

This returns an Effect with `ValidationError | ConflictError` and no dependencies.
`PlaylistState` contains playlistId/revision, explicit metadata, nullable epoch-ms
publishedAt and at most 500 `{trackId,position,addedAt}` memberships. Results contain
operation, target (null for an unallocated create), expectedRevision, resulting
revision, changed, and complete before/after states. Dates remain epoch ms.
Snapshot target/revision and membership uniqueness are checked. Adds require one
bounded catalogue-existence read by the future service; missing tracks fail,
never silently import or disappear. Track/album catalogue timestamp policy is
unchanged. Preview exposes no actor IDs, provider metadata or raw receipt state.

No-ops still check the caller revision. Changed state advances revision exactly
once; exhausted revisions/positions and >500 membership results fail rather than
overflow or truncate. A no-op at MAX_SAFE_INTEGER is permitted at the planner
level, but the executor must still acquire the physical winning marker without
incrementing revision. Inputs and snapshots are not mutated.

## Runtime seam

`services/music-entity/playlist.service.ts` exports
`applyPlaylistCommandEffect(LocalPlaylistCommand)` requiring `Database`,
`CommandAuthority`, and `McpOperationStore`. Its bounded acknowledgment contains
`playlistId`, `revision`, `changed`, `membershipCount`, `operationId`, `replayed`.
Receipt lookup precedes observation, so an exact retry returns the original
committed result even after later edits. Replays still require current authority
and target existence. Observation reads at most 501 members; >500 fails closed.
The target CAS saves the physical attempt marker even for a no-op. Each dependent
membership statement and final assertion checks that marker, resulting revision,
common receipt fence, and live SQL authority. No `changes()` carryover is used.

`previewPlaylistCommandEffect(LocalPlaylistCommand)` requires `Database` and
`CommandAuthority`, shares the desired-state observation, rechecks authority,
and limits the duplicated MCP envelope to 250000 UTF-8 bytes. It writes no
receipt or domain data. Applying a preview repeats observation and CAS; preview
is never a reservation. `toolkit.ts` exports `PlaylistEditToolkit` and
`PlaylistEditHandlersLayer`; authority is resolved per call, not at construction.

Migrated-D1 tests exercise the service with a persisted browser session authority
and the toolkit through actual OAuth grants plus `makeMcpRoutes`: create/replay,
changed-input conflict, concurrent revision contenders, original replay after
later edits, preview without writes, rejection of hidden publication fields,
separate publish consent, no-op publication and ban denial. These are not proof
of browser route cutover or canonical/provider writer safety.

## Exact runtime closure gaps

- Named serial adoption of I1's reviewed retirement statement helper, then
  deletion inside the guarded parent/relations batch: parent physical CAS,
  retirement, child cleanup and parent DELETE, with final no-referencing-status
  assertion AND a physical-delete witness. The single-parent guarded DELETE must
  immediately precede common finalization so `changes() = 1` refers to that
  DELETE; no intervening statement is permitted. Absence alone is insufficient.
  Capacity exhaustion must abort the entire batch. PR #595 is not
  adopted by this branch and no nonexistent helper is imported.
- Browser/PAT/API payloads and all playlist writers need the same request/revision
  contract, explicit publication route and guarded backend; current optional-free
  legacy payloads are not safe cross-channel fencing. Imports, link enrichment,
  deletion and membership edits must participate in revision invalidation too.
- Existing PAT policy deliberately excludes playlist commands; do not expand it.
  I1 owns canonical `updateArtwork`/`updateEntityMetadata` and refresh/enrichment
  fences. Their raw writers remain an explicit all-writer gap pending reviewed
  named adoption; this local command path cannot compensate for them.
- URL-add and sync require the import/status owner's actual checkpoint/fencing/
  accepted-versus-completed contract. No providers or queues are invoked here.
- P1 owns central registration and per-tool request budgets (500 IDs may exceed
  the existing 16 KiB non-draft admission limit). Actual concurrent browser-route
  versus MCP proof, final integrated full checks, and independent actual-PR Sol
  review remain.

No production/provider operations, deployment, merge or auto-merge is authorized.
