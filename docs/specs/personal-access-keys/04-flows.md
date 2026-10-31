# Flows and operational behavior

Status: proposed. [Contracts](03-contracts.md) define exact types and statuses; [matrix](authorization-matrix.md) owns permission decisions.

## 1. Initial issuance without browser automation

This is a documented client flow for a future implementation, not a request to run it now.

```text
human enters account credentials privately in local client
  -> POST /auth/sign-in/email (or the installed username sign-in endpoint)
  -> Better Auth verifies account and returns a real session token
  -> local client holds token in memory
  -> POST /api/user/api-keys with session bearer and chosen scopes
  -> recent session/owner/CSRF policy -> parsed IssueKey
  -> key service -> secure generation/hash -> atomic D1 insert
  -> one-time secret response -> private local storage chosen by human
  -> sign out the bootstrap session using the supported Better Auth flow
```

The installed bearer plugin accepts session tokens; a client need not drive a browser. Installed 1.7.12 source exposes `POST /auth/sign-in/email` with `{ email, password }` and `POST /auth/sign-in/username` with `{ username, password }`; both return a JSON `token`. `POST /auth/sign-out` uses the session bearer through the existing bearer plugin. Use JSON sign-in response handling through these real endpoints, do not scrape cookies or mint session rows. Confirm the flow through local HTTP integration tests before documenting a runnable helper, including that sign-out actually invalidates the bootstrap session. No new bypass endpoint, admin impersonation, or direct production SQL bootstrap.

If credentials are unavailable, the person uses existing account recovery or supplies a valid recent session through a trusted local client. An unconfigured `2password` installation remains a local setup issue; this design does not bypass it or provision it automatically. Credentials and issued secrets never go into agent chat. A future helper should read from a hidden prompt or an already-configured secret manager, never command-line arguments, shell history, committed `.env` files, or a terminal transcript. Prefer streaming an issued secret directly to a configured password manager's stdin; retain its reference rather than a plaintext temporary file. The human selects the vault, and a failed secret-store write uses the issuance ID to revoke/reissue rather than logging the secret. Report key ID/prefix separately. This spec adds an HTTP issuance capability and a short runbook, not a general CLI product.

`requestId` is persisted by the caller before sending. If issuance response is lost, retrying the same ID gets the existing ID with 409. Revoke it and issue afresh; no secret can be shown again. Scope/role rejection, invalid input, limit failure, and random/digest failure produce no inserted key. A committed insert followed by disconnect is an ambiguous success, resolved by that ID.

## 2. Authenticate a request

```text
Authorization bytes
  -> bounded canonical credential parser
  -> reserved PAT namespace + exact endpoint admission
  -> Redacted token
  -> KeyCrypto.digest
  -> KeyStore.claim(hash, trusted Clock time, configured environment)
  -> parsed key + current owner + atomic usage slot
  -> PersonalAccessKeyActor
  -> scope/role/resource policy
  -> existing content operation
  -> response schema + private/no-store
```

Use primary D1 reads and conditional writes, not KV, isolate memory, secondary read caches, or role claims captured at issuance. If D1 read replication is introduced later, the key adapter must explicitly use the primary-consistent path for auth and revocation; eventual consistency is not compatible with “next request” revocation. Owner deletion, active ban, unknown key, expiry equality, and wrong environment all produce the same 401. Treat `banned` with null `banExpires` as indefinite; a future `banExpires` is active, and elapsed timed bans follow Better Auth's current semantics. Decode role independently and fail closed for unsupported roles.

Session path on opted-in routes becomes `SessionActor`; ordinary excluded routes still use `AuthSession`. Do not remove session IDs from session-only consumers, and do not put a key ID in their place. Optional auth is never invoked for a PAT attempt. Invalid PAT plus valid cookie must not succeed.

## 3. Publish a text tweet

Minimal grant: `posts:create`, `posts:publish`, owned by a current editor/admin. A proposal/example body for the existing endpoint:

```json
{
  "type": "micro",
  "slug": "personal-note-<client-generated-uuid>",
  "content": "The text the person authorized for publication.",
  "draft": false
}
```

`POST /api/content/post`: authenticate -> parse existing payload -> require PAT stable slug -> normalize self authorship -> derive public state -> check create/publish/role -> canonical content validation -> media preparation -> existing post/creator writes -> labels -> public media copies -> existing `PostResponse`. The key policy runs before any preparation or storage write. No production publication is part of this task.

`draft` omitted is the same publication decision as false, not permission to use a hidden default. A creator key can use `draft: true`; publishing with that key returns 403. Specifying someone else's `creatorIds` fails rather than silently rewriting attribution.

### Retry behavior

PAT creates must supply a stable slug; omission returns 422 on the PAT path without changing session defaults. Database slug uniqueness prevents a retry from creating a second logical post. Existing duplicate-slug behavior remains 409, not a replayed success. A client with `posts:read` reads its owned post through the edit endpoint and compares intended content/state; it must not treat every 409 as success. Without read scope, stop and ask the human to reconcile through their session. Never generate a fresh slug and retry automatically after a timeout.

Existing post writes, labels, and public-media copies are not one transaction. A 5xx or disconnect can follow a committed post. Preserve and document that fact; do not promise exactly-once semantics. For media recovery, use an authorized update of the same post after reading its state. No background retry loop is added.

## 4. Draft, resolve music, publish

1. Issue only needed scopes: create/update/read/music resolve, plus publish if the owner can publish.
2. Create `type: 'micro', draft: true` with stable slug and source text.
3. Call `POST /api/content/posts/:id/resolve-music-entity`, with optional `url`. Authenticate once, require resolve/update scopes and ownership, then invoke the existing canonical identity resolver.
4. Provider adapters retain their source validation, budgets, and error mappings. Do not replace them with arbitrary URL fetching.
5. Before attachment commit, reload key/current role and confirm ownership/public state. Commit only against the inspected post revision/state; concurrent changes return 409. Catalog enrichment may remain if attachment fails.
6. Read the owned draft through edit/manage. `PATCH /api/content/posts/:slug` with `{ "draft": false }` requires update **and** publish scopes plus editor/admin.

For already public posts, the resolution request itself requires publish. A future broad `/api/music/resolve` key grant is not implied. Existing public catalog GETs can be called without a key to reuse known entity IDs.

## 5. Image upload and attachment

Authenticate `POST /api/upload/image/presign` -> require image scope/current author role -> parse current MIME/size payload -> server chooses owner's private key -> existing presign + pending asset recording -> private/no-store response. The client PUTs bytes to R2 using the returned URL, without forwarding the PAT. The 5-minute signed URL is itself secret and must not enter telemetry.

Create/update a post with the returned private URL. Post scopes control draft/public state; image scope alone cannot save or publish it. The existing media publication layer checks resource/asset authority and copies to a deterministic public location only for an authorized public write. Apply the PAT-specific no-admin-bypass rule for newly attached private assets. Failed uploads can leave pending metadata; retain existing lifecycle behavior. No new orphan cleanup job is added.

Revocation stops new presign requests but cannot cancel already-issued URLs or retract permanent public copies. Unpublishing does not erase published media, as the current publication service documents. Upload size enforcement must pass the real adapter check in the test plan before this endpoint is enabled for keys.

## 6. Update, unpublish, and private reads

Manage list: authenticate -> `posts:read` -> DB filter by owner **before pagination/count** -> current response schema. Do not fetch an admin list then filter in memory.

Edit read: authenticate -> read scope -> load owned resource -> same compiled response; missing/foreign resource returns 404. Preview accepts either create or update scope but cannot reveal another owner's private assets.

Update: authenticate -> reject key-only forbidden fields -> load current post and creator relation -> compute effective next draft state -> authorize -> validate canonical content -> media preparation -> guarded write + existing labels/media effects -> response. Reject type changes for PATs; preserve session handling. A failed optimistic guard returns 409. Changes to a public post, even tags, require publish scope. An old key cannot keep writing after its owner is demoted or loses the creator relation.

No automatic update retry. A caller reloads on conflict and deliberately reapplies the desired change. Before provider/media work and before commit, interruption propagates through the existing Effect request lifetime. Some D1/object-store operations may already have committed when cancellation arrives; classify as ambiguous completion, not guaranteed rollback. Do not catch interruption as an invalid-key error.

## 7. List, revoke, rotate, account changes

- List uses current real session owner and returns all states in the configured environment. It never recovers a secret.
- Revoke atomically records the first `revokedAt`. Repeat owner revoke returns 204 with unchanged timestamp. Foreign/missing key is 404; no target-owner input.
- Rotate by issue replacement, privately configure the caller, verify one allowed request, then revoke old key. The overlap is explicit; no automatic rotation endpoint.
- Signing out a session does not revoke personal keys. Password change/reset likewise does not implicitly revoke them in this first design; compromised-account recovery includes listing/revoking keys through a new session. Do not label session sign-out as “all credentials revoked.”
- Ban/deletion prevents subsequent authentication. Role demotion reduces effective access immediately on the next request. Keys are independent grants, so removing a session alone is not key revocation.
- Revoked/expired metadata is retained until user deletion; deleting the account cascades key rows. Audit logs follow existing operational retention rather than becoming a second authority store.

## 8. Safe audit and operations

Use existing request telemetry, logger, Sentry, and trace paths. Emit structured lifecycle events `key.issued`, `key.revoked`, `key.authentication_denied`, `key.rate_limited`, and authorized mutation outcomes with request ID, route template, environment, credential kind, safe key/owner/resource IDs when known, operation, result tag, and required scope names. Omit arbitrary user-entered key names/content. Log rate-limited invalid-attempt summaries rather than one high-volume event per guess. Key IDs belong in logs/traces only, never metric dimensions.

Never record Authorization, Cookie, key/hash/display prefix, password, sign-in/create response, presigned URL, or full request/exception objects. Wrap secrets at ingress, and use safe error summaries. The current required-auth middleware logs a cause object on `getSession` failure; new key middleware must not copy that pattern. Inspect logger/Sentry/local tracing capture on the new routes and prove redaction in tests, rather than rely on `Redacted` to protect an already-raw HTTP body.

Observe existing HTTP status/latency metrics plus low-cardinality credential-kind and denial-reason counters if supported. No new monitoring service or dashboard is required. Authentication/store failure fails closed; audit-sink failure may be logged safely and must not resurrect a key, expose a secret, or turn a committed revoke into an apparently uncommitted operation. No unowned detached promises.

### Explicit approval boundaries

The documents authorize no code or infrastructure action. Future implementation requires a separate instruction. Schema/migration work requires explicit approval and throwaway-D1 verification. Deployment and production key issuance require separate approval; publishing content is yet another explicit action. Do not run migration/deploy commands as a “check.” Local fixture tests use disposable users and secrets only. The fallback operational path remains an ordinary account session, not a production SQL bypass.
