# R1 catalogue reads (#518)

Base: P1 #548, `2d1b5592826e66e3a198dc117c153e062264fc5c`, atop P0 #547.
This module does not register production tools or change OAuth resource policy.
Keep its PR unmerged for the owner's overview review. R3 is a sibling, not a parent.

## Selected capability mapping

All nine wire names are retained. Every operation requires a live recognized account
and `catalogue:read`, including service calls outside the MCP transport.

| Tool | Input | Structured success |
| --- | --- | --- |
| `search_music` | query; optional kind, limit, offset | `MusicListResult` |
| `filter_music` | kind; optional exact name, limit, offset | `MusicListResult` |
| `get_music_entity` | kind + stable ID | `GetMusicEntityResult` |
| `get_music_entities` | ordered references, 1–50 | `GetMusicEntitiesResult` |
| `lookup_music_url` | HTTPS source URL | `LookupMusicUrlResult` |
| `get_artist_discography` | artist ID; limit, offset | `MusicRelationshipsResult` |
| `get_album_tracks` | album ID; limit, offset | `MusicRelationshipsResult` |
| `get_label_catalogue` | label ID; limit, offset | `MusicRelationshipsResult` |
| `get_music_relationships` | kind + stable ID; limit, offset | `MusicRelationshipsResult` |

Contracts live in `contracts.ts`. Shared failures use `EditorialToolError` with
`failureMode: return`: access denied, not found, invalid input or unavailable.
Empty lists succeed. Unknown/unresolved/orphaned/gated URL identities return a
successful `not_found` result. No fetch-on-miss or implicit canonical identity write.

Kinds are artist/album/track/label, never audio mixes/episodes. Playlist reads and
edges remain excluded until PL1's shared service/API/embed visibility gate closes.
D3 permits null/future catalogue timestamps, but not label draft bodies, creator
IDs, provenance, provider metadata or source leases. Only verified safe HTTPS
stored links are returned, normalized with the existing pure canonical parser;
rejected/unsafe links are omitted. At most 20 links per entity, with `linksHasMore`.
`observedUpdatedAt` is a stored observation, **not** a concurrency version for writes.
No invented artist/album browser URLs are returned where WWW has no detail route.

Lists default to 20, max 50, offset 0–10000; batch order and duplicates are retained
with explicit per-reference missing outcomes. Search uses literal substring matching,
filter uses exact name matching; both use SQLite's ASCII case folding. Paging sorts
by kind/ID, relationships by relationship/kind/ID. Album tracks sort by track number
(null last), then ID. Offset pages are not snapshots across concurrent catalogue edits.
No total-count scan, recursive graph or unbounded entity/link load is performed.
Responses over 256 KiB of encoded structured JSON fail explicitly; central transport
must retain its full MCP-envelope byte ceiling and lower read request limits.

## Central integration handoff (P1 owns these edits)

- Import `MusicReadToolkit` and `MusicReadHandlersLayer` from `./music-read/toolkit`.
- Include the toolkit in `composeMcpToolkits` at the central registry/route seam.
- Provide `MusicReadHandlersLayer` with `MusicReadServiceLayer` from `./music-read/service`.
  The service layer requires `Database` and existing `EditorialMcpConfig`; it supplies
  `McpAuthorizationLive` internally. The handler layer requires `MusicReadService` only.
  Neither layer requires canonical identity resolver, providers, artwork or object storage.
- Do not alter production allowed scopes or synthesize an expanded grant from an old one.
- Extend the P1-owned composed persisted-OAuth fixture to use the real toolkit in place
  of its demonstration artist tool. Verify listener catalogue-only discovery/calls,
  absent scope/guessed-call denial, revoked/banned/downgraded grants, R3 isolation and
  unchanged authored draft read/write behavior at the exact combined head.

`music-read.d1.test.ts` runs real migrated D1 and the installed MCP 2026-07-28 HTTP
adapter. It covers all nine tools, asymmetric relationships, null/future catalogue
timestamps, pages/batches/misses, safe projections, unsafe URLs, current service
authorization and encoded response bounds. URL lookup compares every application
table before/after. Persisted OAuth/discovery and final R1+R3+legacy composition remain
central proof, not claims established by this module's injected-principal fixture.
