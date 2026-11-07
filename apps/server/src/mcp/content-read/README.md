# R3 public-content reads (#519)

This is a partial delivery, not completion of R3. The four-tool continuation
depends on central PR #552 at `2fa6712689521ab8d48085873c845b63ea4c2ffa`,
which incorporates the original three-tool PR #550 and P1 #548, not `origin/prod`
or sibling R1. P0 → P1 → R3 first slice → central #552 → continuation is the order.
Leave every MCP PR unmerged for
Guide Fari's overview. No production scope activation is included.

## Selected capability mapping

| Capability | Delivery / contract |
| --- | --- |
| `list_published_posts` | Delivered as editorial **summary metadata**, not source or micro posts. Optional limit/offset; existing anonymous `getEditorialSummaries` seam. Stable post IDs, observed updatedAt and public review URLs. Blank title/body source rows may yield a short/empty page: advance by pagination.limit, not returned length. Total describes the public source window before blank-row omission, never drafts. |
| `get_show` | Delivered as small public show metadata by slug. Stable show ID, observed updatedAt and public review URL. Additive `ShowService.getPublicSummaryBySlug`; no rendering, source body, media URLs or host expansion. Missing/draft both `not_found`. |
| `list_show_episodes` | Delivered as public **audio** episode metadata by show slug plus limit/offset. Existing `getEpisodes` called without actor/loaded show. Public parent and public children required before counts/pagination. Missing/draft parent both `not_found`; existing empty public show returns an empty page. Audio track IDs are not canonical music track IDs. Misc audio reviews on its show page. No media URLs, body or creators. |
| `search_catalogue` | Delivered as **metadata search** in one explicit `audio` / `show` / `post` namespace per page. Anonymous draft=false source predicate; no related-show fields/media. Optional limit/offset; createdAt DESC/id DESC (not relevance ranking). Audio track IDs are not canonical music-track IDs. Shared `SearchService.searchPublicPage`. |
| `get_mix` | Delivered as **published GBFM audio mix metadata** by slug via `AudioService.getPublicMixSummaryBySlug`. Missing/draft/non-mix all `not_found`. Preserves anonymous audio publication predicate independently of show publication; no show fields/links, body or media expansion. Not a playback/detail page. |
| `get_public_profile` | Delivered as **identity metadata**, not a full profile graph/page. `ProfileService.getPublicProfileMetadata` keeps existing user-first lookup and banned-user denial (no fallback on banned collision); absent users fall back to published artist-DJs using existing mix-credit predicate. That predicate allows a DJ with only draft mixes; no mix identity/count is exposed. No media/social links/graphs. |
| `get_public_collection` | Delivered as **published listening collection metadata plus bounded member page**, not playlist revisions or embeds. `publicListeningCollectionPage` filters published collection, published saves and same owner before count/paging, createdAt DESC/id DESC. Notes/status are already public with published saves under the existing API contract. Missing/private parent both `not_found`; public empty parent returns an empty page. No owner IDs/embed URLs. |
| `read_micro_thread` | **NOT delivered.** Shared `getMicroPostThreadEffect` does not filter draft roots/descendants/counts. A migrated-D1 probe confirmed public focus returned a private root and private descendant. Compiled thread bodies can also resolve PL1 playlists. Needs approved shared thread visibility/pagination and PL1 #533 reconciliation; no MCP-only filter bypass or silent summary replacement. PostService remains unchanged. |

All delivered operations require `content:read`, work for eligible active listener
accounts, recheck scope/account in each handler, and do not require `posts:read`.
Default list size 20, maximum 50, offset 0–10,000; one relationship hop at most.
Results above 256 KiB encoded JSON fail `unavailable`, never silently truncate.
The central transport also enforces its response ceiling and lower request limits.
Reads are safe to retry but pagination is not a snapshot across concurrent edits.
No writes, playback, seen markers, subscriptions, notifications, provider requests,
schema changes or production policy changes are introduced.

## Search work limits

Search reuses the existing matching behavior: fewer than three characters uses
case-insensitive LIKE across title, description, body and labels; longer queries
use a quoted FTS phrase. Results never return matched body text. SQL LIMIT bounds
materialized output rows, **not database work**. Exact totals require a separate
count; matching, label subqueries and createdAt/id sorting may inspect many rows.
Deep offsets also do work proportional to skipped matches. This slice introduces
no relevance ranking, index/schema change or false bounded-work guarantee.

A disposable migrated-Miniflare D1 probe captured and executed the actual shared
service SQL with 1,000 matching audio rows and limit=1. LIKE's count used `SCAN audio`;
the page also used `USE TEMP B-TREE FOR ORDER BY`. FTS used its virtual index plus
rowid lookups, but its page still used a temp sort. Local D1 reported rows_read
1,000/2,000 for LIKE count/page and 3,000/4,000 for FTS count/page, with zero writes
and a single output row each. These are local runtime counters, not production
cost estimates; they demonstrate why a one-row page is not a bounded-work promise.

## P1 integration recipe (not applied to reserved files)

- Import `ContentReadToolkit` and `ContentReadHandlersLayer` from
  `@/mcp/content-read/toolkit`; `ContentReadServiceLayer` from
  `@/mcp/content-read/service`.
- Include `ContentReadToolkit` in the central `composeMcpToolkits` call alongside
  legacy editorial and R1. Every tool declares `McpPermission` with exactly
  `['content:read']`; each handler additionally calls `requireScopes`.
- Provide `ContentReadHandlersLayer`, then `ContentReadServiceLayer`. Requirements:
  real `PostService`, `ShowService`, `Database`, and existing `EditorialMcpConfig`.
  ShowServiceLayer must include this PR's additive non-rendering summary method.
  No new auth/scope/config/schema contract is needed.
- Extend the P1-owned persisted OAuth fixture using the real module, not a stand-in
  tool. Create a listener-only `content:read` grant in disposable D1 test policy;
  discover exactly these three R3 tools and call each. `catalogue:read` and legacy
  `posts:read` alone cannot discover/call them. Check ban/revocation and protocol
  denial, public parent/private child paging, and legacy + R1 independence.
- Keep production allowedScopes unchanged. P1 owns the registry/shared fixture
  edits and final persisted-OAuth + R1 + R3 + legacy integrated-head proof.

### Four-tool continuation (separate proposed registration, not applied here)

- Import `PublicResearchToolkit`, `PublicResearchHandlersLayer` from
  `@/mcp/content-read/research-toolkit`; `PublicResearchServiceLayer` from
  `@/mcp/content-read/research-service`. Contracts live in `research-contracts.ts`.
- Compose `PublicResearchToolkit` alongside `ContentReadToolkit`, R1 and legacy.
  Provide its handlers then service layer, with real `SearchService`, `AudioService`,
  `ProfileService`, `Database`, `EditorialMcpConfig`. Use their updated production
  layers (AudioServiceLayer still needs its normal renderer/storage/config/crypto
  construction dependencies, but metadata reads never invoke them).
- In the P1 persisted-OAuth fixture grant only `content:read` to an active listener;
  discover all seven R3 tools, call all four new tools using real service layers.
  Seed public audio attached to a draft show and assert no show fields leak;
  private collection/member and cross-owner member fixtures must be excluded from
  count and pages. Include banned profile/user-first artist collision and absent
  user → published artist-DJ fallback. Verify wrong-scope grants, live ban and
  revocation denial, no provider calls/writes, and independent legacy/R1 discovery.
  Keep `read_micro_thread` absent, production policy unchanged.
- `research.d1.test.ts` supplies a runnable isolated transport composition and
  adversarial fixtures, not a replacement for that persisted-OAuth combined proof.

Isolated tests in `content-read.d1.test.ts` execute the real MCP 2026-07-28 protocol,
live account checks and migrated D1 application services. They inject the principal
at the protocol seam, **not** a persisted bearer-token verifier; central composition
proof is therefore still required. SQL recording proves read paths do not write;
provider recording uses the real catalogue-capable renderer so accidental rendering
would be observable. No shared fixture or central registry is edited by this lane.
