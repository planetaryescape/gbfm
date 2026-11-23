# MCP publishing

The live registry exposes three creator commands:

- `create_micro_post`: publish one tweet as the authenticated creator.
- `reply_to_micro_post`: publish one reply to a public tweet. The server derives
  its thread root and depth.
- `publish_editorial`: publish an owned editorial draft at its observed version.

Deletion, unpublishing and mix/show metadata commands remain outside the live
registry.

## Consent

Tweets and replies require `micros:publish`. Editorial publishing requires
`posts:read`, `drafts:write` and `content:publish`. Deploying the code does not
enable these scopes or widen existing grants.

Use the existing [policy and connection upgrade workflow](mcp-permissions-rollout.md)
to enable the approved scope union in each environment. Preserve all previously
enabled scopes. The client must request the new scopes and complete fresh user
consent before rediscovering the tools. Refreshing an old token cannot add them.

This change does not activate production policy or publish existing content.

## Retry contract

Generate one UUIDv4 `requestId` per intended command and keep the original
arguments. After a lost response, retry that same request, including the original
`expectedVersion`. Do not generate another request ID to resolve an uncertain
outcome.

The shared D1 operation store scopes keys to the actor, client, resource and
operation. It fingerprints the normalized arguments. The domain write and
original receipt commit in one D1 batch; concurrent attempts cannot commit a
second logical post. Changed arguments conflict. Identical retries replay the
original acknowledgement, not a later view of the content. Current credentials,
permissions and ownership are checked again before replay.

Receipts can be replayed for 24 hours. After that, retained key tombstones reject
the command as expired rather than creating or publishing anything again.
Different request IDs represent different commands, even with identical prose.

This follows the stable request identity and commit-before-acknowledgement
principles in [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable).
There is no pi runtime dependency.

## Artwork recovery

Editorial publication validates private attachments through the existing media
publication service. Preparation reads metadata but copies no bytes. The guarded
D1 batch commits the public URLs and receipt together, only if the draft version
and live authority still match.

After commit, the service copies missing objects to deterministic public keys,
checking publication authority and current attachment before each copy. A failed
copy returns `unavailable`, not a successful completed command. The post transition
may already be committed at this point.

Retry the identical command within the receipt window. It replays the original
transition, then repairs missing copies from the persisted public attachments.
Existing destination objects are recognized by HEAD, including when a copy
succeeded but its response was lost. The post is not published again and its
version is not advanced by recovery.

The caller's explicit retry owns recovery. There is no automatic background
sweeper in this feature. A post can be publicly readable while a failed image
copy awaits repair. After the retry window, repair requires the existing
authorized browser media-edit flow; an expired command is never re-executed.
Public copies are permanent. Unpublishing content does not revoke those bytes.
