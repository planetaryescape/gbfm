import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

import { ConfigService } from '@/services/config.service'

export const McpGuideRoutesLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ConfigService
    const settings = config.mcp

    if (!settings)
      return HttpRouter.add(
        'GET',
        '/mcp.txt',
        HttpServerResponse.text(
          'GBFM editorial MCP is unavailable in this environment. No connection URL is advertised.\n',
          { status: 503, headers: { 'cache-control': 'no-store' } },
        ),
      )

    const openCode = JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          servers: {
            gbfm: {
              type: 'remote',
              url: settings.resourceUrl,
              protocol: '2026-07-28',
              disabled: true,
            },
          },
        },
      },
      null,
      2,
    )

    const guide = `# Connect to GBFM editorial MCP

Server URL: ${settings.resourceUrl}
Transport: Streamable HTTP
Required MCP protocol revision: 2026-07-28
Authorization: OAuth 2.1 public client with PKCE and dynamic client registration
Scope: posts:read
Optional draft-write scope: drafts:write (fresh authorization and consent required)

## Access

Sign in with your GBFM creator, editor or admin account and approve read-only access.
The connection belongs to the account that approves it. Draft access is limited to
that account's authored posts, including for admins. Published posts retain their
existing visibility rules. Account eligibility is checked on protected requests.
Browser sessions and personal API keys cannot replace MCP OAuth credentials.
Never paste passwords, tokens or authorization codes into a chat or config file.

## OpenCode V2

Merge this entry into mcp.servers in ~/.config/opencode/opencode.json(c), preserving
your other settings. It starts disconnected so you can connect only when needed.

\`\`\`json
${openCode}
\`\`\`

Run /mcps, select gbfm, connect and complete the browser sign-in and consent flow.
No restart is required. To verify, ask: "List my GBFM editorial drafts."

## Available tools

- list_drafts: a bounded page of your authored, unpublished editorial posts.
- get_post: read a post by stable postId, subject to existing visibility rules.
- create_draft: create your own unpublished editorial draft with title, content and optional description.
  Requires drafts:write. Supply a new UUIDv4 requestId per draft and reuse it after a timeout.
  Identical retries within 24 hours replay the original saved result, even after later edits.
  Changed payloads conflict. Expired retries return expired and never create another draft.
- update_draft: change title, content or description of your own unpublished editorial draft.
  Requires drafts:write, a new UUIDv4 requestId per edit and the latest get_post version in
  expectedVersion. Omitted fields are preserved; description: null clears it. After a timeout,
  reuse the exact request within 24 hours to replay its saved result. A new edit requires a new requestId.
  Conflicts require rereading, not blind retries. Replayed results describe the original save,
  not the current draft; use get_post before starting another edit.

Existing connections remain read-only. For draft-write access, request
posts:read drafts:write offline_access during authorization and approve fresh consent.
New registrations support that permission; an older read-only registration may need
to be replaced with a separate client registration. Refreshing a read-only token
does not add write access.
The token's granted scopes are authoritative: an environment whose resource policy
is still read-only can reduce a write request to read-only access.
Draft title and content must be nonblank. Content is limited to 100,000 characters,
title to 500 and description to 2,000.
The encoded draft-write request and every MCP response must also fit within 256 KiB;
read requests retain their 16 KiB limit. JSON escaping and multibyte text count toward
the byte limit, so a schema-valid draft can still be too large. Oversize bodies fail
explicitly without truncation. After an ambiguous write response, reconcile using
the same requestId, never a new create key.
Draft tools never publish, delete, change creators, change media or edit published posts.
They do not control playback or access your private listening library.
Review and publishing stay in GBFM.

Tool discovery reflects the connection's current scopes and role on each request.
Remembered tool names do not authorize calls. Three public-content reads are also
registered, but require content:read and a resource policy explicitly allowing it:
- list_published_posts: public editorial summaries only, never source bodies or micro posts.
- get_show: public show metadata by slug, without body rendering or media URLs.
- list_show_episodes: public audio metadata under a public show; private parents and
  children remain excluded from pages and counts. Audio IDs are not music-track IDs.
Lists default to 20 items, maximum 50, with offset up to 10,000. Reads are safe to
retry but pages are not snapshots across concurrent edits. A missing or private
show returns not_found. These reads perform no playback, seen-state or subscription writes.
Eligible listeners can authorize content:read without posts:read only where enabled.
Production allowedScopes is unchanged; registering these tools does not activate
content:read on a resource or add it to existing grants. Fresh consent and explicit
resource-policy authorization are separate requirements. No catalogue toolkit or
other public-content reads are registered by this slice.

## Other clients, including Claude Code

Use the server URL above only with a client that supports Streamable HTTP, OAuth
public-client PKCE with dynamic registration, and MCP revision 2026-07-28. Older
protocol revisions are not supported. This guide does not claim compatibility
with clients that cannot select or negotiate that revision.

## Disconnect and environments

Manage and revoke your approved applications at:
${new URL('/dashboard/connections', config.urls.frontend).href}

Revoking one application does not disconnect another. Disconnecting in the client
is not a substitute for revoking its GBFM authorization.
Local, preview and production connections have separate accounts, grants and data.
Use separate client entries for each environment; there is no fallback between them.
Local .localhost addresses require a client on your machine and trust in the local
Portless CA. Do not disable TLS certificate verification or expose local data via a tunnel.
`

    return HttpRouter.add(
      'GET',
      '/mcp.txt',
      HttpServerResponse.text(guide, { headers: { 'cache-control': 'no-store' } }),
    )
  }),
)
