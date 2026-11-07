# R3 public-content reads (#519)

R3 delivers seven metadata/page reads plus a bounded, explicitly unhydrated
thread projection. It does **not** deliver hydrated public thread embeds or a
browser-equivalent full thread body. The four-tool continuation
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
| `get_public_profile` | Delivered as **identity metadata**, not a full profile graph/page. `profile.kind` discriminates `user` (user account ID) from `artist` (canonical music-artist ID), even if ID strings coincide. `ProfileService.getPublicProfileMetadata` keeps existing user-first lookup and banned-user denial (no fallback on banned collision); absent users fall back to published artist-DJs using existing mix-credit predicate. That predicate allows a DJ with only draft mixes; no mix identity/count is exposed. No media/social links/graphs. |
| `get_public_collection` | Delivered as **published listening collection metadata plus bounded member page**, not playlist revisions or embeds. `publicListeningCollectionPage` filters published collection, published saves and same owner before count/paging, createdAt DESC/id DESC. Notes/status are already public with published saves under the existing API contract. Missing/private parent both `not_found`; public empty parent returns an empty page. No owner IDs/embed URLs. |
| `read_micro_thread` | **Bounded unhydrated projection implemented; full rich-embed behavior NOT delivered.** Additive anonymous `PostService.getPublicMicroThread` returns public root/focus and a descendant page with supported structured source prose. All embed references, tables and unsupported source become explicit no-link placeholders, including nested lists/quotes/cards. No raw source, primary music pair, compiled HTML, creator IDs or snapshots. Hidden/banned focus/root/ancestor gives `not_found`; hidden descendant subtrees are pruned before counts/pages. Oldest-first createdAt/id ordering. Existing unsafe compiled-thread/browser behavior is unchanged; this tool never calls it. |

## Superseding approval and remaining thread prerequisite

At 17:30 UTC on 2026-11-07, the Space relayed Guide Fari's approval:

> everything that needs my approval, you have my thumbs up; the claude threads that got stuck because of limits, you can take that wrok over as a medium sol thing instead

Source: [Space coordination thread](https://ampcode.com/threads/T-01a1b542-e726-7404-8b96-fb50470f1909),
relayed by [P1 integration](https://ampcode.com/threads/T-01a1b54f-7ac1-7503-9b0f-ffaf3fbc6c3e)
to this R3 thread. This records the supplied relay, not a separately verified
original human-message permalink. It supersedes the earlier routine design
approval wait for the surfaced shared privacy/thread/playlist recommendations.

R3 owns `content-read/` contracts, handlers and isolated tests, plus the reserved
additive anonymous PostService read interface and `public-micro-thread.ts` helper.
E1 owns shared PostService writes; PL1 owns playlist visibility/render resolution.
The thread slice starts above integrated PR #568 exact
`8dbd4f4863ddab00238f955913ca064629e7b321`, without rewriting PR #559.
It uses no playlist helper because it does not expose or hydrate **any** embed.
PL1's separately delivered public helper alone cannot sanitize raw source URLs.
Hydrated public embed expansion remains NOT delivered: that requires shared
anonymous reference validation, redaction and rendering proof, not a null resolver
or reuse of the old compiled-thread method. No human approval wait remains.

The source-prose projection preserves authored text, formatting, headings, lists,
quotes, code, links/images and thematic breaks. Literal authored prose/code is
not interpreted as a catalogue reference. Recognized embeds (including standalone
provider URLs), unsupported markup and tables are replaced explicitly. Tables are
omitted because the existing parser silently caps dimensions; this view must not
present a truncated table as complete. Parser depth/block/embed-limit diagnostics
fail `unavailable`, including warning-severity depth diagnostics.

Topology traversal caps visible nodes at 500 including root and depth at 8 edges.
An extra node/depth fails, not a partial count. One recursive SQLite statement
ties ancestry/reachable closure, count, page and selected metadata/source to the
same read snapshot. A concurrent hidden ancestor cannot authorize later private
descendant prose from a different snapshot. Separate page requests are not one
snapshot across concurrent edits.
SQL checks true BLOB source/title byte lengths before returning their text;
over 100 KiB per selected source/title or any source NUL fails `unavailable`, never
a silently truncated prefix. Combined sources cap at 256 KiB before parsing,
result JSON at 256 KiB. SQL limits bound returned rows, not total database work;
visibility/creator subqueries and sibling sorting may scan many rows.
The opt-in `parseRichContent(..., { publicSourceProse: true })` mode resolves
reference-style authored links/images and redacts unsupported inline HTML/directive
AST nodes before they can become Text. Default/browser parsing remains unchanged;
literal authored inline/block code and escaped prose are not sanitized as markup.

Future PRs are normal OPEN, not drafts; all MCP PRs stay unmerged with auto-merge
off. No production operation or policy/data activation follows from this approval.

All delivered operations require `content:read`, work for eligible active listener
accounts, recheck scope/account in each handler, and do not require `posts:read`.
Default list size 20, maximum 50, offset 0–10,000; one relationship hop except the
explicitly capped thread ancestry/descendant traversal described above.
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

### Four-tool continuation (centrally registered by P1)

P1 now composes all seven R3 reads in the production route manifest. Registration
does not enable production resource scopes. The real persisted-OAuth HTTP fixture
in `http/editorial-mcp.d1.test.ts` covers this composition; the recipe below also
documents the service dependencies. R1 and `read_micro_thread` remain unregistered.

- Import `PublicResearchToolkit`, `PublicResearchHandlersLayer` from
  `@/mcp/content-read/research-toolkit`; `PublicResearchServiceLayer` from
  `@/mcp/content-read/research-service`. Contracts live in `research-contracts.ts`.
- Compose `PublicResearchToolkit` alongside `ContentReadToolkit` and legacy.
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
  Keep production policy unchanged; add the thread module separately as below.
- `research.d1.test.ts` supplies a runnable isolated transport composition and
  adversarial fixtures, not a replacement for that persisted-OAuth combined proof.

Existing shared behavior is not strengthened by MCP: public collections do not
exclude banned owners (profile lookup does); search's `post` namespace includes
published micro replies even under a draft root, but exposes only the matching
reply's own metadata, never root/parent/body/count/relationship fields. The full
hydrated thread behavior remains undelivered. Integrators must preserve `profile.kind` so user and
artist IDs are never interpreted as one identity namespace.

### Thread projection (central registration not applied here)

- Import `PublicThreadToolkit`, `PublicThreadHandlersLayer`, and
  `PublicThreadServiceLayer` from `@/mcp/content-read/thread`. Contracts exported
  there: `PublicMicroThreadInput`, `PublicThreadPost`, `PublicMicroThreadResult`.
- Compose the toolkit; provide handlers then service layer with real `PostService`,
  `Database` (live authorization), and `EditorialMcpConfig`. PostServiceLayer must
  include the additive `getPublicMicroThread` method. No provider/render/storage
  dependency is called by this method; existing layer construction is unchanged.
- Extend the P1-owned persisted-OAuth fixture with listener `content:read`, discover
  and call `read_micro_thread` using the real layer. Assert bodyMode `unhydrated`,
  supported prose retained and embedded target IDs/URLs absent. Seed draft/banned
  root/focus/intermediate ancestor, public children below hidden ancestors, equal
  timestamps with opposite insertion order, public empty root and budget overflow.
  Include an off-page ancestor hide/ban interleaved immediately before source
  execution, early-NUL over-budget source, inline/nested unsupported attributes,
  and authored reference link/image + literal code survival.
  Assert totals/pages omit hidden subtrees, wrong scope/live ban/revoked tokens
  deny, and all calls are SELECT-only/provider-free. Keep all seven existing R3
  tools plus R1/legacy compatibility in the final exact integrated-head proof.
- `thread.d1.test.ts` is the runnable real PostService/MCP composition and migrated
  D1 fixture. It injects a principal rather than proving persisted OAuth; that
  final composed proof remains P1's responsibility. No registry/fixture edit here.

Isolated tests in `content-read.d1.test.ts` execute the real MCP 2026-07-28 protocol,
live account checks and migrated D1 application services. They inject the principal
at the protocol seam, **not** a persisted bearer-token verifier; central composition
proof is therefore still required. SQL recording proves read paths do not write;
provider recording uses the real catalogue-capable renderer so accidental rendering
would be observable. No shared fixture or central registry is edited by this lane.
