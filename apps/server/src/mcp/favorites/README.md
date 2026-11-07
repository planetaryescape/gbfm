# L2 favorites and subscriptions — partial #537

Base: P1 #548, `feat/514-mcp-foundation` at
`2d1b5592826e66e3a198dc117c153e062264fc5c`. Merge order: P0 → P1 → L2.
Reservation: issue #537 comment 6709187485. Integration owner: P1.
This module is not registered in production and #537 is not complete.

## All four selected capabilities

| Capability | State | Scope | Contract / effects |
| --- | --- | --- | --- |
| `list_favorites` | Implemented, tested, awaiting P1 integration | `favorites:read` | Actor-owned public mix/track/misc audio and show favorites; no private reference visibility |
| `set_favorite` | **NOT delivered; gated** | `favorites:write`; show coupling additionally needs `subscriptions:write` | Must use desired state, durable receipt and shared revision; show favorites currently change subscriptions |
| `list_show_subscriptions` | Implemented, tested, awaiting P1 integration | `subscriptions:read` | Actor-owned subscriptions to public shows; no subscriber identities |
| `set_show_subscription` | **NOT delivered; gated** | `subscriptions:write`; any favorite coupling additionally needs `favorites:write` | Must use desired state, durable receipt and shared revision; no delivery claim |

Only the two real read operations are in `FavoritesToolkit`. Neither setter has
a placeholder handler. Guessed set names receive the native unknown-tool error.
No micro-post likes, notification sending, subscriber export or provider access.

## Read contract

Both accept `{ limit?: integer 1..50, offset?: integer 0..10000 }`, defaulting to
20/0. No caller-selectable owner; the live authorized principal supplies it.
Services check scope and current account on every call; persisted OAuth liveness,
revocation, client/resource policy and discovery admission remain P1's boundary.
Admins have no cross-owner bypass. No target identifiers are accepted as filters.

Results contain endpoint identity, target ID/title/slug (plus audio kind for
favorites), and `{ limit, offset, hasMore }`. They exclude raw content, artwork,
media URLs, membership IDs, user IDs and subscriber data. IDs are bounded to 200
characters, titles to 500, slugs to 500; invalid persisted output fails safely as
`unavailable`, rather than returning an unbounded value. P1 enforces the encoded
256 KiB response ceiling as well. No fabricated revision or receipt is returned.
These are current-state projections, not mutation preconditions or snapshots.
Canonical target IDs/slugs are supplied without inventing web routes for legacy
track/misc audio; endpoint frontend URL is the review starting point.

Queries filter drafts before pagination, fetch at most 51 membership rows, and
sort created time descending with membership ID descending as a deterministic
tie-breaker. `hasMore` uses one lookahead, not hidden-reference totals. Offset
pagination can shift between calls when the library changes; no snapshot promise.
Existing subscription service still counts matching memberships and loads show
labels/content internally; MCP projects only summaries and starts no extra work.
Malformed favorites referencing both audio and show are omitted. Public audio
cannot inherit artwork from a private parent show, including for browser callers.

## Exact P1 integration recipe (not applied here)

Exports from this lane (direct leaf imports, no shared export edits):

- `./favorites/toolkit`: `FavoritesToolkit`, `FavoritesToolHandlersLayer`
- `./favorites/service`: `FavoritesMcpService`, `FavoritesMcpServiceLayer`
- `./favorites/contracts`: `ListOwnedInput`, `ListFavoritesResult`,
  `ListShowSubscriptionsResult`

Compose alongside the existing editorial toolkit, not in place of it:

```ts
const toolkit = composeMcpToolkits(EditorialToolkit, FavoritesToolkit)
const reads = FavoritesMcpServiceLayer.pipe(
  Layer.provide(FavoriteServiceLayer),
  Layer.provide(ShowSubscriptionServiceLayer),
  Layer.provide(McpAuthorizationLive),
  Layer.provide(endpointConfig),
  Layer.provide(databaseLayer),
)
const handlers = FavoritesToolHandlersLayer.pipe(Layer.provide(reads))
// Provide handlers alongside the existing handlers to makeMcpRoutes(toolkit).
```

`endpointConfig` must supply `EditorialMcpConfig` with the same endpoint identity
as the route; `databaseLayer` supplies `Database`. Route-private configuration
does not automatically flow into a separately constructed handler layer. Existing
application service layers may be reused rather than constructed twice. The
isolated test `setup` shows the full working composition through `makeMcpRoutes`,
persisted OAuth, existing draft handlers and migrated D1 without central edits.

P1 owns registry composition and permitted OAuth/consent scope exposure. No new
scope literals or central exports are required; the pinned P1 already defines all
four read/write scope names. Do not enable writes or broaden production resource
policy as part of read integration. Production policy activation remains a gate.

## Observed write gap and actual notification effects

A disposable migrated-D1 validation at the pinned base plus this lane's read
changes exercised the existing services (no mocks or external providers):

1. `addShowFavorite(owner, public)` inserted a favorite and subscription.
2. `removeShowFavorite(owner, public)` removed both.
3. Retrying the original add inserted both again. It did **not** replay the first
   result after the intervening removal: a lost-response retry would undo the
   newer intent. No request ID or expected revision is accepted by these methods.
4. `unsubscribe` removed the subscription but retained the favorite.
5. Concurrent `subscribe` and `removeShowFavorite` both completed successfully:
   there was no stale-state conflict. Final ordering is not a contract.
6. Recording transport observed zero email sends. Source inspection found no
   sender call in either service and no production caller of `getSubscribers`.

The focused validation passed (3/3 tests, 6.85 seconds including reads). The
temporary gap assertions were removed rather than permanently requiring a known
defect to remain. Kept tests cover delivered reads; existing favorite service D1
tests cover duplicate concurrent inserts. Unique membership constraints prevent
duplicate rows, but do not prove receipts, changed-payload conflicts, expired-key
denial or concurrent opposing-intent safety.

The kept private-parent regression was also run with only its visibility guard
removed: it failed with `expected 'https://private.example/secret' to be null`.
Restoring the guard makes the same composed-service scenario pass. This verifies
that the regression distinguishes the private-reference leak, not just execution.

Existing show favorite add/remove auto-subscribe/unsubscribe; subscribe attempts
to add a favorite but swallows that secondary failure; unsubscribe leaves the
favorite. These are non-atomic multi-statement effects. Future subscription
consent must explain notification eligibility; no code here schedules, queues or
sends email, and no subscription result may claim otherwise.

## Consolidated persistence decision requested from P1

No ledger, schema, migration or migration reservation is introduced here.
P1 must coordinate one cross-lane decision before the setters can be delivered:

- Durable unique key: actor user ID + OAuth client ID + operation
  (`set_favorite` / `set_show_subscription`) + UUIDv4 request ID. Different
  owners/clients/operations must not consume each other's keys or results.
- Canonical payload fingerprint: target kind and canonical ID, desired boolean,
  expected revision and explicit null/omission semantics. Same key/different
  payload conflicts; identical concurrent requests apply once and replay the
  bounded saved original outcome, not a new read presented as the old outcome.
- Receipt fields: key dimensions, input hash, applied revision, bounded outcome,
  target/access evidence, committed time and expiry. Keep key/fingerprint expiry
  evidence after 24-hour result retention so an expired key can never apply again.
  Retention duration/storage is a schema-owner decision, not permission to prune.
- One shared revision/transition guard for the relevant owner's membership state,
  including coupled favorite/subscription rows. Every browser/API/PAT/MCP writer
  participates. Opposing stale intents conflict rather than overwrite. Absence
  must also have a version; row deletion cannot erase the guard.
- One owning-service D1 transaction/batch: compare revision + verify target
  visibility + change desired membership/coupled rows + persist receipt atomically.
  A pre-read and later batch is not a CAS. No provider calls in the transaction.
- Fresh persisted grant/account/role and matching receipt ownership before replay;
  current public-target visibility still checked. No receipt authorizes private
  reference access. Revoked/disabled/banned/deleted actors cannot replay results.
- Resolve show coupling and permission policy explicitly. Preserve browser behavior
  through its service seam; do not silently claim atomicity or remove side effects.

Affected ownership paths for that decision: `db/favorites.schema.ts`,
`db/show.schema.ts`, the two existing application services, their HTTP write
callers (`http/favorites.handlers.ts`, `http/shows.handlers.ts`), one coordinated
`drizzle-d1/NNNN_*.sql`, `test/migrate-d1.ts`, `db/exports.ts` as needed. Existing
`editorial_operations` has post-specific storage and cannot be repurposed by this
lane. Schema approval, migration coordination and final composed-head verification
remain genuine gates, not reasons to implement weaker setters.

### Concrete revision candidate for the approval package

Recommend one **owner-wide** revision for all audio favorites, show favorites and
show subscriptions. This deliberately causes conflicts between unrelated targets;
it is simpler and safer than separate counters that miss the existing coupling.
Candidate only, not a migration or approved schema:

```sql
CREATE TABLE listener_membership_revisions (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  last_transition_id TEXT DEFAULT NULL,
  CHECK (
    (revision = 0 AND last_transition_id IS NULL) OR
    (revision > 0 AND last_transition_id IS NOT NULL AND length(last_transition_id) = 36)
  )
);
```

The target schema export would be `listenerMembershipRevisions` with camelCase
field names. No target FK: removing the last membership must not delete/reset the
revision. Never prune this row with receipts; only account deletion cascades.
Account IDs must not be reused as the same principal after deletion. A missing
row represents revision 0; initialize lazily with `INSERT ... ON CONFLICT DO
NOTHING` in the transaction. Existing memberships can start at revision 0 without
rewriting them. Increment for each accepted *new intent*, even a desired-state
no-op; exact receipt replay does not increment. Reject exhausted revisions rather
than wrap. Thus add → remove → add cannot recreate an old observed version (ABA).

`last_transition_id` is a fresh UUIDv4 per physical attempt, distinct from the
client request ID. CAS updates it and increments revision only for the expected
owner revision and currently visible target. All remaining statements changing
memberships/coupled rows and finalizing the shared receipt must be conditional on
that winning `(user_id, expectedRevision + 1, last_transition_id)` triple. A D1
batch is transactional, but a zero-row UPDATE is **not** an exception: unconditional
later statements would wrongly mutate after a lost CAS. P1's shared receipt store
must adjudicate key ownership, hash and expiry and correlate the winning attempt
in the same batch. The exact shared-store SQL depends on its approved schema;
this proposal does not claim that a version counter alone supplies replay safety.

All six existing service entry points must use this guard, not just MCP. Their
actual callers/contracts at the pinned base are:

| Handler | API contract and endpoint |
| --- | --- |
| `http/favorites.handlers.ts` `addFavorite` (audio/show branches) | `packages/api/src/favorites.ts`: POST `/api/favorites` |
| Same file `removeFavorite` | DELETE `/api/favorites/:audioId` |
| Same file `removeShowFavorite` | DELETE `/api/favorites/show/:showId` |
| `http/shows.handlers.ts` `subscribeToShow` | `packages/api/src/shows.ts`: POST `/api/shows/:id/subscribe` |
| Same file `unsubscribeFromShow` | DELETE `/api/shows/:id/unsubscribe` |

These endpoints currently carry no expected revision. Their read/status results
must supply it, and browser/PAT/API callers must pass it to the shared service
transition. Do not silently fetch a new revision and retry a stale intent. Current
web writers are `apps/www/src/public-actions/index.ts`, `player/favorite.ts`, and
`page/dashboard/update.ts`; mobile writes in `apps/mobile/src/api/favorites.ts`.
Preserving visible browser behavior while changing its concurrency contract is a
cross-client gate outside this read-only slice. No mobile changes are made here.
