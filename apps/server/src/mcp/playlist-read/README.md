# PL1: public GBFM playlist reads

Issue #533. Initial integration base: PR #568 exact
`8dbd4f4863ddab00238f955913ca064629e7b321`. This branch does not combine sibling
schema or music-read branches. P1 owns central registration and the later combined head.

## Four selected tools

All four require `catalogue:read` and recheck the current account/grant. They read
published **GBFM** playlists, even for an admin or playlist owner. They neither
read a Spotify account nor import, enrich, publish, enqueue or call providers.

| Tool | Input | Result and limit |
| --- | --- | --- |
| `get_playlist` | `playlistId` | Explicit public header, revision, verified HTTP(S) provider links |
| `get_playlist_tracks` | `playlistId`, optional `limit`/`offset` | Default 50, max 100, offset 0–10000; ordered memberships and exact membership count |
| `compare_playlists` | `leftPlaylistId`, `rightPlaylistId` | At most 500 memberships each; intersection/differences by existing GBFM track ID only |
| `export_playlist` | `playlistId` | Complete inline JSON, at most 500 memberships and 65536 UTF-8 bytes |

The complete MCP response budget is 262144 bytes, including text/structured
duplication and nested escaping. Oversize results fail with `invalid_input`, not
partial data. Provider-link materialization is capped at 16 × selected entity
count plus one overflow sentinel. Links sort by entity/platform/URL, exclude
unverified rows and non-HTTP(S)/credential-bearing URLs, and never expose link
metadata or verification actors. JSON-array ID membership avoids D1 parameter
fanout at the 100/500-track limits.

Positions are stored positions, not page-relative ordinals. Gaps and ties survive;
ties sort by track ID. A damaged legacy orphan membership retains `trackId`,
position and date with `track: null`; comparisons list it separately and do not
match it. In the migrated schema, deleting a track cascades its membership, so
it disappears from pages and counts. Missing and unpublished/future playlists
all return `not_found`. Empty published playlists remain readable/exportable.

Comparison does not infer recording equivalence from titles, artists, provider
links or ISRCs, and is not a duplicate finder. Array order follows the relevant
playlist's deterministic membership order. Complete export/comparison reject a
changed header/revision observed across their reads; they do not promise a
cross-playlist transaction or replace PL2's still-pending all-writer fencing.

## Shared application policy

`services/music-entity/playlist.service.ts` owns:

- `publicPlaylistPredicate(now: Date)`: `publishedAt IS NOT NULL AND publishedAt <= now`.
- `getPublicPlaylistEffect(id: string, capturedNow?: Date)`: public existing-entry
  lookup. Returns `id/title/slug/description/coverImageUrl/publishedAt/createdAt/
  updatedAt/revision` with Date fields; no creator, curator or provenance.
  Errors: `DatabaseError | NotFoundError`; requires `Database`. Omitted time uses
  Effect Clock. A captured instant is an internal trusted input, never an MCP
  argument allowing callers to read future playlists.
- `getReadablePlaylistsEffect(reader?, id?, capturedNow?)` and
  `getReadablePlaylistByIdEffect(id, reader?, capturedNow?)`: browser curation
  access. The trusted session reader has `{id, role}`; the service reloads role
  and ban state. Current admins see all playlists; current non-banned owners
  (`createdById`, not descriptive curator attribution) see their private rows.
  Other readers see only public rows. Public DTO actor fields remain null for
  compatibility; current owners/admins retain those fields. MCP never supplies
  its principal as this browser reader.
- `getPublicPlaylistSnapshotEffect({playlistId, now, expectedRevision?})`: complete
  R2 evidence in one D1 batch (two SELECTs), at most 100 memberships, fetching a
  101st row only to reject overflow. Returns `{playlist, members, snapshotTime}`;
  each member has `trackId/position/addedAt`, nullable explicit track metadata
  (`id/title/artistNames/albumId/trackNumber/slug/coverImageUrl/publishedAt`) and
  nullable album metadata (`id/title/artistNames/slug/coverImageUrl/publishedAt`).
  Dates remain Dates. Errors: `DatabaseError | NotFoundError | ConflictError |
  ValidationError`; requires `Database`. A supplied stale revision conflicts.
  No provider links, per-track queries, resolution, writes or schema changes.
  Track/album timestamps are returned **without filtering**: R2 applies its
  stricter published-evidence rule at `snapshotTime`; PL1 does not change the
  canonical catalogue timestamp policy.

The public HTTP list/detail/tracks handlers and the public rich-content playlist
resolver use this source of truth. Private browser responses are `private,
no-store`. The tracks endpoint now returns 404 for unavailable/unknown parents,
not an indistinguishable successful empty array; the API declares that error.
Existing raw identity/import service reads remain internal and unfiltered so
canonical resolution and curation do not lose access to unpublished records.

E1 owns `post.service.ts`'s direct card/screen hydration call sites and must apply
this exported predicate there. PL1 does not edit that shared file, guarded post
persistence or post-music resolution. Public rich-content resolver snapshots
now reject private playlists before loading children. A safe rendered snapshot
does not authorize returning raw authored source IDs; R3 owns that projection.

## Integration and evidence

P1 composes `PlaylistReadToolkit`, `PlaylistReadHandlersLayer` and
`PlaylistReadServiceLayer` with the existing central transport. Only Database
and `EditorialMcpConfig` are needed by the read service; no external provider
layer is required. The lane-local test uses the actual `makeMcpRoutes` transport,
persisted OAuth consent/tokens and migrated D1. It changes allowed scopes only
in disposable fixtures. Production allowedScopes remain unchanged.

Checks cover public/owned/cross-owner/admin/banned reads, exact publication
instant and next millisecond, shared rich-content refusal, 100/101 snapshot
members, caller revision, track/album evidence timestamps, deterministic tied
positions/gaps/counts, 500/501 comparison limits, empty/deleted tracks, export
round trips, multibyte file limits, escaped MCP envelope limits, discovery/scope
isolation and live ban revocation. Read scenarios preserve catalogue tables and
record zero external-media fetches. Browser checks use a real admin cookie
session and an anonymous Chromium session through WWW: private dashboard rows
remain visible to admin; anonymous list omits them and detail/tracks return 404.

Output/materialization bounds are not a claim that counting a large playlist
examines a constant number of rows. The existing `(playlistId, position)` index
supports ordered playlist reads; exact counts still examine that playlist's
memberships, and tied-position secondary ordering can require sorting. Public
legacy list/API tracks remain their existing unpaged shapes. No index/schema
work is included here.

Closure still requires P1's reviewed central registration, E1's direct post
hydration incorporation and exact combined-head proof, plus independent actual-PR
Sol review. A lane-local passing test is not production activation or approval
to merge/deploy.
