# Alternatives and proposed decisions

Status: **all decisions proposed**, dated 2026-10-30. These are recommendations, not accepted ADRs. Existing ADR-0003 threading and ADR-0006 public-cache behavior are preserved.

## D001: keep session and key identities distinct

| Approach | Advantage | Cost / rejection |
| --- | --- | --- |
| Existing Better Auth bearer session | Already supports HTTP automation and initial issuance | Broad account session authority, seven-day lifetime, no per-key scopes; useful bootstrap, not the durable delegation model |
| API key treated as a synthetic session | Fewer handler changes | Session-only routes become reachable; credential provenance is lost; rejected |
| Tagged actor on explicitly opted-in endpoints | Scoped access without changing all handlers | New small middleware and endpoint registry; recommended |

Revisit only if GBFM replaces its authentication boundary. A library option that simulates sessions is not a shortcut around this decision.

## D002: use a small application-owned key store for this bounded contract

### Version evidence

- Installed and pinned `better-auth` is **1.7.12**, with `bearer()`, `username()`, and `admin()` configured. Its installed plugin exports contain no API-key implementation.
- `@better-auth/api-key` is absent from `bun.lock`. It is a separate dependency, not an already-configured capability.
- Inspected published **`@better-auth/api-key@1.7.12`** from the npm registry without installing it or changing dependencies. Its peer requirement includes `better-auth: ^1.7.12`. Package integrity: `sha512-qkEA9vGMgOpC5Gqia1tg/Y4up2Lov+QDLmu1fZJ4vhs805WIw4jtNhmD6hNQNd5A4Cc2quHklP0yqPUpicavlw==`.
- The release's `dist/index.mjs` implements SHA-256 key hashing, database verification, configurable permissions, expiry, and guarded `incrementOne` rate-limit updates. It would be incorrect to dismiss this version's database rate limiting as a plain read-modify-write race.
- `validateApiKey` deletes expired records; public delete removes records; the schema has `enabled` rather than the proposed immutable revocation timestamp. Session simulation is optional and disabled by default. Its create endpoint and server API offer more settings than GBFM intends to expose.
- Its source treats expiration defaults as seconds, while the current reference page describes `defaultExpiresIn` as milliseconds. Source/version tests, not copied documentation units, would govern adoption.

Sources inspected 2026-10-30: [plugin installation and API](https://www.better-auth.com/docs/plugins/api-key), [reference](https://www.better-auth.com/docs/plugins/api-key/reference), [advanced behavior](https://www.better-auth.com/docs/plugins/api-key/advanced), [exact package metadata](https://registry.npmjs.org/@better-auth/api-key/1.7.12). Web documentation is moving documentation; package findings above are release-specific source inspection, not executed compatibility tests.

### Comparison

| Dimension | Plugin behind GBFM facade | Application-owned D1 service |
| --- | --- | --- |
| Crypto | Reuses generation/hash implementation | Thin Web Crypto random/digest adapter, no novel primitive |
| Session boundary | Disable `enableSessionForAPIKeys`; manually verify once | Separate by construction |
| Permissions | Translate scopes to plugin permissions, still enforce role/ownership in GBFM | Same GBFM policy, direct scope storage |
| Metadata retention | Extra tombstone/metadata storage or changed lifecycle contract | Single durable metadata row, retained after expiry/revoke |
| HTTP exposure | Block native `/auth/api-key/*` management paths, expose constrained facade | Only the three intended management endpoints |
| Retry-safe issuance | Add GBFM issuance receipt/identity policy | Unique owner + request ID in the same row |
| Limits | Existing guarded plugin database limiter; verify adapter behavior on D1 | One guarded fixed-window counter update, test on D1 |
| Maintenance | Dependency security updates plus integration constraints | GBFM owns security-sensitive lifecycle and tests |

**Recommendation:** application-owned `personal_access_keys` table and service. The retained metadata, one-time issuance retry semantics, narrow facade, and fixed credential boundary otherwise require app-owned policy/storage around most plugin operations. At this size, one store is a smaller total design. Absence from the lockfile alone is not the reason to reject the plugin.

Use `crypto.getRandomValues` and `crypto.subtle.digest('SHA-256', ...)`; do not implement hashing, invent an encryption scheme, reuse passwords, or expose a plaintext/hash-disable option. Slow password hashing is unnecessary for a uniformly random 256-bit token. The one-way hash is not a bearer credential.

**Consequence:** custom security code requires the real-seam tests and review in this spec before exposure. **Revisit:** if retention can be dropped, upstream supports equivalent retained lifecycle/issuance semantics, or GBFM needs organizations/quotas/many key products. A switch to the plugin requires updating this decision and verifying exact-version D1 behavior, route suppression, no fake sessions, hash-only storage, and expiry units; it is not an automatic fallback during implementation.

## D003: six scopes, own resources, no admin key

Recommend `posts:read`, `posts:create`, `posts:update`, `posts:publish`, `music:resolve`, `uploads:images:create`. Public reads need no key. `posts:publish` supplements create/update and never implies either. No wildcard or `manage` scope.

Use post-scoped resolution instead of opening the broad music-management API. Use image-only presigning instead of `uploads:create`, which would misleadingly imply multipart audio access. Resolving a saved post can create canonical music records, so it needs a separate opt-in scope. Revisit each exclusion only with an audited caller and explicit endpoint tests.

## D004: key publishing is stricter than today's session path

For keys, require `posts:publish` and editor/admin for every operation affecting a currently public post or producing a public post, including unpublishing and changing an attachment. Checking only an explicit `draft: false` input is insufficient. Creators can create/edit drafts.

The alternative, enforcing new publish restrictions on every existing session caller at once, changes active workflows beyond this request. Keep session behavior and document the difference. Revisit session publish policy separately with owner approval. Scope limitations describe maximum delegated authority, so stricter key rules are intentional rather than fake role parity.

## D005: expire, revoke, then rotate by replacement

Use expiring immutable grants, retained metadata, owner-only session management, and create-then-revoke rotation. Do not support secret recovery, grant mutation, reactivation, admin impersonation issuance, or non-expiring tokens. This avoids new state transitions and ambiguous audit history. Revisit if actual key turnover makes manual replacement burdensome.
