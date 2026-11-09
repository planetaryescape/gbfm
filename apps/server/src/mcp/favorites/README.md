# L2 favorites and subscriptions — #537 / parent #512

The reviewed read-only leaf is preserved in [PR #562](https://github.com/planetaryescape/gbfm/pull/562)
at `a6e5f4e256029bc834bc73d7323b3d4b81d03489`, based on P1 `2d1b559`.
The command continuation is `feat/537-membership-commands`, based on the named
[P1 prerequisite #575](https://github.com/planetaryescape/gbfm/pull/575), exact
`6410b0958f920edeff317c860e8b167b970b6aca`. It includes normal receipt/domain
migration replay, exports and live command authority. No sibling schema branches,
new ledger or lane-owned migrations were added. Reservation: #537 comment
6709187485. P1 owns central integration. Nothing is merged or activated.

## Authorization and delivery state

The coordinator relayed Guide Fari's superseding 17:30 approval:
“everything that needs my approval, you have my thumbs up; the claude threads
that got stuck because of limits, you can take that wrok over as a medium sol
thing instead”. Source: [coordinator thread](https://ampcode.com/threads/T-01a1b54f-7ac1-7503-9b0f-ffaf3fbc6c3e),
recorded on [#537](https://github.com/planetaryescape/gbfm/issues/537#issuecomment-6710729236).
This covers the consolidated receipt, owner revision/CAS and client cutover
recommendations. There is no repeated schema-approval checkpoint. Technical
atomicity, privacy, all-client proof and independent exact-head review still apply.

| Capability | State | Scope and effect |
| --- | --- | --- |
| `list_favorites` | Implemented; reviewed read leaf centrally composed in #568 | `favorites:read`; owner's public audio/show summaries and same-observation owner revision |
| `set_favorite` | Real atomic implementation in this continuation; **NOT delivered end to end** until central integration, exact-head review and client verification close | `favorites:write`; show targets also require `subscriptions:write`, changing both memberships together |
| `list_show_subscriptions` | Implemented; reviewed read leaf centrally composed in #568 | `subscriptions:read`; owner's public show summaries and same-observation owner revision |
| `set_show_subscription` | Real atomic implementation in this continuation; **NOT delivered end to end** under the same remaining gates | `subscriptions:write`; true additionally requires `favorites:write` and adds a favorite; false retains the favorite |

`FavoritesToolkit` now contains four real handlers, not always-failing placeholders.
Read-only grants discover only the reads. The isolated composed OAuth fixture
exercises the real setters with migrated D1, not an in-memory receipt substitute.
Production OAuth resource policy is unchanged. No micro-post likes, subscriber
export, notification sending, provider jobs or production accounts are involved.

## Reads and observed revisions

MCP lists accept `{ limit?: integer 1..50, offset?: integer 0..10000 }`, defaults
20/0. No caller-selected owner or admin bypass. Public summaries contain only
ID/title/slug and audio kind; private targets and malformed dual-target favorites
are excluded before pagination. Titles are truncated to 500 UTF-16 units without
splitting a surrogate pair. Invalid public IDs/slugs are omitted and counted in
`pagination.omitted`, never poisoning the page. IDs are bounded to 200 and slugs
to 500. No bodies, media/artwork URLs, user IDs or subscriber data are returned.

`FavoriteService.getMembershipPage(owner, kind, limit, offset)` performs one SQL
statement: bounded public rows plus owner revision. Its aggregate sentinel also
returns that revision for empty/out-of-range pages. It does not append a revision
from a later observation. The result has `{ endpoint, revision, favorites | subscriptions,
pagination: { limit, offset, hasMore, omitted } }`. Ordering is created time then
membership ID descending; one lookahead, at most 51 rows, no private totals/refill.
Advance offset by limit, not returned item count. Pagination can shift between calls.

The browser favorite array API is preserved. Each `FavoriteWithContent` now has
`membershipRevision` from the same query as its membership row. Browser artwork
cannot inherit a private parent show's thumbnail.

Session GET `/api/favorites/:targetKind/:targetId/state` returns
`{ revision, favorited, subscribed }` from one observation with private/no-store
headers. Audio uses `subscribed: null`. Absent/private targets return 404. Controls
load this state before enabling Toggle, never fetch only a fresh revision at click.

## Durable desired-state commands

Inputs require UUIDv4 `requestId`, a nonnegative safe-integer `expectedRevision`,
bounded canonical target ID and boolean `desiredState`. Favorites use
`targetKind: 'audio' | 'show'`; subscriptions use `showId`. Actor, client and
audience are trusted context, never payload fields.

All six existing service writers require `MembershipWriteContext`; no legacy
unguarded overload remains. `membership.ts` builds one shared-store atomic plan:

1. Claim the scoped receipt; lazily initialize the persistent owner revision.
2. CAS expected revision to next revision and fresh physical attempt UUID.
3. Guard every coupled mutation with receipt fence, winning owner/revision/attempt
   triple, live credential/account/scopes and live public target.
4. Assert the winner and desired coupled state before committing the receipt.
   A lost CAS causes the shared CHECK to abort the entire batch, not a partial save.

One owner-wide `listener_membership_revisions` row guards all audio favorites,
show favorites and subscriptions. It survives an empty library; only account
deletion cascades. Revision starts at 0 and cannot reset, wrap or exceed the safe
integer range. Every accepted new intent, including a no-op, increments once.
Exact replay never increments. The cross-target conflicts are deliberate: coupled
membership changes cannot evade the guard through another endpoint.

The shared store scopes keys by actor, trusted client, canonical resource,
operation and request UUID. Normalized input includes target, desired state and
expected revision. Same key/different input conflicts. Identical concurrent
retries apply once; replays return the original bounded committed projection,
including its original revision, even after later changes. Results expire after
24 hours; tombstones prevent expired keys from executing again. Current authority
and public target are rechecked before lookup and receipt disclosure.

Session-only membership routes retain session-only authentication. Shared
`makeSessionCommandAuthority` uses actor-stable `gbfm:session` and configured
`new URL('/api', ConfigService.urls.share).href`, never Host/Origin, session ID or
raw token. No PAT support is added. MCP uses verified OAuth client and configured
MCP resource. `membershipWriteContext` maps `checkpoint.liveGuard` to the domain
guard and reruns checkpoint in the receipt authorization callback. Provider work
never runs inside the batch. Responses truthfully report `notifications: 'not_sent'`.

HTTP writes return the decoded committed membership result. Conflict→409,
expired→410, denied/private→403, invalid→400 and uncertain storage failure→503.
No conflict is treated as success. Clients retain the exact UUID/input after
uncertain failures; 409/410 reload state but require explicit new user intent.
Only HTTP 401 establishes expired authentication for the controls. A target-access
403 preserves the WWW principal and reports failure; mobile reports track
unavailability, not session expiry. Neither response is mutation success.

## Exact P1 integration seam

Direct leaf exports (no shared registry/export edits in this lane):

- `favorites/toolkit`: `FavoritesToolkit`, `FavoritesToolHandlersLayer`.
- `favorites/service`: `FavoritesMcpService`, `FavoritesMcpServiceLayer`.
- `favorites/contracts`: list and set input/results.
- `favorites/command`: `membershipWriteContext`, `membershipOutcome`.
- `favorites/membership`: `MembershipWriteContext`, `MembershipAuthority`.

Compose the toolkit alongside the other reviewed toolkits. Supply
`FavoriteService`, `ShowSubscriptionService`, `McpAuthorization`,
`EditorialMcpConfig` and **the same-D1** `McpOperationStore` when constructing
`FavoritesMcpServiceLayer`. `makeMcpRoutes` supplies its validated endpoint config
and request-scoped `CommandAuthority`; it is resolved only inside a command call,
not captured at layer construction. Missing request authority fails closed.
Provide `McpOperationStoreLayer(env.DB)` at the central HTTP/AppLayer/test fixture
seam too; do not reach into Drizzle internals or construct a second database.

The six service/API writers are:

| Service methods | HTTP handler and contract |
| --- | --- |
| `addFavorite`, `addShowFavorite` | `http/favorites.handlers.ts`; `packages/api/src/favorites.ts`; POST `/api/favorites` |
| `removeFavorite` | same; DELETE `/api/favorites/:audioId` |
| `removeShowFavorite` | same; DELETE `/api/favorites/show/:showId` |
| `subscribe`, `unsubscribe` | `http/shows.handlers.ts`; `packages/api/src/shows.ts`; POST `/api/shows/:id/subscribe`, DELETE `/api/shows/:id/unsubscribe` |

P1-only root/dashboard integration (do not weaken required fields):

- `PublicActions.load(model)` returns `{ model, commands }`; use its model and
  enqueue its `PublicActions.Load` command after page hydration/account changes.
  `Loaded` carries target, owner, request generation, active state and revision.
  `Saved` requires `revision`; propagate that exact committed revision.
- `PlayerFavorite.reconcile(model, audioId, active, revision)` requires the fourth
  argument. `Loaded.revision` is nullable; `Saved.revision` is required.
  `SaveFailed` requires `conflicted` and `mutationId`.
- Dashboard favorite rows carry same-observation `membershipRevision`; removal
  must send that observed revision plus one UUIDv4 retained for uncertain retry.
  Never fetch revision only at click, auto-retry 409, or make fields optional.

WWW public controls/player and mobile favorite API/status hook own observed
revision and retry identity plumbing. Shared root/dashboard assemblers and their
fixtures are P1-only. `show.service.ts` is untouched.

## Verification and remaining gates

Kept migrated-D1 tests exercise owner/private exclusion, bounded pages including
empty revision sentinels, oversize summary regression, all six service writers,
coupled desired states, no-op revisions, empty-library ABA, competing cross-target
intents, identical concurrent retries, stale/changed-key conflicts, expiration,
revoked credentials and truthful zero sends. `http.d1.test.ts` exercises actual
session HTTP state/writes, all six branches, renewal-stable replay, owner isolation
and privacy. `favorites.d1.test.ts` exercises persisted OAuth→MCP→services→D1.
The original gap reproduction showed add→remove→retry re-added state; that
historical behavior is not a test expectation or a delivered replay guarantee.

Final exact-head precommit, composed central runtime/client integration and the
independent Sol PR review remain delivery requirements. Mobile API/state checks
are not physical-device proof: no connected runner was available; latest verified
build/install on the user's physical iPhone remains unverified. Component browser
captures are not a claim of integrated-app/backend verification. MCP stays
unmerged, auto-merge off, and production activation remains prohibited.
