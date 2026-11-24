# MCP development handoff

An MCP change is not usable until the intended connection can discover and call it.
Own that handoff instead of asking the user to diagnose missing tools.

## Decide what changed

| Change | Required action |
| --- | --- |
| Code or tools using already granted scopes | Deploy and refresh tool discovery. No new consent. |
| Expired access token with a valid refresh token | Let the client refresh it. No scope expansion. |
| Added permissions | Check resource policy, request the approved scopes, and obtain fresh user consent. |
| Revoked or invalid credentials | Diagnose the reason and use the existing connection's sign-in flow. |
| Registration rejects the requested scope set | Confirm the registration restriction before proposing replacement. |

## Finish the work

1. Validate, atomically commit and push the authorized changes to `prod`.
2. Verify release and production deployment independently.
3. Inspect the live resource policy using `apps/server/scripts/mcp-resource-policy.ts`.
   For approved scope additions, preserve unrelated scopes and use its version-checked
   plan/apply flow. Registration alone does not enable permissions.
4. Preserve the existing OpenCode server name, URL, protocol and unrelated settings.
   Add only the approved scopes to `mcp.servers.gbfm.oauth.scope` when needed.
   Changing configuration does not upgrade an existing token.
5. Use reauthorization on the existing connection. In OpenCode, use the user-facing
   `/mcps` sign-in flow. Do not run interactive `opencode mcp auth` in an agent shell.
   The user may run `opencode mcp auth gbfm` themselves in their terminal.
   Do not delete the server configuration or log out as the first step.
   Before handing off a consent link, verify its `scope` parameter includes the
   approved additions. A loaded integration can still request old scopes after
   its configuration file changes. If they differ, refresh only that server's
   runtime configuration through the supported MCP management API, preserving
   credentials. Do not send the user through another flow requesting the old grant.
6. Have the user approve additional permissions through the secure consent UI.
   Reuse an existing browser session where possible; new consent need not mean
   entering a password again. Never approve on their behalf or surface credentials
   or callback codes in chat.
7. Refresh tool discovery and verify the expected tools on that actual connection.
   A connected status or an edited scope string does not prove upgraded consent.
   Prefer an authorized read for verification; do not create disposable production
   reminders, public posts or emails. Perform a real write only for complete,
   user-approved intent, with a saved retry identity.
8. Report code/deployment, policy, consent and tool availability separately.
   If the client cannot start reauthorization from the agent interface, give the
   user one precise consent action and identify the remaining blocker. Do not
   claim the capability is ready or repeatedly ask them to tear down the connection.

Refresh tokens cannot grant new permissions. If reauthorization returns
`invalid_scope`, check the resource policy, requested scopes, account eligibility
and client registration. Do not loop through deletion and new registration.
Replace a registration only for a confirmed restriction, with explicit approval.

## Sources

- [OpenCode MCP configuration, OAuth and management](https://opencode.ai/docs/mcp-servers)
- GBFM policy: `apps/server/src/services/mcp-resource-policy.ts`
- GBFM authorization: `apps/server/src/lib/editorial-oauth.ts`
- Live connection guide: `https://api.goosebumps.fm/mcp.txt`
