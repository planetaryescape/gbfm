# A1: bounded admin publishing overview

Issue #543, parent #512. Prerequisite: P1 #514 / PR #548 at
`2d1b5592826e66e3a198dc117c153e062264fc5c`. This lane owns only this directory.
P1 owns central registration, auth, scopes, consent and shared fixtures.

## Projection decision

P0 D6 permits aggregate counts, not the browser dashboard DTO. The existing
`http/admin.handlers.ts` overview is a private handler with personal rows and no
separately exported aggregate service. Calling it and deleting fields afterwards
would unnecessarily load sensitive records. This module instead queries only the
existing publishing tables with the same `draft = false` / `draft = true`
semantics. It does not change browser services or shared schemas.

`get_admin_overview({})` returns endpoint identity, UTC `generatedAt`,
`status: complete` and exactly seven fixed categories: mixes, tracks, miscellaneous
audio, shows, posts, micros and releases. Each has `published` and `drafts` counts.
“Published” here means the existing content draft flag, not a new catalogue
visibility rule. Labels are deliberately omitted because their publication
semantics differ. This is a small publishing summary, not a complete operational
health report. Account, session, newsletter, engagement, delivery and reminder
statistics are omitted, including their aggregate dimensions. There are no
recent rows, rankings, IDs, titles, bodies, emails, URLs from content, provider
payloads, failure details or arbitrary grouping/filtering.

Defaults and bounds:

- No arguments, pagination, date ranges or client-selected dimensions. Extra
  arguments are rejected by the installed Effect `Tool.EmptyParams` contract.
- Seven sequential storage aggregate queries, each returning one row with two
  nonnegative safe-integer counts. No per-record readback, joins, dynamic groups,
  provider work or mutation. Database scan cost still scales with table size;
  fixed query/result bounds are not a constant-time claim.
- Empty categories are successful zero counts. A failed query or invalid stored
  aggregate fails the entire call as safe `unavailable`; no partial success,
  fabricated zero on failure, raw SQL/provider error or automatic retries.
- Counts are observations across queries, not a transactionally consistent
  snapshot. `generatedAt` is the completion observation time, not a revision.
- Fixed output structure: 14 counts, endpoint identity and completion metadata.
  Integration tests assert the raw exact projection and both text/structured
  response remain under 4 KiB for the disposable endpoint as row counts grow;
  P1 retains the global 256 KiB encoded response ceiling.
- Explicit `admin:read` AND live admin account required on every service call.
  The HTTP boundary separately verifies persisted grant/resource/client state.
  Scope consent never activates a production resource policy automatically.

## P1 integration recipe

Exports from `@/mcp/admin-read`:

- `AdminReadToolkit`: `get_admin_overview` descriptor, `McpPermission` annotation,
  strict empty input, `AdminOverviewResult`, `McpToolError`, read-only and
  non-destructive, idempotent, closed-world annotations.
- `AdminReadToolHandlersLayer`: requires `AdminReadService`.
- `AdminReadServiceLayer`: requires `Database` and `EditorialMcpConfig`; provides
  its own `McpAuthorizationLive` dependency.
- `AdminReadService`: `getAdminOverview()` for the authorized service seam.

Compose `AdminReadToolkit` with existing toolkits using `composeMcpToolkits`,
then supply `AdminReadToolHandlersLayer` backed by `AdminReadServiceLayer` to
`makeMcpRoutes`. Supply the same parsed `EditorialMcpConfig` endpoint identity as
the route's existing editorial services. At the pinned P1 base the route's
internal endpoint layer does not flow outward to independently supplied handlers,
so provide that endpoint layer to the admin service explicitly. The colocated
protocol test demonstrates this complete composition with the four editorial
tools and real OAuth, with no shared fixture edits.

P1 should integrate centrally after this lane is reviewed; do not copy its
test-only `oauthResource.allowedScopes` update into production. Production
allowedScopes and the existing four-tool registry are unchanged by this PR.
Runtime registration and any future production activation remain separate P1 /
owner actions. No schema/migration, merge or deployment authority is implied.

## Verification

From `apps/server`:

```sh
bunx vitest run --config vitest.d1.config.ts src/mcp/admin-read/admin-read.d1.test.ts
```

The tests use disposable Miniflare D1 with all repository migrations, the actual
OAuth authorize/consent/PKCE/token path, persisted verifier and request-scoped MCP
2026-07-28 HTTP transport. They cover scoped discovery, cached-call denial,
scope/role service defenses, role demotion and ban at the HTTP boundary,
connection revocation, exact raw redaction, asymmetric category/state counts,
empty categories, growing row counts, unknown arguments and scrubbed failure
after dropping a table in the disposable database. No production data is used.
