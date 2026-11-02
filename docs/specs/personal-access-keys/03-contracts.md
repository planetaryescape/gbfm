# Contracts: personal access keys

Status: proposed. TypeScript sketches describe intended contracts, not compiled implementation. Use installed Effect **4.0.6**, local `Context.Service`, `Schema.TaggedError`, `HttpApiGroup`, and `HttpApiEndpoint` conventions. No new package is required by the recommended design.

## Domain values and actor

Place shared key value schemas and pure key policy in `packages/core`, HTTP schemas/context in `packages/api`, and credential lifecycle in the server. Add the explicit workspace dependency `@gbfm/api -> @gbfm/core`; core currently depends only on Effect, so this introduces no cycle. Parse HTTP input and stored rows through Effect Schema before passing values inward. Use schema brands for key/user/request IDs and integer millisecond instants; existing user IDs are nonempty opaque strings, not necessarily UUIDs.

```ts
import { Schema } from 'effect'
import type { Effect, Redacted } from 'effect'

const KeyId = Schema.String.pipe(Schema.brand('PersonalAccessKeyId'))
const UserId = Schema.NonEmptyString.pipe(Schema.brand('UserId'))
const IssuanceId = Schema.String.pipe(Schema.brand('KeyIssuanceId'))
const KeyEnvironment = Schema.Literals(['prod', 'dev'])
const KeyScope = Schema.Literals([
  'posts:read',
  'posts:create',
  'posts:update',
  'posts:publish',
  'music:resolve',
  'uploads:images:create',
])

type KeyId = typeof KeyId.Type
type UserId = typeof UserId.Type
type IssuanceId = typeof IssuanceId.Type
type KeyEnvironment = typeof KeyEnvironment.Type
type KeyScope = typeof KeyScope.Type
type CurrentRole = 'user' | 'creator' | 'editor' | 'admin'
type Millis = number
type Secret = Redacted.Redacted<string>

type ActorUser = {
  readonly id: UserId
  readonly name: string | null | undefined
  readonly email: string
  readonly role: string | null | undefined
}

type SessionActor = {
  readonly user: ActorUser
  readonly credential: {
    readonly _tag: 'Session'
    readonly sessionId: string
  }
}

type PersonalAccessKeyActor = {
  readonly user: ActorUser & { readonly role: CurrentRole }
  readonly credential: {
    readonly _tag: 'PersonalAccessKey'
    readonly keyId: KeyId
    readonly environment: KeyEnvironment
    readonly scopes: ReadonlyArray<KeyScope>
  }
}

type AuthenticatedActor = SessionActor | PersonalAccessKeyActor
```

These schema declarations show ownership, not all validation. Complete KeyId with a UUID parser; IssuanceId is a client-generated UUID. `Millis` becomes a finite, safe integer refinement. Do not brand unvalidated input. ActorUser deliberately preserves the existing nullable session fields; key roles are decoded into the finite current-role set. No raw key, secret hash, cookie, or Better Auth object crosses into content services.

## Key metadata and lifecycle

```ts
type KeyState =
  | { readonly _tag: 'Active'; readonly expiresAt: Millis }
  | { readonly _tag: 'Expired'; readonly expiredAt: Millis }
  | { readonly _tag: 'Revoked'; readonly revokedAt: Millis }

type KeyMetadata = {
  readonly id: KeyId
  readonly ownerUserId: UserId
  readonly name: string
  readonly environment: KeyEnvironment
  readonly scopes: ReadonlyArray<KeyScope>
  readonly displayPrefix: string
  readonly createdAt: Millis
  readonly expiresAt: Millis
  readonly revokedAt: Millis | null
  readonly lastUsedAt: Millis | null
}

type IssueKey = {
  readonly requestId: IssuanceId
  readonly name: string
  readonly scopes: ReadonlyArray<KeyScope>
  readonly expiresInSeconds: number
}

type IssuedKey = {
  readonly metadata: KeyMetadata
  readonly secret: Secret
}
```

`KeyMetadata` is the neutral metadata projection; derive state using trusted time: revoked takes precedence, then `now >= expiresAt`, otherwise active. Scope/environment/owner/expiry are immutable. Revoking an expired key is allowed; it transitions to revoked and retains the first revocation time. There is no reactivate or extend operation.

Request rules: trimmed name 1..80 characters, reject control characters; 1..6 distinct known scopes, stored in canonical sorted order; no duplicate/unknown scopes; integer expiry 3,600..7,776,000 seconds, default 2,592,000. `posts:publish` requires create or update in the same grant. `music:resolve` requires update. `posts:read` and `uploads:images:create` may stand alone. No scope is implicit. Issuance allows only creator/editor/admin; publish is available only to editor/admin. An owner later demoted to `user` cannot use any key endpoint, but may still list/revoke keys through a session.

## Management HTTP API: session only

Add `PersonalAccessKeyGroup` in `packages/api/src/personal-access-keys.ts`. All management success and failure responses use `Cache-Control: private, no-store`; never log bodies. Mutations require JSON and strict unknown-field rejection. Existing content payloads retain their published shape.

| Method/path | Request | Success | Policy |
| --- | --- | --- | --- |
| `POST /api/user/api-keys` | `{ requestId, name, scopes, expiresInSeconds? }` | 201 `{ key: KeyMetadataJson, secret: string }` | Real active session, created within 10 minutes, not impersonated; owner from session only |
| `GET /api/user/api-keys` | `limit?` default 20, 1..100; `offset?` default 0 | 200 `{ data: KeyMetadataJson[], pagination: { total, limit, offset, hasMore } }` | Current session owner; all states, ordered `createdAt DESC, id DESC` |
| `DELETE /api/user/api-keys/:id` | No body | 204 | Current session owner; idempotent for owned key; no recent-session requirement |

`KeyMetadataJson` is exactly the metadata fields above with dates serialized as UTC ISO-8601 strings or null. List never returns secret, hash, rate counter, issuance ID, session ID, or user account details. Owner ID is safe metadata for this authenticated owner, not a caller-selectable input. Environment comes from server config; reject `ownerUserId`, `userId`, `environment`, `prefix`, `secret`, `role`, or other extra fields in create input. No public “verify key” endpoint and no key-management scope.

Freshness means session **creation**, not refreshed `updatedAt`. Use the authoritative Better Auth session record and reject `impersonatedBy`; a session renewal must not count as reauthentication. List and revoke remain available with any valid owned session to make incident response easy. A session bearer is a real session for this rule.

Cookie mutations require a trusted `Origin` matched to `browserOrigins` and reject cross-site origin/fetch metadata before service invocation. Originless management mutation is allowed only for a real session bearer with no auth cookie; validate any supplied origin. Do not loosen Better Auth CSRF handling or rely on CORS as CSRF prevention. This policy is local to new management endpoints and does not rewrite browser content APIs.

### Issuance retries

The client creates and retains `requestId` before sending. A unique `(owner_user_id, environment, issuance_request_id)` prevents duplicate issuance. Repeated ID returns 409 `KeyIssuanceConflict` with only the existing owned key ID, never another secret. This includes a request whose first response was lost. The client lists and revokes that key, then issues under a new request ID. Do not persist recoverable plaintext to replay a secret. The active-key limit is checked atomically with insert, not with a count followed by an unguarded insert.

## Token and persistence design

Token format: `gbfm_pat_v1_<prod|dev>_<43-character base64url random secret>`. Generate 32 random bytes using Web Crypto, encode without padding. Require canonical encoding and exact length. Hash the entire token with SHA-256; store its lowercase hex digest with a unique index. Lookup by digest avoids comparing attacker-controlled strings against stored secrets in application code. Do not compare by display prefix. A public token prefix plus 6 random characters may be shown as `displayPrefix`; the remaining entropy is still far above brute-force feasibility, but prefixes must not become log fields or auth selectors.

Keep the secret wrapped in `Redacted` after parsing/generation. Unwrap only in the digest adapter or the single create-response encoder. Persist nothing that can recover it. User-chosen low-entropy keys and BYOK are disallowed. There is no pepper to rotate and no dependency on `BETTER_AUTH_SECRET`; SHA-256 is appropriate here because the input is 256 bits of random secret, not a password.

Proposed table **`personal_access_keys`**, documented only, not a migration in this change:

| SQL column | Type / constraints | TypeScript field |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY, server UUID | `id` |
| `owner_user_id` | TEXT NOT NULL REFERENCES `user(id)` ON DELETE CASCADE | `ownerUserId` |
| `issuance_request_id` | TEXT NOT NULL, client UUID | `issuanceRequestId` |
| `name` | TEXT NOT NULL, length 1..80 | `name` |
| `environment` | TEXT NOT NULL CHECK IN ('prod','dev') | `environment` |
| `scopes` | TEXT NOT NULL, valid JSON array; runtime decode to known scopes | `scopes` |
| `secret_hash` | TEXT NOT NULL UNIQUE, 64 hex characters | `secretHash` |
| `display_prefix` | TEXT NOT NULL | `displayPrefix` |
| `created_at` | INTEGER NOT NULL, timestamp_ms | `createdAt` |
| `expires_at` | INTEGER NOT NULL, greater than `created_at` | `expiresAt` |
| `revoked_at` | INTEGER NULL, at least `created_at` | `revokedAt` |
| `last_used_at` | INTEGER NULL, at least `created_at` | `lastUsedAt` |
| `rate_window_start` | INTEGER NULL, epoch-aligned minute | `rateWindowStart` |
| `rate_request_count` | INTEGER NOT NULL DEFAULT 0, 0..60 | `rateRequestCount` |

Indexes: unique hash; unique owner/environment/issuance ID; index owner/environment/created_at for listing and active-count filtering. Retain expired/revoked rows for account lifetime in v1; no cleanup scheduler or reactivation. User deletion cascades; a later retention change needs a separate policy decision. DB checks enforce timestamp and counter shape, JSON array shape, and paired null window/zero count; the row parser also rejects unknown scopes, invalid dependencies, malformed hash/prefix, and expiry beyond the 90-day maximum. A corrupt row is a storage failure, never broadened access.

Drizzle uses explicit snake_case literals and camelCase fields, with `integer(..., { mode: 'timestamp_ms' })`. Extend exports and test replay only when implementation/migration work is authorized. Use the existing flat, hand-written `apps/server/drizzle-d1/` migration chain, never `drizzle push` or migration generators. No schema or data is changed by this spec.

### Environment binding

Parse `ConfigService.app.stage` at composition into the closed key environment. Verify stage, token namespace, and stored environment agree. Do not infer trust from a host header. Prod/dev use distinct D1 resources and secrets never move between them. A prod database copied into dev still rejects prod tokens, even with identical user IDs and hashes. Do not relabel imported rows. Local dev key issuance uses only its local DB; a dev token from another DB is simply unknown.

## Service and adapter contracts

These sketches name the interfaces and typed failures. Implement with local `Context.Service`/Layer provision, not constructor dependency bags or raw Worker `Env` in the domain. `RecentSessionOwner` is an internal refined value constructed only after current-session, age, active-account, and non-impersonation checks; clients cannot construct it over HTTP.

```ts
type RecentSessionOwner = {
  readonly userId: UserId
  readonly role: CurrentRole
  readonly sessionId: string
}

type KeyFailure =
  | InvalidKeyCredential
  | KeyStoreUnavailable
  | KeyRateLimited

interface PersonalAccessKeys {
  readonly issue: (
    owner: RecentSessionOwner,
    input: IssueKey,
  ) => Effect.Effect<IssuedKey,
    KeyInputInvalid | KeyScopeDenied | KeyLimitReached |
    KeyIssuanceConflict | KeyStoreUnavailable>
  readonly list: (
    ownerUserId: UserId,
    page: { readonly limit: number; readonly offset: number },
  ) => Effect.Effect<KeyPage, KeyStoreUnavailable>
  readonly revoke: (
    ownerUserId: UserId,
    keyId: KeyId,
  ) => Effect.Effect<void, KeyNotFound | KeyStoreUnavailable>
  readonly authenticate: (
    secret: Secret,
  ) => Effect.Effect<PersonalAccessKeyActor, KeyFailure>
  readonly recheck: (
    actor: PersonalAccessKeyActor,
  ) => Effect.Effect<PersonalAccessKeyActor, InvalidKeyCredential | KeyStoreUnavailable>
}

interface KeyCrypto {
  readonly generate: (environment: KeyEnvironment) =>
    Effect.Effect<Secret>
  readonly digest: (secret: Secret) =>
    Effect.Effect<Redacted.Redacted<string>>
}

interface KeyStore {
  readonly insertWithinLimit: (row: NewKeyRow, now: Millis) =>
    Effect.Effect<KeyMetadata, KeyLimitReached | KeyIssuanceConflict | KeyStoreUnavailable>
  readonly claim: (hash: Redacted.Redacted<string>, now: Millis, environment: KeyEnvironment) =>
    Effect.Effect<PersonalAccessKeyActor, KeyFailure>
  readonly recheck: (keyId: KeyId, now: Millis, environment: KeyEnvironment) =>
    Effect.Effect<PersonalAccessKeyActor, InvalidKeyCredential | KeyStoreUnavailable>
  readonly listOwned: (owner: UserId, environment: KeyEnvironment, page: KeyPageInput) =>
    Effect.Effect<KeyPage, KeyStoreUnavailable>
  readonly revokeOwned: (owner: UserId, keyId: KeyId, now: Millis) =>
    Effect.Effect<void, KeyNotFound | KeyStoreUnavailable>
}
```

`KeyPageInput` is the parsed limit/offset pair; `KeyPage` is metadata plus the management pagination shape. `NewKeyRow` consists of immutable metadata, issuance ID, redacted hash, null usage/revocation/window fields, and zero counter. These are persistence-adapter types, not public API DTOs. `claim` performs a current primary read/join and guarded usage update; `recheck` reads active key/current owner without consuming quota. Revoke is `UPDATE ... SET revoked_at = COALESCE(revoked_at, now) WHERE id = ? AND owner_user_id = ? AND environment = ?` with existence/result handling in the same adapter. No operation accepts arbitrary owner IDs from a key caller.

Reuse the existing [CryptoLive](../../../apps/server/src/lib/crypto.ts) through Effect's Crypto service for Web Crypto bytes/digests. `KeyCrypto` owns only the PAT format, canonical encoding, and Redacted boundary, and can stay private to the key service. The current crypto layer treats unavailable fixed algorithms as defects; preserve that convention, returning a scrubbed 500 at HTTP rather than exposing raw crypto failures. Do not create another generic crypto provider.

```ts
type PostKeyOperation =
  | { readonly _tag: 'ReadOwned' }
  | { readonly _tag: 'Preview' }
  | { readonly _tag: 'Create'; readonly nextDraft: boolean }
  | { readonly _tag: 'Update'; readonly currentDraft: boolean; readonly nextDraft: boolean }
  | { readonly _tag: 'ResolveMusic'; readonly currentDraft: boolean }

type PostOwnership = 'Owned' | 'NotOwned'

declare const authorizeKeyPost: (
  actor: PersonalAccessKeyActor,
  operation: PostKeyOperation,
  ownership: PostOwnership,
) => Effect.Effect<void, KeyScopeDenied | KeyRoleDenied | KeyResourceDenied>
```

Creation binds ownership to self before calling the policy. Existing post operations derive ownership from D1. Session actors use existing behavior; key operations use this policy. Update and resolution accept the full actor in the changed server service boundary; the service loads the post and current ownership, computes effective state, checks authorization, and guards writes. Existing internal trusted ingestion callers of `PostService.create` remain explicit trusted callers, not an optional actor shortcut that HTTP can exploit. The implementation should preserve those callsites through a clearly named internal boundary rather than assume they are all HTTP users.

## Error contracts

Implement errors using `Schema.TaggedError` and finite safe fields. New HTTP error bodies use `{ _tag, ...safeFields }` with schema-defined HTTP status. No raw cause, input, secret, digest, user email, or arbitrary library message is serialized.

| Domain/error tag | HTTP | Safe fields / meaning |
| --- | --- | --- |
| `InvalidKeyCredential` | 401 | None; identical for invalid, expired, revoked, wrong stage, missing/deleted/banned owner |
| `AmbiguousCredential` | 400 | None; multiple auth methods or duplicate header |
| `KeyInputInvalid` | 422 | `field` from finite request-field names; invalid value not echoed |
| `SessionReauthenticationRequired` | 403 | None; issue only |
| `KeyScopeDenied` | 403 | `requiredScopes: KeyScope[]` |
| `KeyRoleDenied` | 403 | None |
| `KeyResourceDenied` | 404 | None; conceal another user's private post/key |
| `KeyEndpointDenied` | 403 | None; route does not accept PATs |
| `KeyNotFound` | 404 | None; unknown or another owner's key |
| `KeyLimitReached` | 409 | `limit: 10` |
| `KeyIssuanceConflict` | 409 | `keyId` of this session owner's existing issuance |
| `KeyRateLimited` | 429 | `retryAfterSeconds`, also `Retry-After` header |
| `KeyStoreUnavailable` | 503 | No internal detail; preserve safe operational error tag in telemetry |
| Existing post concurrent-state conflict | 409 | Existing conflict response where available; add declared conflict status to opted-in update |

All opted-in endpoint schemas must declare new reachable errors, including policy errors on manage/edit/preview/update/resolution and rate/storage failures. Preserve existing session/business errors and existing success DTOs. Default Effect decoding failures retain existing protocol semantics for content payloads; the new management group's validation mapping is explicit. Unexpected defects remain defects with scrubbed reporting, not disguised 401s.

## Limits and usage

Authenticate a permitted PAT request once, then atomically claim one slot in a **60 requests per fixed UTC minute per key** window. Guard against revoked/expired key and inactive owner in the same claim. Use a single conditional update that resets when the stored minute is older, otherwise increments only below 60, returning the claimed row. Reject backward/future-window corruption; never silently reset an unexpected future window. A failed claim is classified by a fresh primary read as invalid, limited, or unavailable, never allowed by default.

Valid requests that later fail scope/role/business checks consume a slot. Excluded routes and malformed/unknown keys do not. `lastUsedAt` means last successfully authenticated admitted request, not last successful business action; update with the claimed timestamp in that same write. No separate detached timestamp task. A fixed window permits bursts across the minute boundary, an explicit tradeoff acceptable for personal automation; it is not a strict rolling quota or storage-byte quota.

Keep existing edge/IP protections for unauthenticated guessing, sign-in, and issuance. Their production configuration was not inspected here, so do not claim it is already adequate. Review that configuration before exposure, without adding a new infrastructure service in this design. Rate-store failure returns 503 and no side effect. Operational tuning of the proposed 60/minute limit is a config change with tests, not a caller-controlled field.
