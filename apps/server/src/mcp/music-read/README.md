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
The byte budget measures both structured JSON and the adapter's duplicated text,
including nested string escaping. Encoded tool results above 232 KiB fail explicitly,
reserving 24 KiB for JSON-RPC/SSE framing and the ID from the <=16 KiB read request.
Central transport must retain its full 256 KiB envelope ceiling and lower request
limits. Real HTTP tests exercise ordinary, escaped and multibyte names on both sides
of the budget; the failure retains the smaller-page/batch guidance.

## Query cost limitation — integration HOLD

**Bounded output is not bounded rows examined.** Application materialization is at
most 51 list/relationship rows, 50 batch references, three URL identity candidates
and 21 link candidates per returned entity. Database scans and temporary sort work
can still grow with catalogue size. This does **not** satisfy #518's bounded-query
acceptance by disclosure alone. Integration stays HOLD until Guide Fari explicitly
accepts this limitation for the slice or authorizes separately coordinated index
work. No migration is included or authorized. Substring/name search needs its own
decision: the three relationship indexes below would not solve it.

`EXPLAIN QUERY PLAN` captured on migrated Miniflare D1, 2026-11-07, by instrumenting
the real service's Database adapter to explain each statement before executing it:

| Operations | Source-kind predicates and remaining cost |
| --- | --- |
| `get_artist_discography`; artist `get_music_relationships` | `artistId = ?` on `music_album_artists` and `music_track_artists`: **SCAN both full tables**, absent artistId indexes. General relationships also search indexed `music_label_artists.artist_id`. |
| `get_album_tracks`; album `get_music_relationships` | `albumId = ?` on `music_tracks`: **SCAN full track table**, absent albumId index. General relationships search indexed album credits and `music_label_albums.album_id`. |
| `get_label_catalogue`; label `get_music_relationships` | `label_id = ?` on both label edge tables: covering PK **SEARCH**, no catalogue-wide edge-table scan. Sorting still depends on this label's matching edges. |
| Track `get_music_relationships` | `trackId = ?` credit PK **SEARCH** and `id = ?` track PK **SEARCH** for album membership. No unrelated artist/album/label edge-table scan. |
| `lookup_music_url` | UNION of source-key PK, canonical-URL unique index, normalized-alias PK and state+source-key identity **SEARCH**. At most three candidates; skip orphaned targets rather than hiding a live alias. |
| `get_music_entity` / batch / relationship target projection | Choose the exact kind's table, **SEARCH** by ID PK, then bounded link lookup by entity. No four-kind projection scan. |
| `search_music` | `instr(lower(name), lower(?))`: **SCAN** all four catalogue tables when no kind supplied, or only the specified kind's table. No name index supports substring search. |
| `filter_music` with name | Exact `lower(name) = lower(?)`: **SCAN** the specified kind's table, absent matching expression index. Kind-only listing remains offset-based and is not a catalogue-independent-cost promise. |

Representative actual plan lines (temporary sort/subquery scans are not base-table
index searches, and do not establish a fixed rows-examined bound):

```text
discography: SCAN music_album_artists; SCAN music_track_artists
album tracks: SCAN music_tracks; USE TEMP B-TREE FOR ORDER BY
label catalogue: SEARCH music_label_artists USING COVERING INDEX sqlite_autoindex_music_label_artists_1 (label_id=?)
                 SEARCH music_label_albums USING COVERING INDEX sqlite_autoindex_music_label_albums_1 (label_id=?)
URL lookup: SEARCH music_source_identities USING INDEX sqlite_autoindex_music_source_identities_1 (source_key=?)
            SEARCH music_source_identities USING INDEX music_source_identities_canonical_url_uq (canonical_url=?)
            SEARCH a USING INDEX sqlite_autoindex_music_source_aliases_1 (normalized_url=?)
            SEARCH i USING INDEX music_source_identities_resolving_audit_page_idx (state=? AND source_key=?)
search: SCAN music_artists; SCAN music_albums; SCAN music_tracks; SCAN music_labels
artist name filter: SCAN music_artists
```

There is no longer a global `MATERIALIZE edges` step. Source predicates apply inside
each selected base-table branch; no `NOT MATERIALIZED` hint or extra schema is used.

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
