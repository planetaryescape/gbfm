# PL2 #534 — contracts and desired-state planner only

This is **not a delivered command runtime**. No tool is registered, no SQL is
executed, and no browser/PAT writer has been cut over. PL1 PR #577 remains
unchanged for its assigned independent Sol review.

Branch `feat/534-playlist-curation` starts from P1's named PR #575 prerequisite
`695bb12d2149bcbe123f0b6e7661909c4c3ea5ee`, then carries the two owned PL1 commits
once. No sibling schema/provider code is incorporated. Schema 0020 must arrive
through a later named P1 combination; this lane does not edit DDL.

## All selected capabilities retained

Every mutation carries UUIDv4 `requestId`; every existing-target mutation carries
GBFM `playlistId` and safe nonnegative integer `expectedRevision`. Scope mapping
does not confer authority: the future service must enforce current persisted
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

## Exact runtime closure gaps

- P1 named combined prerequisite containing schema 0020's physical
  `last_operation_id` marker and revision CHECK, live SQL authority, plus frozen
  trusted browser/PAT receipt namespaces and deletion cleanup. Never consume a
  schema sibling directly; no trigger/rebuild/second ledger is introduced here.
- Existing playlist service owns persistence. Build common receipt plans with
  `ctx.fence`, caller CAS, `ctx.attemptId` marker and winning revision on **every**
  fanout statement; `assertApplied` must prove the physical winner. No `changes()`
  carryover shortcut. Saved results require wire/outcome budgets before execution.
- Browser/PAT/API payloads and all playlist writers need the same request/revision
  contract, explicit publication route and guarded backend; current optional-free
  legacy payloads are not safe cross-channel fencing. Imports, link enrichment,
  deletion and membership edits must participate in revision invalidation too.
- URL-add and sync require the import/status owner's actual checkpoint/fencing/
  accepted-versus-completed contract. No providers or queues are invoked here.
- Central registration, actual receipt/replay/concurrent browser-MCP proof on
  migrated D1, integration tests at the final composed head, full checks and
  independent actual-PR Sol review remain. Planner tests prove only the pure
  transition contract, not SQL atomicity, permission enforcement or completion.

No production/provider operations, deployment, merge or auto-merge is authorized.
