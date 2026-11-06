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

This connection cannot create, edit, publish or delete posts, upload files, control
playback or access your private listening library. Review and publishing stay in GBFM.

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
