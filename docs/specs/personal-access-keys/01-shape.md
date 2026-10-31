# Shape: a personal credential, a shared actor

Status: proposed. [Problem and authority](00-problem.md).

```text
Cookie / existing session bearer -> Better Auth -> AuthSession (session-only routes)
                                           \-> AuthenticatedActor.Session
PAT bearer -> key service -> primary D1 -> current owner
                                           \-> AuthenticatedActor.PersonalAccessKey
                                                    |
                        explicit endpoint + scopes + role + ownership
                                                    |
                                  existing PostService / upload handler
```

## Boundaries

- **HTTP credential gate:** recognizes the reserved `gbfm_pat_` bearer namespace before Better Auth or optional identity resolution. A recognized key cannot fall back to a cookie or anonymous request. Unsupported routes reject it. Normal cookie and non-PAT session bearer requests follow their existing route.
- **Key-enabled authentication middleware:** supplies `AuthenticatedActor` for opted-in endpoints. Session resolution delegates to the current Better Auth instance. Key resolution supplies a user loaded from D1 and a tagged credential. It never provides `AuthSession` for a key.
- **Session-only middleware:** the existing `AuthMiddleware`/`AuthSession` remain for all other endpoints and key management. Key-enabled post handlers migrate locally to the shared actor, not every authenticated handler in the repository.
- **PersonalAccessKeys service:** owns issuance, verification, limits, lifecycle, expiry, and safe metadata projection. Its D1 adapter owns guarded writes and row parsing; its small crypto adapter owns Web Crypto. Better Auth still owns passwords and real sessions.
- **Post authorization policy:** key-only role/scope/ownership rules execute before rendering, provider resolution, media preparation, or writes. The full actor reaches changed write services, so policy cannot be lost by reducing it prematurely to a user ID.
- **Composition:** `runtime/services.ts` and `worker.ts` supply Database, Clock, crypto, and parsed stage config. No new Worker, queue, Durable Object, Redis, or auth cache.

## Credential selection

Only `Authorization: Bearer <key>` carries a personal key. No query parameter, cookie, JSON-body key, custom header, or URL userinfo. Prefix matching is case-sensitive; bearer scheme parsing follows HTTP rules. Reject duplicate/comma-joined credentials and malformed reserved-prefix tokens. Bound header size before parsing.

A PAT bearer plus a Better Auth session cookie is an ambiguous credential: return 400 before handler execution. Non-auth cookies do not cause a conflict. Detect real Better Auth cookie names using its configured cookie machinery, including secure/chunked forms. Existing non-PAT bearer-plus-cookie precedence remains Better Auth's behavior. Do not introduce a second session precedence policy.

The gate covers `/auth/*`, optional-auth navigation, plain router paths, and HttpApi routes. It must wrap the final request dispatch explicitly; do not depend on `Layer.mergeAll` global-middleware ordering, which [routes.ts](../../../apps/server/src/http/routes.ts) already calls out as non-contractual. Known excluded endpoints return 403 for a well-formed PAT attempt; unknown routes remain 404. No key lookup is needed to reject an excluded route. Allowed routes verify the key and return generic 401 on credential failure.

Use exact method and canonical route identity, never a broad `/api/content/*` prefix. Reject ambiguous encoded separators/dot segments for PAT requests. A route registry and tests bind each opted-in endpoint to its credential policy. CORS preflights contain no credential and remain unchanged.

## Authorization and concurrency

The key's scopes are a ceiling, not copied role powers. Current `creator`, `editor`, and `admin` roles may author drafts; only `editor`/`admin` may change public posts. Unknown/composite roles fail closed for keys. Scope grants are immutable and cannot be broadened by a later role promotion. A promotion only makes already-granted operations eligible; issuance itself refuses scopes above the current role.

Every key read of edit/manage data is owner-filtered, even for admin keys. Every key write checks current ownership. No PAT authorship reassignment: create only as self; update cannot send `creatorIds`. Replies remain session-only because their current publishing and role policy differs from top-level posts.

Before changing an existing post, load its current draft state and authorship. Guard the eventual write against the inspected state and authorship so a concurrent publish/ownership change cannot bypass the decision. Existing `updatedAt` plus draft/ownership predicates are required, not an unlocked read followed by unconditional write. A tags-only update must also claim a guarded post write before applying labels; it cannot skip the authorization commit because no scalar post field changed. On conflict return 409 and require a reload. The guarded write is the operation's authorization boundary; later already-authorized effects may finish, as described below. Provider calls do not run inside a DB transaction.

Verification reads primary D1 on each request. Revocation, ban, deletion, and demotion apply to the next authentication decision after the change commits. Already authorized in-flight work may finish. Long provider flows recheck the key and current role/ownership before committing the post attachment, without charging another rate-limit slot. Revocation does not undo an already committed post, public media copy, or issued presigned URL.

## Decisions and risks

The proposed decisions are recorded in [alternatives](02-alternatives.md). Principal risks are the publish default, key-to-session confusion, creator reassignment, bypass through another endpoint, concurrent writes, and token leakage through generic request/error logging. [Flows](04-flows.md) and [tests](06-test-plan.md) make each boundary observable.
