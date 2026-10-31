# Personal access keys for GBFM

Status: **Proposed, not implemented or owner-approved**. Specification completed 2026-10-30 against `prod` at `c7773aebd24e4699b0d4909220db1d28280760cd`. Working-tree mobile changes were present and are not treated as shipped behavior.

## Summary

Let a person delegate a small set of GBFM authoring actions to a script or agent using a revocable personal access key. The key belongs to an existing user. Posts remain authored by that user; the credential identifies which automation acted. Reuse existing content HTTP APIs, with an explicit key allowlist, rather than browser automation, fake sessions, or new bot users.

Read [shape](01-shape.md), [decision record](02-alternatives.md), [contracts](03-contracts.md), [authorization matrix](authorization-matrix.md), [flows](04-flows.md), [file map](05-file-map.md), [tests](06-test-plan.md), then [delivery slices](07-pr-slices.md). [Progress](PROGRESS.md) records document verification, not feature delivery.

## Problem and callers

The motivating request was to publish a tweet in production as `guidefari`. Browser sign-in and local credential tooling were unavailable. A personal key removes the browser dependency **after authorized issuance**. It cannot prove identity or recover access when neither a valid session nor account credentials are available.

Primary callers are a trusted local script, agent, or personal automation. A human retains account ownership, selects permissions and expiry, and can revoke each automation independently. This is not a public third-party OAuth platform.

## Current state: inspected evidence

| Fact | Evidence |
| --- | --- |
| Better Auth 1.7.12 uses the Drizzle SQLite adapter, email/password, username, admin, and bearer plugins | [auth.ts](../../../apps/server/src/lib/auth.ts), [server package](../../../apps/server/package.json) |
| Bearer authentication already supports non-browser **sessions**, but not durable scoped personal keys | [auth middleware](../../../apps/server/src/middleware/auth.impl.ts), installed `better-auth/dist/plugins/bearer/index.mjs` |
| Authenticated handlers receive `AuthSession.user` and a required session ID | [API middleware](../../../packages/api/src/middleware/auth.ts) |
| Session cache is disabled so revocations and role changes are checked on later requests | [auth.ts](../../../apps/server/src/lib/auth.ts) |
| Creation and preview require creator-or-higher, but create has no separate publish check | [post handlers](../../../apps/server/src/http/post.handlers.ts), [roles](../../../packages/core/src/roles/index.ts) |
| Omitted `draft` means published; media publication also defaults it to false | [content defaults](../../../apps/server/src/db/util.ts), [media publication](../../../apps/server/src/services/media-publication.ts) |
| Updates authorize a current creator relation or admin, without a separate role/publish check | [post service](../../../apps/server/src/services/post.service.ts), [authorization](../../../apps/server/src/lib/authorization.ts) |
| `creatorIds` can change authorship; replies have a separate authenticated path with no creator-role gate | [post API](../../../packages/api/src/post.ts), post handlers and service |
| Resolving music on a saved post mutates its attachment and can create/enrich shared catalog entities | [post music resolution](../../../apps/server/src/services/post-music-resolution.ts) |
| Private images use owner-scoped presigned PUTs; publication can copy them permanently to public storage | [upload handlers](../../../apps/server/src/http/upload.handlers.ts), media publication |
| Optional navigation identity falls back to anonymous state | [optional auth](../../../apps/server/src/middleware/optional-auth.impl.ts) |
| Worker requests use D1; rate limiting is currently assigned to edge rules rather than a general application limiter | [DB layer](../../../apps/server/src/db/layer.ts), [global middleware](../../../apps/server/src/http/global-middleware.ts) |

Permission declarations in [auth-permissions.ts](../../../apps/server/src/lib/auth-permissions.ts) do not prove handler enforcement. The matrix distinguishes observed behavior from the new key policy. Older README architecture and parts of the rich-content spec are historical, not authority for runtime design.

## Goals

- Create a draft or publish a tweet as the key owner, without a browser during ordinary use.
- Support private authoring reads, previews, updates, post-scoped music resolution, and image presigning through explicit scopes.
- Require valid credential, endpoint permission, current role, and current ownership together.
- Make loss, expiry, revocation, environment mismatch, and ambiguous retries predictable.
- Keep one Worker, D1, Effect services, existing content schemas, and existing browser/mobile sessions.

## Non-goals

- OAuth apps, organization keys, service accounts, wildcard/admin keys, key chaining, impersonation, or account recovery.
- Keys for email, users, moderation, music administration, audio uploads, replies, subscriptions, or reading history.
- A web/mobile key-management UI, a general CLI framework, or automatic secret-manager integration.
- Changing session users' publish rules in this feature. That existing policy gap needs its own approval and regression review.
- Exactly-once post/media/provider execution or a new distributed job platform.

## Invariants

1. A key is a credential, never a user or session. No synthetic session ID.
2. No stored plaintext secret, secret recovery endpoint, or secret-bearing telemetry.
3. A key never gains authority from a cookie, admin role alone, or possession of a resource ID.
4. New endpoints reject keys unless explicitly opted in. This includes routes outside `HttpApi`.
5. Session request behavior and existing content response shapes remain intact.
6. Metadata is not authority until parsed from primary D1 and checked against the current user.
7. Spec completion is not approval to implement, migrate, deploy, issue a key, or publish content.

## Resolved assumptions

These are design defaults chosen without a feedback round, not claims about user preferences:

| Assumption | Resolution and reason |
| --- | --- |
| How broad is a personal key? | Own posts only, including admin-owned keys. This limits credential theft without adding admin scopes. |
| Who may publish with a key? | Current editor/admin with `posts:publish`; creator keys are draft-only. This matches declared publish intent without silently changing session behavior. |
| How long does a key last? | Default 30 days, selectable 1 hour through 90 days; no non-expiring key. Rotation is create then revoke. |
| How many keys? | At most 10 active keys per owner per environment, atomically enforced. |
| Which environments? | `prod` and `dev`; local development is `dev` with a separate local DB. Other stages cannot issue or accept keys until explicitly mapped. |
| Initial account state? | No assumption that `guidefari` currently has publishing rights or usable credentials. Issuance reads the real current role. |
| Is email verification newly required? | No. Existing email/password auth does not require it; active, non-banned account and a recent real session are sufficient. |
| Must all keys support music/images? | No. Extra scopes are opt-in; text-only publishing needs only `posts:create` and `posts:publish`. |

No unanswered product question blocks this proposed design. Runtime verification of the new behavior remains future work, explicitly listed in the test plan. If an implementation cannot meet a contract, revise the proposal rather than quietly weakening it.
