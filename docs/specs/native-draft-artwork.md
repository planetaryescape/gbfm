# Native draft artwork

Agents can upload original raster artwork and attach it to their own unpublished editorial without editor interaction or storage credentials. This extends the existing `posts:read` and `drafts:write` authorization. It does not add a publication capability.

## Contract

1. Read `get_post` and keep its version.
2. Call `prepare_draft_image_upload` with a new UUIDv4 `requestId`, `postId`, `expectedVersion`, `fileName`, `contentType`, `fileSize`, and `contentMd5`. The checksum is the base64 MD5 of the original file bytes, not a hex string. Supported types are JPEG, PNG and WebP, up to 10 MiB.
3. PUT the original bytes to `upload.uploadUrl` with **every** returned `upload.headers` entry. Native clients must preserve Content-Length, Content-Type, Content-MD5, If-None-Match and the receipt metadata header. No OAuth bearer or application cookie belongs on this storage request.
4. Read `get_post` again if another edit may have happened. Call `attach_draft_artwork` with a new edit `requestId`, `postId`, the latest `expectedVersion`, and either or both:
   - `coverUploadRequestId`: the preparation request ID for the square cover.
   - `banner: { uploadRequestId, alt }`: the preparation request ID for the wide image and its single-line alt text.

Preparation leaves the post version unchanged. It returns a canonical original CDN URL and a five-minute, create-only PUT URL. Reusing the exact preparation request returns the original result, never a refreshed URL. After URL expiry it returns `expired`; prepare a new upload with a new request ID. A successful PUT followed by a lost acknowledgement may return 412 on retry because the original object already exists. Attempt the supported attachment operation to reconcile completion; it validates the object, size, receipt metadata and owned asset row. Do not delete or overwrite the object.

Attachment sets the existing `thumbnailUrl` for the cover. The banner inserts or replaces the first standalone Markdown image paragraph, after any leading `::layout{...}` directive. It preserves that directive, all other prose, and later images. It does not change the existing database `bannerImageUrl` field. It validates the generated image fragment without reinterpreting or migrating previously saved prose. Rich-content readers can treat that leading image as a wide banner and exclude it from intro prose.

Upload receipts are actor-bound and draft-bound, with a 24-hour attachment window. A draft cannot attach another actor's upload, an upload prepared for another draft, or an asset already assigned elsewhere. Cover and banner can use one receipt if deliberately requested. Replacing artwork creates a new immutable object; it does not overwrite earlier bytes or delete older assets.

## Retry and concurrency

The existing editorial operation ledger owns request identity and saved results. Actor/request IDs share its existing namespace, so reusing a text-edit request ID for artwork also conflicts.

- Changed preparation or attachment payloads with an already-used request ID return `conflict`.
- Stale versions do not mutate a draft or allocate a preparation receipt.
- Exact attachment retries return the original saved result for 24 hours, even after later edits.
- Expired operation tombstones never repeat a mutation.
- Current authorization, authorship and unpublished editorial state are required for both execution and replay.
- Post CAS, owned-asset transition and saved attachment result commit in one D1 batch behind live command authority.

Failed uploads or abandoned preparation can leave pending private assets. Existing cleanup bookkeeping owns these orphans. This feature adds no cleanup worker or schema migration.

## Verification and rollout

Local integration tests use disposable migrated D1 databases and native Miniflare R2 objects, not production content. Signing tests verify the integrity headers are cryptographically bound. These tests do not prove a deployed R2 S3 endpoint accepts the generated signature or exercise real CDN delivery.

Before enabling real use, review and explicitly approve deployment, then smoke-test the complete signed PUT and attachment against a disposable authored draft. Verify a second PUT cannot overwrite the original, the private preview renders, and the normal authorized publication flow preserves both images. No deployment, publication, production draft edit, migration or bucket-policy change is part of this implementation.
