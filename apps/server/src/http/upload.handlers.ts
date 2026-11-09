import { Api } from '@gbfm/api/api'
import { FileTooLargeError } from '@gbfm/api/errors'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { createPreviewGrant, isPrivateMediaPath, PREVIEW_TTL_MS } from '@gbfm/core/media-preview'
import { eq } from 'drizzle-orm'
import { Clock, Effect, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { audioCreators, audioTable } from '@/db/audio.schema'
import { Database } from '@/db/layer'
import { musicLabelCreatorsTable } from '@/db/music-entity.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { releasesTable } from '@/db/release.schema'
import { showCreators, showsTable } from '@/db/show.schema'
import { dieOnS3Error as makeDieOnS3Error } from '@/http/handler-utils'
import { ConfigService } from '@/services/config.service'
import { attachedMediaUrls } from '@/services/media-publication'
import { S3Service } from '@/services/s3.service'
import { UploadAssetService } from '@/services/upload-asset.service'
import {
  buildImageObjectKey,
  buildObjectKey,
  CHUNK_SIZE,
  expectedMultipartPartSize,
  expectedSizeFromKey,
  hasContiguousUploadParts,
  hasValidMultipartParts,
  matchesCompletedObject,
  MAX_AUDIO_SIZE,
  MAX_IMAGE_SIZE,
  ownsUploadKey,
  PENDING_ASSET_EXPIRY_SECONDS,
  PRESIGNED_IMAGE_URL_EXPIRY_SECONDS,
  PRESIGNED_PART_URL_EXPIRY_SECONDS,
  sanitizeKeySegment,
} from '@/services/upload-policy'

export { expectedMultipartPartSize, matchesCompletedObject } from '@/services/upload-policy'

const dieOnS3Error = makeDieOnS3Error('upload')

// Best-effort: a failure recording lifecycle state must never fail the
// upload/save request it's attached to (see upload-asset.service.ts's
// top-of-file comment) -- logged and swallowed rather than dying or
// propagating, since this table is a future cleanup job's bookkeeping, not
// part of the upload's own correctness.
const recordAssetLifecycle = <A>(effect: Effect.Effect<A, { readonly _tag: 'DatabaseError' }>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchTag('DatabaseError', (cause) =>
      Effect.logError('[upload] failed to record upload_assets lifecycle state', cause),
    ),
  )

export const assertKeyOwnership = (userId: string, key: string) =>
  ownsUploadKey(userId, key) ? Effect.void : new HttpApiError.BadRequest()

export const assertContiguousParts = (parts: ReadonlyArray<{ partNumber: number }>) =>
  hasContiguousUploadParts(parts) ? null : new HttpApiError.BadRequest()

export const validateMultipartParts = (
  expectedSize: number,
  parts: ReadonlyArray<{ partNumber: number; size: number }>,
) => (hasValidMultipartParts(expectedSize, parts) ? null : new HttpApiError.BadRequest())

const requireExpectedSize = (userId: string, key: string) => {
  const expectedSize = expectedSizeFromKey(userId, key)

  return expectedSize === null
    ? Effect.fail(new HttpApiError.BadRequest())
    : Effect.succeed(expectedSize)
}

export const UploadHandlersLive = HttpApiBuilder.group(Api, 'upload', (handlers) =>
  handlers
    .handle('previewMedia', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const config = yield* ConfigService

        const url = yield* Effect.try({
          try: () => new URL(payload.url),
          catch: () => new HttpApiError.BadRequest(),
        })

        const cdn = new URL(config.urls.bucketRouter)

        if (
          url.origin !== cdn.origin ||
          url.username ||
          url.password ||
          url.hash ||
          !isPrivateMediaPath(url.pathname) ||
          !url.pathname.startsWith('/user-content/private/')
        )
          return yield* new HttpApiError.BadRequest()

        const owned = url.pathname.startsWith(
          `/user-content/private/${sanitizeKeySegment(user.id)}/`,
        )

        if (!owned && user.role !== 'admin') {
          const db = yield* Database
          const canonicalUrl = `${url.origin}${url.pathname}`

          const allowed = yield* Effect.tryPromise({
            try: async () => {
              const [audio, posts, shows, releases] = await Promise.all([
                db
                  .select({
                    url: audioTable.url,
                    thumbnailUrl: audioTable.thumbnailUrl,
                    bannerImageUrl: audioTable.bannerImageUrl,
                    content: audioTable.content,
                  })
                  .from(audioTable)
                  .innerJoin(audioCreators, eq(audioCreators.audioId, audioTable.id))
                  .where(eq(audioCreators.creatorId, user.id)),
                db
                  .select({
                    thumbnailUrl: postsTable.thumbnailUrl,
                    bannerImageUrl: postsTable.bannerImageUrl,
                    content: postsTable.content,
                  })
                  .from(postsTable)
                  .innerJoin(postCreators, eq(postCreators.postId, postsTable.id))
                  .where(eq(postCreators.creatorId, user.id)),
                db
                  .select({
                    thumbnailUrl: showsTable.thumbnailUrl,
                    bannerImageUrl: showsTable.bannerImageUrl,
                    content: showsTable.content,
                  })
                  .from(showsTable)
                  .innerJoin(showCreators, eq(showCreators.showId, showsTable.id))
                  .where(eq(showCreators.creatorId, user.id)),
                db
                  .select({
                    thumbnailUrl: releasesTable.thumbnailUrl,
                    bannerImageUrl: releasesTable.bannerImageUrl,
                    content: releasesTable.content,
                  })
                  .from(releasesTable)
                  .innerJoin(
                    musicLabelCreatorsTable,
                    eq(musicLabelCreatorsTable.labelId, releasesTable.labelId),
                  )
                  .where(eq(musicLabelCreatorsTable.creatorId, user.id)),
              ])

              // An episode's caller-supplied showId is not authority over private show artwork.
              return [...audio, ...posts, ...shows, ...releases].some((item) =>
                attachedMediaUrls(item).some(
                  (reference) => reference === canonicalUrl || reference === url.pathname,
                ),
              )
            },
            catch: () => new HttpApiError.ServiceUnavailable(),
          })

          if (!allowed) return yield* new HttpApiError.Forbidden()
        }

        const secret = config.mediaPreviewKey

        if (!secret) return yield* new HttpApiError.ServiceUnavailable()
        const expiresAt = (yield* Clock.currentTimeMillis) + PREVIEW_TTL_MS

        const grant = yield* Effect.tryPromise({
          try: () =>
            createPreviewGrant(
              { path: url.pathname, audience: cdn.origin, expiresAt },
              Redacted.value(secret),
            ),
          catch: () => new HttpApiError.ServiceUnavailable(),
        })

        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json({
            sessionUrl: new URL('/preview-session', cdn).href,
            grant,
            expiresAt,
          }).pipe(Effect.orDie),
          'cache-control',
          'private, no-store',
        )
      }),
    )
    // Images are a single PUT (no chunking, no multipart session) -- the
    // browser asks for a presigned URL scoped to a key it doesn't control,
    // then PUTs bytes straight to S3. Unlike the old uploadFile proxy, this
    // requires a session: the presigned URL is generated server-side under
    // the caller's own userId-prefixed key, so an unauthenticated caller has
    // no key to even ask for.
    //
    // No separate "confirm" endpoint: an image PUT is one request with no
    // resumability to reconcile (contrast the multipart-audio path, where
    // completeMultipartUpload has real work to do -- verifying parts/etags
    // against S3's own bookkeeping). The upload_assets row this creates
    // starts at `pending` and is never flipped to `uploaded` by this handler;
    // it moves straight to `attached` when the caller's own follow-up write
    // (saving an audio/post/etc. record with this key as its url or
    // thumbnailUrl) succeeds -- see audio.service.ts's createEffect. A
    // `pending` row that never gets attached (PUT failed, or the content save
    // never happened) is exactly what the future cleanup job is for; this
    // task doesn't distinguish "PUT never happened" from "PUT happened but
    // nothing referenced it yet" since neither S3 event notifications nor a
    // client-reported confirm step are in scope here (see PR body).
    .handle('presignImage', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        if (payload.fileSize > MAX_IMAGE_SIZE) {
          return yield* new FileTooLargeError({
            message: `File too large. Maximum size is ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`,
            maxBytes: MAX_IMAGE_SIZE,
          })
        }

        const key = buildImageObjectKey(user.id, payload.fileName, crypto.randomUUID())

        const config = yield* ConfigService
        const s3Service = yield* S3Service

        const uploadUrl = yield* dieOnS3Error(
          s3Service.presignPutObject(
            key,
            payload.contentType,
            config.buckets.userContent,
            PRESIGNED_IMAGE_URL_EXPIRY_SECONDS,
          ),
        )

        const uploadAssetService = yield* UploadAssetService
        yield* recordAssetLifecycle(
          uploadAssetService.createPending({
            userId: user.id,
            key,
            bucket: config.buckets.userContent,
            assetType: 'image',
            expectedSize: payload.fileSize,
            expiresInSeconds: PENDING_ASSET_EXPIRY_SECONDS,
          }),
        )

        return {
          uploadUrl,
          publicUrl: `${config.urls.bucketRouter}/user-content/${key}`,
          key,
          expiresInSeconds: PRESIGNED_IMAGE_URL_EXPIRY_SECONDS,
        }
      }).pipe(
        Effect.withSpan('api.upload.image.presign', {
          attributes: { fileSize: payload.fileSize },
        }),
      ),
    )
    .handle('initMultipartUpload', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        if (payload.fileSize > MAX_AUDIO_SIZE) {
          return yield* new FileTooLargeError({
            message: `File too large. Maximum size is ${MAX_AUDIO_SIZE / (1024 * 1024)}MB`,
            maxBytes: MAX_AUDIO_SIZE,
          })
        }

        const key = buildObjectKey(
          user.id,
          payload.fileType,
          payload.fileName,
          payload.fileSize,
          crypto.randomUUID(),
        )

        const config = yield* ConfigService
        const s3Service = yield* S3Service

        const upload = yield* dieOnS3Error(
          s3Service.createMultipartUpload(
            key,
            payload.contentType,
            payload.fileSize,
            config.buckets.userContent,
          ),
        )

        const uploadAssetService = yield* UploadAssetService
        yield* recordAssetLifecycle(
          uploadAssetService.createPending({
            userId: user.id,
            key: upload.key,
            bucket: config.buckets.userContent,
            assetType: 'audio',
            uploadId: upload.uploadId,
            expectedSize: payload.fileSize,
            expiresInSeconds: PENDING_ASSET_EXPIRY_SECONDS,
          }),
        )

        return { uploadId: upload.uploadId, key: upload.key, chunkSize: CHUNK_SIZE }
      }).pipe(
        Effect.withSpan('api.upload.multipart.init', {
          attributes: { fileType: payload.fileType, fileSize: payload.fileSize },
        }),
      ),
    )
    .handle('presignMultipartPart', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { key, uploadId, partNumber } = payload

        yield* assertKeyOwnership(user.id, key)
        const expectedSize = yield* requireExpectedSize(user.id, key)

        // Only partNumber is checked here -- actual byte size can't be
        // validated at presign time since the client hasn't PUT the bytes
        // to S3 yet (this just mints the URL). A client can still push an
        // oversized part straight to S3 after presigning; that garbage
        // isn't reachable (the object never becomes readable pre-completion)
        // and completeMultipartUpload below re-validates every part's real
        // S3-reported size via listMultipartParts + validateMultipartParts,
        // rejecting the whole upload on any mismatch. Worst case is
        // billable-but-unreadable storage until the bucket's abort-
        // incomplete-multipart-upload lifecycle rule reaps it.
        if (expectedMultipartPartSize(expectedSize, partNumber) === null) {
          return yield* new HttpApiError.BadRequest()
        }

        const config = yield* ConfigService
        const s3Service = yield* S3Service

        const url = yield* dieOnS3Error(
          s3Service.presignUploadPart(
            key,
            uploadId,
            partNumber,
            config.buckets.userContent,
            PRESIGNED_PART_URL_EXPIRY_SECONDS,
          ),
        )

        return {
          url,
          partNumber,
          expiresInSeconds: PRESIGNED_PART_URL_EXPIRY_SECONDS,
        }
      }).pipe(
        Effect.withSpan('api.upload.multipart.presignPart', {
          attributes: { partNumber: payload.partNumber },
        }),
      ),
    )
    .handle('completeMultipartUpload', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { key, uploadId, parts } = payload

        yield* assertKeyOwnership(user.id, key)
        const expectedSize = yield* requireExpectedSize(user.id, key)

        const config = yield* ConfigService
        const s3Service = yield* S3Service
        const uploadAssetService = yield* UploadAssetService

        const existing = yield* dieOnS3Error(
          s3Service.getObjectMetadata(key, config.buckets.userContent),
        )

        if (existing) {
          if (!matchesCompletedObject(expectedSize, existing)) {
            return yield* new HttpApiError.BadRequest()
          }

          yield* recordAssetLifecycle(uploadAssetService.markUploaded(key))

          return { url: `${config.urls.bucketRouter}/user-content/${key}`, key }
        }

        const uploadedParts = yield* dieOnS3Error(
          s3Service.listMultipartParts(key, uploadId, config.buckets.userContent),
        )

        const partsError = validateMultipartParts(expectedSize, uploadedParts)

        if (partsError) return yield* partsError

        const submittedByPartNumber = new Map(parts.map((part) => [part.partNumber, part.etag]))

        if (
          parts.length !== uploadedParts.length ||
          submittedByPartNumber.size !== uploadedParts.length ||
          uploadedParts.some((part) => submittedByPartNumber.get(part.partNumber) !== part.etag)
        ) {
          return yield* new HttpApiError.BadRequest()
        }

        yield* dieOnS3Error(
          s3Service
            .completeMultipartUpload(key, uploadId, parts, config.buckets.userContent)
            .pipe(
              Effect.catchTag('S3Error', (completionError) =>
                s3Service
                  .getObjectMetadata(key, config.buckets.userContent)
                  .pipe(
                    Effect.flatMap((object) =>
                      matchesCompletedObject(expectedSize, object)
                        ? Effect.void
                        : Effect.fail(completionError),
                    ),
                  ),
              ),
            ),
        )
        yield* recordAssetLifecycle(uploadAssetService.markUploaded(key))

        return { url: `${config.urls.bucketRouter}/user-content/${key}`, key }
      }).pipe(
        Effect.withSpan('api.upload.multipart.complete', {
          attributes: { partCount: payload.parts.length },
        }),
      ),
    )
    .handle('abortMultipartUpload', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { key, uploadId } = payload

        yield* assertKeyOwnership(user.id, key)
        yield* requireExpectedSize(user.id, key)

        const config = yield* ConfigService
        const s3Service = yield* S3Service
        yield* dieOnS3Error(
          s3Service.abortMultipartUpload(key, uploadId, config.buckets.userContent),
        )

        return { ok: true as const }
      }).pipe(Effect.withSpan('api.upload.multipart.abort')),
    )
    .handle('multipartUploadStatus', ({ query }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { key, uploadId } = query

        yield* assertKeyOwnership(user.id, key)
        yield* requireExpectedSize(user.id, key)

        const config = yield* ConfigService
        const s3Service = yield* S3Service

        const parts = yield* dieOnS3Error(
          s3Service.listMultipartParts(key, uploadId, config.buckets.userContent),
        )

        return { parts }
      }).pipe(Effect.withSpan('api.upload.multipart.status')),
    ),
)
