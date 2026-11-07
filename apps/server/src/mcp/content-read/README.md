# R3 first public-content slice (#519)

This is a partial delivery, not completion of R3. It depends on P1 PR #548 at
`2d1b5592826e66e3a198dc117c153e062264fc5c`, not `origin/prod` or sibling R1.
P0 → P1 → this PR is the prerequisite order. Leave every MCP PR unmerged for
Guide Fari's overview. No production scope activation is included.

## Selected capability mapping

| Capability | Delivery / contract |
| --- | --- |
| `list_published_posts` | Delivered as editorial **summary metadata**, not source or micro posts. Optional limit/offset; existing anonymous `getEditorialSummaries` seam. Stable post IDs, observed updatedAt and public review URLs. Blank title/body source rows may yield a short/empty page: advance by pagination.limit, not returned length. Total describes the public source window before blank-row omission, never drafts. |
| `get_show` | Delivered as small public show metadata by slug. Stable show ID, observed updatedAt and public review URL. Additive `ShowService.getPublicSummaryBySlug`; no rendering, source body, media URLs or host expansion. Missing/draft both `not_found`. |
| `list_show_episodes` | Delivered as public **audio** episode metadata by show slug plus limit/offset. Existing `getEpisodes` called without actor/loaded show. Public parent and public children required before counts/pagination. Missing/draft parent both `not_found`; existing empty public show returns an empty page. Audio track IDs are not canonical music track IDs. Misc audio reviews on its show page. No media URLs, body or creators. |
| `search_catalogue` | **NOT delivered.** Shared SearchService needs a bounded paging contract and public-parent-safe audio/show joins. Do not filter/truncate after materializing results or invent MCP-only visibility. |
| `get_mix` | **NOT delivered.** Existing audio detail renders content and inherits show fields without proving public show visibility. Needs an approved non-rendering shared public seam and parent-safe projection. |
| `get_public_profile` | **NOT delivered.** Existing profile service materializes unbounded content and can inherit draft show thumbnails. Needs a reserved bounded public service projection. |
| `get_public_collection` | **NOT delivered.** Existing public listening collection read materializes unbounded members. Needs a reserved paged shared projection, preserving collection/member publication and same-owner predicates; do not confuse listening collections with canonical playlists. |
| `read_micro_thread` | **NOT delivered.** Compiled thread reads render source and can resolve playlist embeds. Needs an approved bounded non-rendering thread contract preserving focus/root/parent visibility. PL1 #533 shared playlist privacy reconciliation is unapproved, not bypassed here. |

All delivered operations require `content:read`, work for eligible active listener
accounts, recheck scope/account in each handler, and do not require `posts:read`.
Default list size 20, maximum 50, offset 0–10,000; one relationship hop at most.
Results above 256 KiB encoded JSON fail `unavailable`, never silently truncate.
The central transport also enforces its response ceiling and lower request limits.
Reads are safe to retry but pagination is not a snapshot across concurrent edits.
No writes, playback, seen markers, subscriptions, notifications, provider requests,
schema changes or production policy changes are introduced.

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

Isolated tests in `content-read.d1.test.ts` execute the real MCP 2026-07-28 protocol,
live account checks and migrated D1 application services. They inject the principal
at the protocol seam, **not** a persisted bearer-token verifier; central composition
proof is therefore still required. SQL recording proves read paths do not write;
provider recording uses the real catalogue-capable renderer so accidental rendering
would be observable. No shared fixture or central registry is edited by this lane.
