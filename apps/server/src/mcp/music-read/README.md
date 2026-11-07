# R1 catalogue reads (#518)

Base: P1 #548, `2d1b5592826e66e3a198dc117c153e062264fc5c`, atop P0 #547.
This module does not register production tools or change OAuth resource policy.
Keep its PR unmerged for the owner's overview review. R3 is a sibling, not a parent.

## Selected capability mapping

All nine wire names are retained. Every operation requires a live recognized account
and `catalogue:read`, including service calls outside the MCP transport.

| Tool | Input | Structured success |
| --- | --- | --- |
| `search_music` | query; optional kind, limit, offset | `SearchMusicResult`: complete page or explicit exhaustion |
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
Proved empty lists succeed; exhausted search is not an empty list.
Unknown/unresolved/orphaned/gated URL identities return a
successful `not_found` result. No fetch-on-miss or implicit canonical identity write.
URL candidates are deduplicated and ordered by kind/ID, not source-key/canonical/alias
precedence; if stored identities disagree, the first existing entity in that order wins.

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
reserving 24 KiB for JSON-RPC/SSE framing and IDs within read-only request admission
(16 KiB). Grants with `drafts:write` have 256 KiB request admission: a larger echoed
ID can exceed the full-envelope ceiling and receive the transport's generic error,
not this module's smaller-page guidance. The reserve does not cover those larger IDs.
Central transport must retain its full 256 KiB envelope ceiling and lower request
limits. Real HTTP tests exercise ordinary, escaped and multibyte names on both sides
of the budget; the failure retains the smaller-page/batch guidance.

## Query admission and index scope — integration/production HOLD

Guide Fari authorized scoped query/index implementation, not integration, production
migration or policy activation. Migration `0015_music_catalogue_read_indexes.sql`
adds six relationship access paths and four exact-name expression keys; two existing
reverse-label indexes are widened, not duplicated. No tables/columns, FTS or data
policy change. SQLite maintains these indexes on existing insert/update/delete writers.

Search keeps `instr(lower(name),lower(query))>0`, including short and literal Unicode/
punctuation inputs. One selection statement admits at most **8192 candidate records**
and **262144 UTF-8 matching-input bytes**. For all kinds, each receives 2048 slots;
a single kind receives 8192. Materialized ID prefixes precede matching. Count below
quota proves EOF; equality does not. Only the contiguous global prefix through the
first unproved kind can prove a page; later-kind matches cannot bypass an earlier gap.
In particular, at **2048 or more albums**, every all-kind search is restricted to the
admitted album prefix or exhausts: it cannot return artists, labels or tracks. An
artist-only match returns complete with 2047 nonmatching albums but exhausts at 2048.
Specify `entityType` to search a later kind independently (with its own 8192-row cap).
The same prefix barrier applies to later kinds in album < artist < label < track order.
This is an explicit availability limitation, not a claim that all-kind search is
adequate for production catalogue sizes; no production-size acceptance is implied.
Running name+query bytes stop admission before the first over-budget record, without
truncation/skipping. The guarded matcher runs only on admitted rows. Temporary sorts
and materialization operate on these capped stages, not unrestricted name matches.

The object-root response is `{ endpoint, result }`; branch on `result.status`.
`result.status: complete` adds the existing entities/pagination payload. A matching sentinel
proves `hasMore: true`; full EOF with no admission gap proves final/empty output.
Otherwise `result.status: budget_exhausted` returns resolved requestedPage and fixed
guidance only: no entities, pagination, count, query echo or continuation cursor.
Exactly limit apparent matches without sentinel/EOF still exhaust. No automatic retry,
cap increase, scan fallback, provider work or hidden progress state exists. Rare/missing
queries and deep offsets can repeatedly exhaust even when matches exist.

| Operation | Source predicate and ordered access |
| --- | --- |
| Artist relationships/discography | Reverse `(artistId,albumId)` and `(artistId,trackId)` SEARCH; optional `(artist_id,label_id)` SEARCH |
| Album relationships | `(albumId,id)` track SEARCH; source-leading credit PK and `(album_id,label_id)` SEARCH |
| Album tracks | `(albumId,(trackNumber IS NULL),trackNumber,id)` SEARCH preserves null-last order |
| Label catalogue | Existing label-leading junction PK SEARCH |
| Track relationships | Existing track-credit PK and exact track PK SEARCH |
| Named filter | `(lower(name/title),id)` expression-index SEARCH, unchanged equality and ID order |
| Kind-only filter | ID PK walk stopping after offset + limit + 1 |
| Search | ID PK walks selecting capped prefixes, then bounded-stage matching/sorts; not an indexed substring lookup |
| URL/entity/link projection | Existing unique/PK point lookups and bounded stored-link projection, unchanged |

Each relationship branch selects its first `p = offset + limit + 1` rows in the real
target order before UNION ALL; at most three p-sized prefixes feed the final sort.
Constant relationship/kind keys are omitted inside each branch so index order can
stop early. Album-track and general relationship order need separate track indexes.
Application decoding receives at most 51 relationship/filter rows, 50 batch references,
three URL candidates, or the search page only; search candidates stay in SQL.

**These are admission bounds, not universal physical resource guarantees.** Selected
records are not engine rows_read: repeated CTE passes cost additional reads. The byte
cap covers admitted match input, not total bytes fetched or inspected. A stored name
larger than the cap must still be fetched/materialized before exhaustion; no writer
length restriction is added. Index seeks, deep offsets, large stored values, output
projection, physical pages, CPU and latency remain separate costs. Do not describe the
whole request as catalogue-independent. Local rows_read is post-execution evidence,
not a live cancellation mechanism. Search selection/proof has one statement snapshot;
later link queries and separate requests have no new snapshot guarantee.

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
