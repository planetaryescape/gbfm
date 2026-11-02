# Personal access key operations

## Availability

This branch implements draft authoring and explicitly scoped publication. A read-only production check on 2026-11-02 confirmed that `0012_personal_access_keys.sql` was applied at `2026-11-01 19:46:14` UTC. Its recorded SHA-256 hash matches `apps/server/drizzle-d1/0012_personal_access_keys.sql`, and the `personal_access_keys` table exists. This check did not issue credentials, inspect key records, change data, or establish which API version is deployed.

The web app provides **Dashboard → Settings → API keys** at `/dashboard/api-keys` for creation, metadata listing and confirmed revocation. The UI has been verified locally, not deployed as part of this work. Creating a key opens a password-confirmation dialog, preserving the chosen name, scopes and expiry. Confirmation uses the existing email/password sign-in flow to establish a fresh session for the same account, then issues the key without signing out or leaving the page. Account changes and impersonated sessions are rejected. Passwords never enter Foldkit models, messages or command arguments, and the native password field is cleared on submission or dismissal. The backend still requires authoring access and a session created within the last ten minutes. Publication permission is offered only to editors and admins. The secret is shown once, with copy and dismissal controls; it stays outside Foldkit models, messages, SSR and browser storage, and is cleared when the page unmounts.

Only `dev` and `prod` stages issue or accept keys. An unsupported stage fails closed.

## Bootstrap

1. Sign in through the existing `/auth/sign-in/email` flow. Keep the returned session token out of command history and logs.
2. Within ten minutes, send `POST /api/user/api-keys` with that session bearer and JSON containing a UUID `requestId`, `name`, and nonempty `scopes`. Optional `expiresInSeconds` is an integer between 3,600 and 7,776,000; the default is thirty days.
3. Store the returned `secret` securely. It is returned once. Retrying the same issuance identity returns 409 with the existing key ID, never its secret. If the original response was lost, revoke that ID and issue with a new request ID.
4. Sign out using the session token. The personal key remains valid independently.

The available scopes are `posts:read`, `posts:create`, `posts:update`, and `posts:publish`. Publication scope must accompany create or update scope. Creators cannot issue publication scope. Impersonated sessions cannot issue keys. Browser-cookie mutations need a trusted Origin; non-browser session-bearer mutations can omit Origin.

## Authoring

Send only `Authorization: Bearer <personal-key>`, without session cookies or `x-api-key`.

| Method | Path | Capability |
| --- | --- | --- |
| GET | `/api/content/posts/manage` | Read owned posts |
| GET | `/api/content/posts/:slug/edit` | Read one owned post |
| POST | `/api/content/posts/preview` | Preview with create or update scope |
| POST | `/api/content/post` | Create with an explicit lowercase hyphen-separated slug |
| PATCH | `/api/content/posts/:slug` | Update an owned post |

Set `draft: true` explicitly for draft creation. Omitting it retains the existing public-create default and therefore requires publication permission. Changes to already-public posts, including unpublishing, require publication permission. Keys cannot change creators or post type. Music resolution and image issuance are excluded.

There are at most ten active keys per user/environment. Each key permits sixty authenticated requests per fixed minute; denied post actions also consume authenticated request quota. Respect `Retry-After` on 429.

## Rotation and revocation

Use a normal session to list `GET /api/user/api-keys` and revoke `DELETE /api/user/api-keys/:id`. Lists include retained expired/revoked metadata and support `limit`/`offset`. Revocation is idempotent for owned IDs. Other owners' IDs return 404.

Rotate by issuing a replacement, testing it against an owned read, switching the client, then revoking the old key. Revocation blocks subsequent authentications; it does not cancel requests already in flight. No background cleanup deletes replay identities.

## Local verification

Run from this worktree:

```sh
bun precommit
bun run --cwd apps/server test:unit
bun run --cwd apps/server test:d1
```

The D1 suite creates throwaway Miniflare databases. It does not apply migrations to a remote database. Remaining acceptance evidence is recorded in [Progress](PROGRESS.md).
