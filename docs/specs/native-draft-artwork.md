# Native draft artwork

Agents can edit authored editorials, including already published posts, and upload original raster artwork without editor interaction or storage credentials. Editing an already published post immediately affects live pages after deployment. These tools never publish or unpublish a post, change creators or modify thread/music associations.

## General editorial editing

General tools require current `posts:read` and the existing `creator:write` permission:

- `update_post(requestId, postId, expectedVersion, title?, content?, description?)` replaces supplied prose fields. Omitted fields are preserved; `description: null` clears it.
- `prepare_post_image_upload` uses the same upload fields and checked PUT flow described below, for either a published or unpublished editorial.
- `attach_post_artwork` uses the same cover/banner fields described below, preserving the post's publication state.

Explicit post ID, latest `get_post` version, ownership and a new operation UUID are sufficient. There is no extra live-edit flag. General tools support ordinary editorial posts, including legacy editorial rows with a null type, not micro posts. Micro/thread lifecycle capabilities remain separate.

The existing `update_draft`, `prepare_draft_image_upload` and `attach_draft_artwork` remain strictly draft-only under `posts:read` plus `drafts:write`, including on replay. Old draft grants never gain live-edit authority. `creator:write` requires explicit resource-policy enablement and fresh consent where not already granted; this implementation does not modify production policy or grants.

## Contract

1. Read `get_post` and keep its version.
2. Call `prepare_draft_image_upload` with a new UUIDv4 `requestId`, `postId`, `expectedVersion`, `fileName`, `contentType`, `fileSize`, and `contentMd5`. The checksum is the base64 MD5 of the original file bytes, not a hex string. Supported types are JPEG, PNG and WebP, up to 10 MiB.
3. PUT the original bytes to `upload.uploadUrl` with **every** returned `upload.headers` entry. Native clients must preserve Content-Length, Content-Type, Content-MD5, If-None-Match and the receipt metadata header. No OAuth bearer or application cookie belongs on this storage request.
4. Read `get_post` again if another edit may have happened. Call `attach_draft_artwork` with a new edit `requestId`, `postId`, the latest `expectedVersion`, and either or both:
   - `coverUploadRequestId`: the preparation request ID for the square cover.
   - `banner: { uploadRequestId, alt }`: the preparation request ID for the wide image and its single-line alt text.

Preparation leaves the post version unchanged. It returns a canonical original CDN URL and a five-minute, create-only PUT URL. Reusing the exact preparation request returns the original result, never a refreshed URL. After URL expiry it returns `expired`; prepare a new upload with a new request ID. A successful PUT followed by a lost acknowledgement may return 412 on retry because the original object already exists. Attempt the supported attachment operation to reconcile completion; it validates the object, size, receipt metadata and owned asset row. Do not delete or overwrite the object.

Attachment sets the existing `thumbnailUrl` for the cover. The banner inserts or replaces the first standalone Markdown image paragraph, after any leading `::layout{...}` directive. It preserves that directive, all other prose, and later images. A leading image with text/caption siblings is authored inline content, not a standalone banner: insertion prepends a new image without deleting that paragraph. It does not introduce a banner database field.

Validate the final composed source, after public-URL rewriting where applicable, against the shared canonical parser's UTF-8 byte, block, nesting and other limits before any coupled mutation. Editorial artwork edits allow a single leading `::layout{name="spotlight"}` control marker, not misplaced or repeated controls. The complete source, including that marker, still counts toward all limits. Invalid attributes and all unsupported-content diagnostics fail. Rich-content readers can treat that leading image as a wide banner and exclude it from intro prose.

Upload receipts are actor-bound and draft-bound, with a 24-hour attachment window. A draft cannot attach another actor's upload, an upload prepared for another draft, or an asset already assigned elsewhere. Cover and banner can use one receipt if deliberately requested. Replacing artwork creates a new immutable object; it does not overwrite earlier bytes or delete older assets.

## Retry and concurrency

The existing editorial operation ledger owns request identity and saved results. Actor/request IDs share its existing namespace, so reusing a text-edit request ID for artwork also conflicts.

- Changed preparation or attachment payloads with an already-used request ID return `conflict`.
- Stale versions do not mutate a draft or allocate a preparation receipt.
- Exact attachment retries return the original saved result for 24 hours, even after later edits.
- Expired operation tombstones never repeat a mutation.
- Draft tools require current authorization, authorship and unpublished editorial state for both execution and replay.
- General tools instead require current `creator:write` and authorship for execution/replay, preserving whichever publication state the full-snapshot CAS observed. Draft tools still require unpublished state.
- Post CAS, owned-asset transition and saved attachment result commit in one D1 batch behind live command authority.

Failed uploads or abandoned preparation can leave pending private assets. Upload-asset rows are bookkeeping for a future cleanup job, not an implemented reclamation process. Expiring an editorial receipt only clears its saved result; it does not delete upload-asset rows or stored objects. Abandoned uploads and replaced private originals are retained indefinitely today, including a possible new object on every replacement. Public copies also remain permanent.

Rollout must account for that accumulating storage usage. Orphan identification, reference-safe cleanup, retention policy and any deletion/GC implementation require an explicit follow-up and separate authorization. This feature implements no deletion, cleanup worker or schema migration.

## Published media delivery

Upload preparation always creates a private original, even for published posts. Attachment/prose editing uses the existing media-publication rules to derive canonical public copies for a published post. The original asset receipt stays attached to the private key; originals are not overwritten or made anonymously readable. Draft edits retain private URLs and create no public copies.

Commit the version-checked post, owned asset transitions and operation result in D1 first, then copy bytes through the existing storage adapter. A copy outage returns `unavailable` after a possible committed edit; it can temporarily leave a live page referencing an unavailable public image. Retry the exact same operation. Its original receipt repairs currently referenced public copies without repeating the edit or advancing its version.

Recovery rechecks live authority and authorship and copies only media still referenced by the current published post. It does not expose draft media or repair removed historical images. Replays remain historical saved results, not snapshots of current state. Authorship, publication state and attachment are checked immediately before each copy; a copy already in progress cannot be atomically revoked across D1 and R2. Existing public copies are permanent and unpublishing does not revoke shared image bytes. No post lifecycle transition is exposed by these tools.

## Image delivery scope

The 10 MiB limit is the shared storage limit, not a recommended banner transfer budget. Originals remain canonical and unchanged. This tool inserts a rich-content image and does not set the database banner field or itself provide responsive delivery. Only an explicitly opted-in reader that extracts the leading standalone image, as specified by the separate spotlight contract in #626, can render it through responsive artwork. That behavior depends on the matching reader change being deployed and active; banner-field-based presentation cannot discover this image automatically.

Without that opt-in extraction, the inserted banner is an ordinary inline image and follows the existing original-size delivery path at every breakpoint. Responsive ordinary-inline-image rendering remains explicitly deferred outside this server/tooling change. Generate appropriately compressed originals until that separate renderer work is approved.

## Verification and rollout

Local integration tests use disposable migrated D1 databases and native Miniflare R2 objects, not production content. Signing tests verify the integrity headers are cryptographically bound. These tests do not prove a deployed R2 S3 endpoint accepts the generated signature or exercise real CDN delivery.

Before enabling real use, review and explicitly approve deployment, then smoke-test the complete signed PUT and attachment against a disposable authored draft. Verify a second PUT cannot overwrite the original, the private preview renders, and the normal authorized publication flow preserves both images. No deployment, publication, production draft edit, migration or bucket-policy change is part of this implementation.
