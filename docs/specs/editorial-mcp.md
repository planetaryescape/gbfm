# Personal editorial MCP

Issue: [#479](https://github.com/planetaryescape/gbfm/issues/479).

## Scope and delivery

The first release serves the GBFM user who signs in and approves the connection through standard Streamable HTTP. The AI client owns the conversation; GBFM exposes bounded editorial operations using that user's existing permissions. Local and production connections use separate credentials, authorization records and data. There is no fallback between environments.

The implementation targets MCP `2026-07-28` using the request-scoped HTTP transport in Effect `4.0.6`. Older client revisions are not a compatibility requirement. Cloud-hosted clients cannot access the local `.localhost` address; public tunnels are outside this release.

| PR | Delivered behavior | Dependencies |
| --- | --- | --- |
| 1 | User-authorized OAuth connection, independent disconnection, draft listing and post reading | None |
| 2 | Published catalogue search, music-entity lookup and selected editorial context | PR 1 |
| 3 | Retry-safe creation of unpublished editorial drafts | PR 1 |
| 4 | Retry-safe draft updates with caller-visible version checks | PR 3 |

Each PR includes its own behavior and integration evidence. Publishing, deleting, editing published posts, uploads, playback control and private listening-library operations are not included.

## Boundaries

```text
AI client
  -> HTTP admission and OAuth credential verification
  -> MCP schema decoding
  -> editorial operation with an authenticated principal
  -> existing services and authorized database queries
  -> structured result with environment, stable identity and review URL
```

Better Auth owns OAuth protocol validation and token issuance. GBFM checks the approving user's current editorial eligibility, connection authorization, per-operation permissions and content visibility. MCP is another interface, not a second editorial backend. OAuth credentials are not disguised as personal access keys or full-power browser sessions.

Browser login, consent and connection management use the existing WWW app. OAuth discovery and protocol endpoints route to the API. Public URL configuration, rather than arbitrary forwarded headers, determines issuer and resource identity.

## Read-only first slice

`list_drafts` returns a bounded page of authorized unpublished editorial posts. `get_post` retrieves a published editorial post or an authorized draft by stable post ID. Reads return an edit version for future write operations. Neither operation accepts publication changes or writes data.

Only these two tools belong in the first slice. A model instruction or a client approval dialog is never the authority that prevents publishing or private-content disclosure.

## Authentication invariants

- A missing or invalid bearer token cannot fall back to anonymous or browser-session access on `/mcp`.
- Authentication covers protocol discovery, tool listing and tool calls.
- Credentials are audience-bound to the configured MCP resource.
- The user who signs in and approves consent owns the grant; no deployment-level owner ID exists.
- Existing creator, editor or admin permission is required for editorial access. Banned and impersonated sessions cannot authorize connections.
- Drafts are restricted to the approving user's authored content, even for admins. Existing published-post visibility remains unchanged.
- Current account eligibility and connection state are checked on protected requests.
- Disconnecting one client prevents its next protected request without disconnecting another client or another user's connection to the same client. Signed-in users can manage their own connections even after losing editorial permission.
- Removing consent alone is not token revocation.
- Refresh, disconnect and reconnect interleavings must not restore a revoked grant.
- Consent explicitly describes read-only access. Later write access requires a separate permission grant.
- Credentials, authorization codes, signed OAuth query strings and private post bodies do not belong in logs or public screenshots.

## Later write contracts

These are design requirements for PRs 3 and 4, not claims about the read-only slice:

```text
create_draft(operationId, draft)
  -> receipt(postId, version, reviewUrl)

update_draft(operationId, postId, expectedVersion, changes)
  -> receipt(postId, version, reviewUrl)
```

Persist operation identity and a canonical input fingerprint at the authoritative database boundary. Identical retries return the original committed receipt; reuse with different input is a conflict. Do not use a transport request ID as the sole operation identity.

Commit the draft and all related database writes together with the receipt. A disconnected caller may have a committed write, so a timeout is not evidence of failure. Replay checks current authorization before exposing a private result.

Updates compare the caller's original version and atomically require that the post remains a draft and the actor remains authorized. A freshly loaded server version is not a substitute. Browser edits and other writers must preserve the chosen version invariant. A stale edit changes neither the post nor its related labels and attachments.

Ordinary D1 atomic writes should own these saves. A workflow engine or `waitUntil` does not improve this single-database boundary. Future long-running imports need a separate durable-job contract.

## Verification and operational safety

Use migrated disposable D1 databases for OAuth and persistence tests. Exercise real HTTP/protocol boundaries for token challenges, discovery and tool calls. Test refresh/revocation interleavings rather than treating an isolated token lookup as proof of safe disconnection.

Browser evidence must use disposable accounts and content. Do not take over an existing Portless alias or the default development API port. Start a separately named local frontend and explicitly selected backend ports when testing this worktree. Keep TLS verification enabled.

Required checks include relevant server and WWW tests, the WWW production build, and `bun precommit`. Opening a PR does not authorize deployment or production migration execution.

## Configuration and connection

Public, plain-text connection instructions are served at `/mcp.txt` on both the
website and API origins. The guide uses the configured MCP resource and frontend
URLs, includes an on-demand OpenCode V2 configuration, and describes the current
read-only tools, OAuth requirements and protocol compatibility. It requires no
authentication and advertises no connection URL when MCP is unavailable (HTTP 503).

MCP derives its resource (`/mcp`) and issuer (`/auth`) from runtime configuration (`urls.share`) through the existing `SHARE_URL` binding. For deployed Workers, Alchemy's `Worker.URL` supplies the actual API endpoint: the existing canonical custom domain in production and the generated Workers endpoint in non-production. Deployed non-production APIs receive `FRONTEND_URL` from the website Worker's actual URL through an Alchemy binding. Production keeps its existing canonical frontend. No new custom-domain routes, MCP-specific deployment variables or account IDs are needed.

Alchemy local development fixes both bindings to `https://gbfm.localhost`, whose proxy forwards MCP and OAuth endpoints to the local API. It does not automatically derive a worktree-prefixed origin. The isolated browser fixture supports a separately supplied Portless frontend address.

Plain HTTP loopback development leaves MCP disabled. An invalid API origin disables MCP, logs only the configuration field name and makes `/mcp` return 503 without preventing unrelated routes, queue consumers or scheduled jobs from starting.

Signed-in users can still list and revoke their own existing connections while MCP is disabled or misconfigured. Revocation persists when configuration is restored; disabling MCP does not postpone disconnection.

| Environment | Resource |
| --- | --- |
| Normal local development | `https://gbfm.localhost/mcp` |
| Alchemy in a worktree | `https://gbfm.localhost/mcp`, not automatically worktree-prefixed |
| Isolated browser fixture | Its explicitly supplied Portless frontend address plus `/mcp` |
| Deployed non-production | The API Worker's deployed URL plus `/mcp` |
| Production | `https://api.goosebumps.fm/mcp` |

Sign in with an existing creator, editor or admin account in the matching database. Consent binds the grant to that signed-in user, and each protected request rechecks current permissions and account state. Each user sees and disconnects only their own approved applications.

After the approved migration has been verified and the environment configured, add separate OpenCode connections:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "gbfm-local": {
        "type": "remote",
        "url": "https://gbfm.localhost/mcp",
        "protocol": "2026-07-28"
      },
      "gbfm-production": {
        "type": "remote",
        "url": "https://api.goosebumps.fm/mcp",
        "protocol": "2026-07-28"
      }
    }
  }
}
```

Use OpenCode's `/mcps` interface to sign in to each connection. Other clients need Streamable HTTP, the selected protocol revision, and OAuth public-native-client support. Public dynamic registration is bounded and database-rate-limited; client metadata document discovery and confidential clients are not advertised by this slice.

For local TLS, configure the client runtime to trust the existing Portless CA. Do not disable certificate validation. Signing in to local does not authorize production, or vice versa. Manage approved applications at `/dashboard/connections`.

## Isolated browser fixture

`apps/server/scripts/editorial-mcp-e2e.ts` creates a disposable migrated D1 database, seeds local fixture users and an editorial draft, and serves only on loopback. It does not connect to a persistent development or production database.

Choose an unused API port and obtain a dedicated Portless address with `bunx portless get mcp-479` from `apps/www`. Use that address as `FRONTEND_URL` when starting `bun run dev:mcp:e2e` in `apps/server`. Start Vite through the corresponding dedicated Portless name with `VPS_PROXY_TARGET` set to that API port. Do not start the default Playwright-managed servers if another application is already using their ports.

The fixture's `/api/e2e/mcp-start` path begins an actual PKCE flow. Its loopback callback exchanges the code and lists MCP tools in memory without displaying credentials. Only disposable fixture data should be captured as test evidence.
