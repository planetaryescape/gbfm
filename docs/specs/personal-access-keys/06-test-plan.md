# Test plan: prove authorization through real seams

Status: future verification plan, **not executed feature tests**. The current deliverable is documentation. Use the repository's Vitest 5.0.5 setup, migrated Miniflare D1, `createTestWebHandler`, and supplied Effect Layers. Do not substitute a map for D1, patch modules, or spy on private methods. These slices follow the `tdd` workflow: one failing observable behavior, minimal implementation, then refactor while green.

References: [HTTP test helper](../../../apps/server/src/test/http-handler.ts), [migration replay](../../../apps/server/src/test/migrate-d1.ts), [auth integration tests](../../../apps/server/src/lib/auth.d1.test.ts), [post resolution tests](../../../apps/server/src/http/post-music-resolution.d1.test.ts), [Drizzle rules](../../agents/drizzle-queries.md).

## Slice 1: a real session issues one recoverable metadata record, not a recoverable secret

- **Red:** Sign in a disposable local editor through real Better Auth HTTP, use its bearer session to issue a key, then list metadata. Assert 201, expected owner/scopes/environment/expiry, one-time secret shape, and no secret/hash in list. Inspect local persisted storage only to prove hash-only storage, not to bypass the HTTP flow.
- **Green:** Wire management group, current/recent session policy, key service, existing crypto provider, approved schema/replay, and atomic issue/list. Scope validation fails before insertion.
- **Refactor:** Centralize metadata projection and secret unwrap; keep protocol and persistence DTOs distinct.
- **Additional red/green cases:** stale session, renewed old session, impersonated session, banned/deleted owner, unknown fields/scopes, duplicates, scope dependencies, creator requesting publish, invalid expiry, malformed names, request ID replay, lost response, concurrent same ID, simultaneous 10th/11th active key, expired/revoked keys not consuming active limit. Strictly prove there is one row and no second secret on replay.

## Slice 2: the credential never turns into a session

- **Red:** A valid key reads only its owned edit data; the same key cannot access `/api/internal/whoami`, `/auth/get-session`, key management, or optional navigation. Assert no session row, no navigation identity cookie, and no hidden side effects.
- **Green:** Add explicit outer gate and actor middleware; keep existing session-only middleware intact.
- **Refactor:** Share credential parsing and exact route identity policy without a permissive global AuthSession adapter.
- **Additional cases:** invalid/revoked/expired tokens, exact expiry millisecond, malformed reserved prefix/version/base64url/length, huge headers, duplicate headers, comma-joined values, valid cookie plus invalid key, valid cookie plus valid key, non-auth cookies, x-api-key/body/query token attempts, unknown routes, alternate methods, trailing/double slashes, encoded separators/dot paths, route mismatch. Header rejection behavior must not depend on middleware execution order.
- Exercise a separately constructed handler per request to prove correctness without isolate cache. Clone a prod-shaped key row into a dev test DB and prove rejection. Unknown stages fail closed. Capture a key actor through an intentional test endpoint/layer only in tests and assert it has no session ID.

## Slice 3: publishing cannot hide behind create/update defaults

- **Red:** Creator + create scope + omitted `draft` gets 403 with no post, tag, provider, or storage side effect. Creator + `draft: true` succeeds. Editor/admin + create but no publish also cannot create public content.
- **Green:** Derive effective publication state before calling existing mutation effects; apply role/scope and self-attribution rules.
- **Refactor:** Keep the decision table pure and pass full actor into the owning write service.
- **Additional cases:** every publication row in the [matrix](authorization-matrix.md), publish-only key, unrelated scopes, same payload with session vs PAT, missing slug, repeated stable slug, supplied foreign/self/multiple/empty creators, update creator reassignment, type mutation, admin key touching another user's post, ordinary user after demotion, unsupported role string. Verify content and creator relation through HTTP reads; assert failures leave DB/object-store state unchanged.
- Seed at least two owners for list tests; prove the other owner is absent from both results and totals. Repeat with an admin-owned key. A test that only finds the expected own row is insufficient.
- Simulate a concurrent publish or creator removal between load and write through a real scheduling seam/barrier. The update must conflict/deny rather than write under stale permission. Do not mock SQL or snapshot generated SQL strings.

## Slice 4: revoke and limit are authoritative under concurrent requests

- **Red:** After owned revoke returns 204, a new handler request rejects the secret; repeated revoke retains its original timestamp. Another owner gets 404. Concurrent requests cannot admit more than 60 per fixed minute.
- **Green:** Primary read/current-owner join, guarded slot claim, atomic revoke, immutable metadata.
- **Refactor:** Consolidate D1 result classification into the repository; do not retry unauthorized requests as transient failures.
- **Additional cases:** window reset, window boundary burst semantics, malformed future window, concurrent first use, last-slot race, expired/revoked record between lookup and claim, DB failure, corrupted scopes/hash/state, owner deletion cascade, indefinite/timed bans, demotion/promotion with unchanged grants. Last-used means authenticated admission even if later denied. Recheck does not consume a second slot.
- Control time through Effect Clock/test layers. Use actual Worker's Web Crypto/Miniflare execution for token formatting/hash interoperability, not only a Node assertion. Test storage failures through a repository capability supplied by the production seam, preserving a separate real-D1 suite for SQL correctness.

## Slice 5: music and images do not create an authorization side door

- **Red:** Resolve on an owned draft requires both resolve/update scopes; resolve on public content also requires publish. Denied requests do not call the supplied recording provider or mutate catalog/post state.
- **Green:** Extend the post-scoped service with credential-aware policy and post-provider recheck. Keep broad music endpoints excluded.
- **Refactor:** Reuse canonical identity/provider adapters and existing attachment concurrency rules.
- **Additional cases:** revoke, ban, demote, publish, or remove ownership while a recording provider is paused; the attachment must not commit. Provider error and concurrent attachment update preserve existing mapped errors. Useful catalog enrichment may persist and must be documented, not mistaken for transactional rollback.
- For images, HTTP presign returns only an owner-scoped private key and no-store headers. Actual local R2/S3-compatible presigned PUT verification must prove allowed MIME/size constraints and expiry. If the emulator cannot represent signed PUT enforcement, report that claim as unproven and hold image key enablement until verified in an authorized disposable non-production environment.
- Verify no new private-asset attachment from another owner, including an admin-owned PAT; authorized existing attached assets still work. Preview/multipart/file-manager requests fail regardless of scopes. Publication requires post scopes; revocation cannot falsely promise cancellation of already issued URL or deletion of public copies.

## Slice 6: the endpoint inventory and telemetry stay safe

- **Red:** Parameterize all protected endpoint declarations in the matrix: seven allowed IDs use their specific policy; every other ID rejects PATs before side effects. Include raw `/auth/*`, optional-auth, plain site routes, and public POSTs. A newly added endpoint must default to deny, not inherit a group-wide key scope.
- **Green:** Bind admission to exact method/route identity and ensure registry tests cover the built `Api` plus non-Api routes.
- **Refactor:** Keep inventory assertions at a contract seam; do not turn documentation text parsing into the production permission system.
- Capture responses, safe logger output, telemetry and Sentry through supplied recording sinks. Inject unique disposable secrets into sign-in, key issuance, auth rejection, DB failure and unexpected failure flows. Assert tokens, hashes, prefixes, passwords and presigned URLs never appear, including nested causes and local traces. Assert only the first issue response contains the new secret.
- Verify no-store on all key/management successes and failures; no cache storage of private responses; public anonymous editorial caching and session content responses retain established behavior.

## Coverage and completion gate

Use pure tests for finite policy and parsers, integration tests for HTTP/D1/service behavior, representative Worker tests for Web Crypto and request normalization, and actual signed upload checks for capability enforcement. Reuse existing Vitest and Effect test-service patterns instead of migrating test frameworks. No unit tests of framework page/route components are required.

During future implementation, run focused suites as each slice becomes green, then:

```sh
bun --filter @gbfm/core test
bun --filter @gbfm/api test
bun --filter @gbfm/server test
bun precommit
```

Run required checks in an owned clean worktree or isolate unrelated edits before any write-mode formatter. All persistence tests replay the real approved flat migrations on throwaway D1. Extend relational-query smoke coverage for new query shapes. No production database, real customer, real secret, or published fixture is used.

Runtime assertions in this plan are release criteria, not claims that passing static checks proves authorization. Feature completion requires evidence for every high-consequence matrix rule and a written account of any unverified platform behavior.
