# File map and ownership

Status: proposed implementation map. Only this specification folder is created by the current task. Paths in the tables below are future work, not files already implemented.

## Files to add

| Proposed file | Responsibility / contract |
| --- | --- |
| `packages/api/src/personal-access-keys.ts` | Import core key values; own management DTOs, tagged HTTP errors, three session-only endpoints |
| `packages/api/src/middleware/actor.ts` | AuthenticatedActor context and key-enabled middleware contract, preserving distinct session/key variants |
| `packages/core/src/personal-access-keys/index.ts` | Shared key value schemas, pure scope dependencies, current-role policy, lifecycle derivation, post publication decisions; depends only on Effect and existing core roles |
| `apps/server/src/services/personal-access-keys.ts` | Issue/list/revoke/authenticate/recheck service; Clock, Crypto, D1 adapter, safe lifecycle events; private KeyCrypto formatting adapter |
| `apps/server/src/repositories/personal-access-keys.repository.ts` | Primary D1 lookup, current user join, strict row decoding, quota claim, atomic issue limit/uniqueness, owned revocation |
| `apps/server/src/db/personal-access-key.schema.ts` | Proposed table with explicit SQL/TS naming and constraints |
| `apps/server/src/middleware/actor.impl.ts` | Existing-session or PAT resolution for opted-in handlers, supplying only AuthenticatedActor |
| `apps/server/src/http/personal-access-key-policy.ts` | Exact endpoint registry, credential parsing/admission gate, key-specific cache policy, management CSRF/session-age boundary |
| `apps/server/src/http/personal-access-key.handlers.ts` | Management HTTP parsing/projection; secret unwrap only for first issue response |
| `apps/server/drizzle-d1/NNNN_personal_access_keys.sql` | Next available hand-written flat migration, only after explicit schema approval; number allocated at implementation time |
| `docs/operations/personal-access-keys.md` | Future tested issuance/rotation/revocation runbook; local-client bootstrap and incident response |

The inspected core manifest depends only on Effect; API has no current core dependency. Add the explicit `@gbfm/api -> @gbfm/core` workspace edge for shared key values and keep core independent of API/server. Export the new core key module and API management/actor modules through their existing package export maps. Service/HTTP-specific errors remain at their owning boundary. No new package is introduced.

## Existing files to change

| Existing file | Bounded change |
| --- | --- |
| [packages/api/package.json](../../../packages/api/package.json), [packages/core/package.json](../../../packages/core/package.json), `bun.lock` | Add API-to-core workspace dependency and explicit new subpath exports; update lockfile through Bun only during implementation |
| [packages/api/src/api.ts](../../../packages/api/src/api.ts) | Register management group |
| [packages/api/src/post.ts](../../../packages/api/src/post.ts) | Opt in six supported post endpoints with actor middleware, declare key errors and update conflict; reply stays session-only |
| [packages/api/src/upload.ts](../../../packages/api/src/upload.ts) | Opt in only `presignImage`, declare key errors |
| [apps/server/src/http/routes.ts](../../../apps/server/src/http/routes.ts) | Wire handlers/middleware; deterministic outer PAT gate for raw, optional-auth, and API routes, rather than relying on global layer merge order |
| [apps/server/src/http/post.handlers.ts](../../../apps/server/src/http/post.handlers.ts) | Use actor on six opted-in endpoints; preserve session-only reply; pass credential-aware actor to write policy |
| [apps/server/src/services/post.service.ts](../../../apps/server/src/services/post.service.ts) | Owner-filtered key reads, effective draft authorization, self authorship, stable slug restriction, guarded existing-post writes; preserve trusted internal ingestion boundary |
| [apps/server/src/services/post-music-resolution.ts](../../../apps/server/src/services/post-music-resolution.ts) | Pre-provider scope/publish/ownership check, full actor, post-provider credential/role recheck and guarded attachment commit |
| [apps/server/src/http/upload.handlers.ts](../../../apps/server/src/http/upload.handlers.ts) | Actor only for image presign, image scope/current role gate, no-store; remaining upload handlers keep AuthSession |
| [apps/server/src/services/media-publication.ts](../../../apps/server/src/services/media-publication.ts) | Explicit session/PAT media authority for new private attachments; PAT does not inherit admin private-media bypass |
| [apps/server/src/runtime/services.ts](../../../apps/server/src/runtime/services.ts) | Compose key service/repository and existing Crypto provider |
| [apps/server/src/services/config.service.ts](../../../apps/server/src/services/config.service.ts) | Parse stage for key capability; do not guess production from request host |
| [apps/server/src/worker.ts](../../../apps/server/src/worker.ts) | Ensure per-request capability provision and complete gate coverage in the actual Worker entry |
| [apps/server/src/db/exports.ts](../../../apps/server/src/db/exports.ts) | Export approved schema |
| [apps/server/src/test/migrate-d1.ts](../../../apps/server/src/test/migrate-d1.ts) | Add approved migration to literal replay list |
| [apps/server/src/services/logger.service.ts](../../../apps/server/src/services/logger.service.ts), [sentry.service.ts](../../../apps/server/src/services/sentry.service.ts) and existing local tracing | Add only needed safe projection/redaction coverage for key traffic; no generic logger rewrite |

`AuthMiddleware`, `AuthSession`, Better Auth bearer/session configuration, and optional navigation identity remain session mechanisms. Gate tests cover them; converting every consumer is unnecessary. No WWW/mobile feature work is planned, and no browser/mobile key-management screen is required for no-browser issuance.

## Test files

| Proposed/extended test file | Caller-facing evidence |
| --- | --- |
| `packages/core/src/personal-access-keys/index.test.ts` | Role/scope/draft-state decision table, lifecycle/expiry boundaries, scope dependencies |
| `packages/api/src/personal-access-keys.test.ts` | Strict management schemas, safe DTO projections, unknown scope/field rejection |
| `apps/server/src/http/personal-access-keys.d1.test.ts` | Real HTTP issuance/list/revoke, Better Auth bearer bootstrap, live role/ban changes, storage, key limits, retries, response redaction |
| `apps/server/src/http/personal-access-key-authorization.d1.test.ts` | Same-route session/PAT behavior, publish loopholes, foreign-resource exclusion, protected route inventory, no fallback to session/anonymous |
| `apps/server/src/repositories/personal-access-keys.d1.test.ts` | Generated SQL execution, primary reads, atomic counter/issuance races, revocation timestamp stability, corrupted storage |
| [apps/server/src/http/post-music-resolution.d1.test.ts](../../../apps/server/src/http/post-music-resolution.d1.test.ts) | Slow provider race, revocation/demotion/ownership/public-state changes, no unauthorized attachment |
| [apps/server/src/http/media-preview.d1.test.ts](../../../apps/server/src/http/media-preview.d1.test.ts), [upload.handlers.test.ts](../../../apps/server/src/http/upload.handlers.test.ts) | PAT preview denial, image/presigned capability bounds, media ownership |
| [apps/server/src/http/routes.blackbox.test.ts](../../../apps/server/src/http/routes.blackbox.test.ts), [global-middleware.test.ts](../../../apps/server/src/http/global-middleware.test.ts), [auth.d1.test.ts](../../../apps/server/src/lib/auth.d1.test.ts) | Session regressions, raw/optional router exclusion, cookie conflicts, error/status/cache/redaction contracts |
| [apps/server/src/db/relational-queries.smoke.test.ts](../../../apps/server/src/db/relational-queries.smoke.test.ts) | Any newly introduced relational query shape, including admin-key owner filtering |

No test file or migration is created in this documentation task. No files are deleted. No external dependency is added; only the proposed internal workspace edge changes package metadata. No resource declaration changes are planned; if real D1 or presign constraints require a change, document and obtain approval for that scope before expanding implementation.
