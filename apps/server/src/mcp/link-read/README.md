# R4 read-only link inspection (#520)

Parent: reviewed R1 #565, exact `e24a964df29e55d5d5e48399f441131d9bb9080b`.
This leaf adds no central registration, schema, OAuth policy or canonical writes.
Keep this PR open and unmerged; no auto-merge or production activation is authorized.

## Tool contracts

Every service call checks a live account and `catalogue:read`, not just transport annotations.
All five outputs have an object root for MCP SDK discovery.

| Tool | Input | Result/evidence |
| --- | --- | --- |
| `get_music_links` | kind/ID, optional limit and afterPlatform | Verified safe links, stable link IDs, observed dates, scanned count and next platform cursor |
| `find_platform_equivalent` | kind/ID/platform | Verified stored link of this catalogue entry, otherwise insufficient evidence |
| `check_music_link_health` | kind/ID/platform | Availability-only observation; also requires `providers:read` |
| `find_missing_platform_links` | kind/platform, optional limit and afterId | Missing-link references in one scanned ID window, not a catalogue-wide count |
| `compare_music_sources` | two HTTPS URLs | Same/different stored catalogue target or insufficient evidence, never musical equality/mismatch |

Four kinds only: artist, album, track, label. R1's D3 visibility applies, including null/future
publication timestamps. No playlists or private editorial bodies. Stored link metadata,
verification actor, identity source/lease tokens and creator IDs are never projected.
Rejected/unsafe URLs, wrong typed provider sources and platform mismatches are omitted.
Canonical-writer display aliases are retained: YouTube → YouTube Music, and generic
sources → discord/website/instagram/twitter/musicbrainz/discogs/other plus snapshot-import
labels apple_music/bandcamp/soundcloud/tidal/amazon_music. The real attachment and import
writers produce these verified rows, including safe custom-domain/short-link sources.
These are stored display mappings, not provider equivalence inference; they do not widen
health destinations. Recognized provider mismatches (such as Spotify URL labelled Deezer)
remain excluded.
Dates are observations, not write concurrency tokens. HTTP success never verifies a link.
Generic safe HTTPS links can be returned but are never fetched by this module.

## Bounded execution

Default20/max50 **examined** rows, with one sentinel. Link pages seek platform using existing
unique `(entity_type, entityId, platform)` index; missing-link pages seek kind-table PK ID
then perform at most50 exact indexed platform lookups. Empty filtered pages can still have
a cursor; advance it instead of restarting. No OFFSET, total count, unbounded `linksFor`,
provider resolution-on-miss or recursive traversal. Cursors are not snapshots: concurrent
updates can change results, so clients must not treat an exhausted page as a durable verdict.

R1 entry authorization/projection and normalized identity lookup remain bounded as documented
in `../music-read/README.md`. Result admission measures UTF-8 JSON including duplicated text
and structured content, capped at232 KiB; oversize results fail explicitly. The remaining24 KiB
is a framing reserve under the read-only16 KiB request admission, not a guarantee for larger
write-enabled echoed request IDs. A client may need a smaller page or corrected oversized data;
a single oversized stored link ID cannot be made to fit by pagination.

## Health egress: truthful unavailable boundary

`LinkHealthEgress` is a required trusted adapter, **not an implemented DNS-pinned transport**.
Compose `LinkHealthUnavailable` until the integration owner supplies and verifies one.
The unavailable adapter produces `provider_unavailable/transport_unavailable`; no network is
sent. Never substitute raw fetch, an allowlisted hostname alone, or an unbounded provider SDK.

An approved adapter must block private/special-use IPs on the actual connection, including DNS
rebinding; omit credentials; disable automatic redirects; cancel/close HEAD response bodies
without buffering; and honor AbortSignal. Policy permits only HTTPS default-port
`open.spotify.com`, `www.deezer.com`, `www.youtube.com` destinations accepted by the canonical
source parser. Each redirect is revalidated, at most3 HEAD attempts/2 redirects/4 seconds total,
zero buffered response-body bytes. This is a client-side work deadline, not evidence of remote
server cancellation or a guarantee about bytes received by a future transport internally.
Controlled-adapter tests prove policy/deadline behavior, **not safe live egress**.

## Integration recipe

Compose `LinkReadToolkit` with other toolkits using P1's duplicate-checked composition.
Provide `LinkReadHandlersLayer`, `LinkReadServiceLayer`, R1 `MusicReadServiceLayer`, Database,
configuration and explicitly selected egress layer. P1's HTTP boundary filters discovery by
`McpPermission`; the bare test MCP server exposes the supplied toolkit, while handlers enforce
scopes independently. Persisted OAuth/combined-route proof remains P1's integration obligation.

## Evidence

Real migrated disposable Miniflare D1 + HTTP tests exercise all five tools, object-root
discovery, missing provider scope through HTTP and direct service, live bans, rejected/unsafe
links, type mismatch, empty cursor pages, normalized identity comparisons, oversize UTF-8
results and snapshots of every application table before/after all reads. Unit policy tests
cover redirect SSRF destinations, HTTP uncertainty and TestClock deadline/AbortSignal.

A disposable query experiment seeded16 target platform rows and100 artist IDs, then grew both
unrelated links and artists by10000 rows. Actual `EXPLAIN QUERY PLAN` and D1 `meta.rows_read`:

| Query (limit51 unless noted) | Plan | Before → after rows_read |
| --- | --- | --- |
| target links `platform > '' order by platform` | SEARCH `music_entity_links_identity_uq` on entity_type/entityId/platform> | 16 →17 |
| target platform equality, limit1 | SEARCH same index on all three equalities | 1 →1 |
| artist `id > '' order by id` | SEARCH covering PK index | 51 →51 |

No temporary B-tree. Every measured statement wrote0 rows. The extra sentinel visit explains
the link-page difference; these are local counters, not production cost/latency guarantees.
Reproduce on a freshly replayed disposable D1 using the three predicates above: seed one row
per music_platforms ID for the target,100 artists, then10000 unrelated links/artists; inspect
plans and `.all().meta` before/after. Tests and measurements never use a remote database.
