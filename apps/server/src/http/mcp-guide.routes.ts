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
- prepare_draft_image_upload: prepare a private JPEG, PNG or WebP upload for an authored
  unpublished editorial, with its latest expectedVersion, a new requestId, byte size
  and base64 Content-MD5. PUT the original bytes within five minutes using ALL returned
  headers. The signed URL is create-only and cannot overwrite an existing object.
  Exact retries return the original URL, never extend its expiry; changed retries conflict.
- attach_draft_artwork: attach completed uploads by their preparation requestIds.
  coverUploadRequestId sets the cover. banner: { uploadRequestId, alt } inserts or replaces
  the leading standalone Markdown image while preserving a leading ::layout directive.
  Both uploads must belong to this actor and draft and be less than 24 hours old.
  Requires the latest expectedVersion and a new edit requestId. Exact retries replay the
  saved result for 24 hours; changed retries conflict. Existing prose and later images stay intact.

Existing connections remain read-only. For draft-write access, request
posts:read drafts:write offline_access during authorization and approve fresh consent.
New registrations support that permission; an older read-only registration may need
to be replaced with a separate client registration. Refreshing a read-only token
does not add write access.
The token's granted scopes are authoritative. If an environment's resource policy
has not enabled a requested permission, authorization fails explicitly; signing
in again or refreshing a token cannot enable it. An operator must first apply an
approved, version-checked resource-policy rollout. Then request fresh consent
and verify the granted scopes and discovered tools. Existing tokens never expand.
Draft title and content must be nonblank. Content is limited to 100,000 characters,
title to 500 and description to 2,000.
The encoded draft-write request and every MCP response must also fit within 256 KiB;
read requests retain their 16 KiB limit. JSON escaping and multibyte text count toward
the byte limit, so a schema-valid draft can still be too large. Oversize bodies fail
explicitly without truncation. After an ambiguous write response, reconcile using
the same requestId, never a new create key.
Draft tools never publish, delete, change creators or edit published posts.
They do not control playback or access your private listening library.
Review and publishing stay in GBFM.

## Authored editorial editing, including live posts

The general tools require posts:read plus creator:write, not merely drafts:write:
- update_post: edit supplied title, content or description on an authored editorial.
- prepare_post_image_upload: prepare a checked, private, create-only original image upload.
- attach_post_artwork: attach the owned image receipts as cover and/or leading Markdown banner.

WARNING: edits to an already published editorial immediately affect live pages.
Each operation requires the exact postId, latest get_post expectedVersion and a new requestId.
Omitted prose fields stay unchanged; description:null clears it. No update parameter can
publish, unpublish, change creators, change type or mutate music/thread associations.
Micro posts are excluded. Existing draft tools remain draft-only, including on replay.
The general write envelope is bounded to 256 KiB.

Published artwork uses the existing deterministic public-copy flow; unpublished content
keeps private originals. A storage failure can occur after the edit commits. Retry the exact
same request to recover currently attached public copies without repeating the edit.
Previously public image bytes are permanent. Unpublishing does not revoke them.
The source, byte size, ownership, live authority and current attachment are checked;
an original saved result is not a current-state snapshot.

creator:write uses its existing explicit resource-policy and consent checks. Registration
does not enable that permission in production or upgrade any existing draft-only grant.

Tool discovery reflects the connection's current scopes and role on each request.
Remembered tool names do not authorize calls. Seven public-content reads are also
registered, but require content:read and a resource policy explicitly allowing it:
- list_published_posts: public editorial summaries only, never source bodies or micro posts.
- get_show: public show metadata by slug, without body rendering or media URLs.
- list_show_episodes: public audio metadata under a public show; private parents and
  children remain excluded from pages and counts. Audio IDs are not music-track IDs.
- search_catalogue: metadata search in one published audio/show/post namespace;
  page limits do not bound database matching, counting or sorting work.
- get_mix: published audio mix metadata, without body, media or related-show expansion.
- get_public_profile: public user or artist-DJ identity metadata with an explicit kind;
  user lookup takes precedence and banned users do not fall back to an artist.
- get_public_collection: published collection metadata and published same-owner saves;
  individual private saves stay excluded from pages and counts.
Lists default to 20 items, maximum 50, with offset up to 10,000. Reads are safe to
retry but pages are not snapshots across concurrent edits. A missing or private
show returns not_found. These reads perform no playback, seen-state or subscription writes.
Eligible listeners can authorize content:read without posts:read only where enabled.
Production allowedScopes is unchanged; registering these tools does not activate
content:read on a resource or add it to existing grants. Fresh consent and explicit
resource-policy authorization are separate requirements. Canonical-music catalogue
tools and read_micro_thread are not registered; thread privacy and playlist rendering
remain gated.

Six owner/admin reads are registered but require fresh consent and an explicitly
enabled resource policy; production allowedScopes remains unchanged:
- list_saved_mixes: your saved mix metadata and private notes; requires listening:read.
- list_collections: your collection metadata; requires listening:read.
- list_favorites: your favorites pointing to currently public audio; requires favorites:read.
- list_show_subscriptions: your subscriptions to currently public shows; requires subscriptions:read.
- list_music_reminders: your reminder summaries, without notes or source URLs; requires reminders:read.
- get_admin_overview: fixed draft/published publishing counts; requires admin:read and a current admin role.
These reads do not change library state or send notifications. Listening, favorite
and subscription commands are not registered, even with write grants.
Existing grants do not gain these permissions automatically. Admin access is checked
live; demotion, bans and connection revocation do not wait for token expiry.

## Private music reminders

Reminder commands require separately granted reminders:write:
- create_music_reminder: schedule a private reminder email to your own account.
- reschedule_music_reminder: change an unsent reminder's scheduled time.
- cancel_music_reminder: cancel before delivery may have started.

Ask the user for a date, time and timezone if they have not supplied them. Convert
the agreed time to a calendar-valid UTC reminderDate ending in Z. Never infer a
schedule from a listening intention alone. Owner and recipient come from the
authenticated account, not caller-supplied fields.

Save a UUIDv4 requestId and the exact input before each command. Identical retries
within 24 hours return the original receipt, even after a later edit or cancellation.
Changed input with the same key conflicts; expired keys never execute again.
Success acknowledges a durable schedule or cancellation, not email delivery.
Existing queue/sweep recovery remains at-least-once, so duplicate email is possible
after provider acceptance followed by a failed terminal write.

Reschedule and cancel require expectedRevision from the commandRevision observed
when reading the reminder. Stale intent conflicts; do not silently reread a revision
and retry the old command. A delivery_may_have_started conflict means cancellation
cannot promise recall. Cancellation retains a private tombstone.

Read and write permissions are independent. reminders:write does not grant
list_music_reminders. Registration does not change production resource policy or
existing grants; enable approved permissions explicitly, then obtain fresh consent.

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
