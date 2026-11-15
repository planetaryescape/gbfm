import { EDITORIAL_DRAFT_RETRY_WINDOW_MS } from '@gbfm/core/editorial-mcp'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'

import { Database } from '@/db/layer'
import { validateCanonicalContent } from '@/lib/mdx'
import { ConfigService } from '@/services/config.service'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { buildImageObjectKey, PRESIGNED_IMAGE_URL_EXPIRY_SECONDS } from '@/services/upload-policy'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, GetPostResult } from '../contracts'
import { readEditorialReceipt } from '../draft-store'
import { EditorialMcpConfig } from '../editorial'
import { boundEditorialWireResult } from '../editorial-music/content'
import {
  checkpointEditorialCommand,
  editorialConflict,
  editorialOperationKeys,
  loadOwnedEditorialDraft,
  replayEditorialOperation,
  saveEditorialChange,
} from '../editorial-music/save'
import { notFound, projectPost, unavailable } from '../model'
import { attachLeadingBanner } from './banner'
import { AttachDraftArtworkInput, PrepareDraftImageInput, PreparedDraftImage } from './contracts'
import { savePreparedImage } from './store'

const invalid = () =>
  new EditorialToolError({
    code: 'invalid_input',
    message: 'Invalid artwork or incomplete upload.',
  })

const expired = () =>
  new EditorialToolError({
    code: 'expired',
    message: 'Upload receipt expired. Prepare a new upload with a new requestId.',
  })

export class DraftArtworkService extends Context.Service<
  DraftArtworkService,
  {
    readonly prepare: (
      input: typeof PrepareDraftImageInput.Type,
    ) => Effect.Effect<typeof PreparedDraftImage.Type, EditorialToolError>
    readonly attach: (
      input: typeof AttachDraftArtworkInput.Type,
    ) => Effect.Effect<typeof GetPostResult.Type, EditorialToolError>
  }
>()('gbfm/mcp/DraftArtworkService') {}

export const DraftArtworkServiceLayer = Layer.effect(
  DraftArtworkService,
  Effect.gen(function* () {
    const db = yield* Database
    const authorization = yield* McpAuthorization
    const config = yield* ConfigService
    const endpoint = yield* EditorialMcpConfig
    const store = yield* ObjectStoreClient

    const authorize = authorization
      .editorial(true)
      .pipe(
        Effect.flatMap((actor) =>
          checkpointEditorialCommand(['posts:read', 'drafts:write'], actor.userId).pipe(
            Effect.map((checkpoint) => ({ ...actor, liveGuard: checkpoint.liveGuard })),
          ),
        ),
      )

    const prepare = Effect.fn('DraftArtworkService.prepare')(function* (
      raw: typeof PrepareDraftImageInput.Type,
    ) {
      const actor = yield* authorize

      const input = yield* Schema.decodeUnknownEffect(PrepareDraftImageInput, {
        onExcessProperty: 'error',
      })(raw).pipe(Effect.mapError(invalid))

      const operation = yield* editorialOperationKeys(
        actor.userId,
        input.requestId,
        JSON.stringify([
          'prepare-draft-image-v1',
          input.postId,
          input.expectedVersion,
          input.fileName,
          input.contentType,
          input.fileSize,
          input.contentMd5,
        ]),
      )

      const replay = replayEditorialOperation(
        db,
        actor.userId,
        operation,
        PreparedDraftImage,
        authorize,
      )

      const existing = yield* replay

      if (Option.isSome(existing)) {
        if ((yield* Clock.currentTimeMillis) >= existing.value.upload.expiresAt)
          return yield* expired()

        return existing.value
      }

      const previous = yield* loadOwnedEditorialDraft(db, input.postId, actor.userId)

      if ((yield* projectPost(previous, endpoint)).version !== input.expectedVersion) {
        const concurrent = yield* replay

        if (Option.isSome(concurrent)) {
          if ((yield* Clock.currentTimeMillis) >= concurrent.value.upload.expiresAt)
            return yield* expired()

          return concurrent.value
        }

        return yield* editorialConflict()
      }

      const now = new Date(yield* Clock.currentTimeMillis)
      const assetId = crypto.randomUUID()
      const key = buildImageObjectKey(actor.userId, input.fileName, assetId)

      const headers = {
        'content-type': input.contentType,
        'content-md5': input.contentMd5,
        'content-length': String(input.fileSize),
        'if-none-match': '*',
        'x-amz-meta-artwork-receipt': assetId,
      }

      const uploadUrl = yield* Effect.tryPromise({
        try: () =>
          store.presignPutObject({
            bucketName: config.buckets.userContent,
            key,
            contentType: input.contentType,
            expiresInSeconds: PRESIGNED_IMAGE_URL_EXPIRY_SECONDS,
            integrity: { contentMd5: input.contentMd5, fileSize: input.fileSize, receipt: assetId },
          }),
        catch: unavailable,
      })

      const result = {
        endpoint,
        post: { postId: input.postId },
        upload: {
          requestId: input.requestId,
          assetId,
          key,
          uploadUrl,
          headers,
          publicUrl: `${config.urls.bucketRouter}/user-content/${key}`,
          fileSize: input.fileSize,
          bucket: config.buckets.userContent,
          expiresAt: now.getTime() + PRESIGNED_IMAGE_URL_EXPIRY_SECONDS * 1000,
        },
      }

      const current = yield* authorize
      yield* boundEditorialWireResult(result)
      yield* savePreparedImage(
        db,
        actor.userId,
        previous,
        operation,
        result,
        now,
        current.liveGuard,
      )
      const committed = yield* replay

      if (Option.isNone(committed)) return yield* editorialConflict()

      return committed.value
    })

    const attach = Effect.fn('DraftArtworkService.attach')(function* (
      raw: typeof AttachDraftArtworkInput.Type,
    ) {
      const actor = yield* authorize

      const input = yield* Schema.decodeUnknownEffect(AttachDraftArtworkInput, {
        onExcessProperty: 'error',
      })(raw).pipe(Effect.mapError(invalid))

      const operation = yield* editorialOperationKeys(
        actor.userId,
        input.requestId,
        JSON.stringify([
          'attach-draft-artwork-v1',
          input.postId,
          input.expectedVersion,
          input.coverUploadRequestId ?? null,
          input.banner?.uploadRequestId ?? null,
          input.banner?.alt ?? null,
        ]),
      )

      const replay = replayEditorialOperation(db, actor.userId, operation, GetPostResult, authorize)
      const existing = yield* replay

      if (Option.isSome(existing)) return existing.value
      const previous = yield* loadOwnedEditorialDraft(db, input.postId, actor.userId)

      if ((yield* projectPost(previous, endpoint)).version !== input.expectedVersion) {
        const concurrent = yield* replay

        if (Option.isSome(concurrent)) return concurrent.value

        return yield* editorialConflict()
      }

      const readUpload = Effect.fn('DraftArtworkService.readUpload')(function* (requestId: string) {
        const { id } = yield* editorialOperationKeys(actor.userId, requestId, '')

        const [receipt] = yield* Effect.tryPromise({
          try: () => readEditorialReceipt(db, id, actor.userId),
          catch: unavailable,
        })

        if (!receipt || receipt.postId !== input.postId) return yield* notFound()

        if (
          receipt.result === null ||
          (yield* Clock.currentTimeMillis) >=
            receipt.createdAt.getTime() + EDITORIAL_DRAFT_RETRY_WINDOW_MS
        )
          return yield* expired()

        const prepared = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(PreparedDraftImage),
        )(receipt.result).pipe(Effect.mapError(invalid))

        const upload = prepared.upload

        if (
          prepared.post.postId !== input.postId ||
          upload.requestId !== requestId ||
          upload.bucket !== config.buckets.userContent ||
          upload.publicUrl !== `${config.urls.bucketRouter}/user-content/${upload.key}`
        )
          return yield* invalid()

        const object = yield* Effect.tryPromise({
          try: () => store.headObject(upload.bucket, upload.key),
          catch: unavailable,
        })

        if (
          !object ||
          object.size !== upload.fileSize ||
          object.metadata['artwork-receipt'] !== upload.assetId
        )
          return yield* invalid()

        return upload
      })

      const cover =
        input.coverUploadRequestId === undefined
          ? undefined
          : yield* readUpload(input.coverUploadRequestId)

      const banner =
        input.banner === undefined ? undefined : yield* readUpload(input.banner.uploadRequestId)

      let content = previous.content

      if (banner && input.banner) {
        content = attachLeadingBanner(previous.content ?? '', banner.publicUrl, input.banner.alt)

        if (content.length > 100_000) return yield* invalid()
        yield* validateCanonicalContent(
          attachLeadingBanner('', banner.publicUrl, input.banner.alt),
        ).pipe(Effect.mapError(invalid))
      }

      const now = new Date(
        Math.max(yield* Clock.currentTimeMillis, previous.updatedAt.getTime() + 1),
      )

      const next = {
        ...previous,
        content,
        thumbnailUrl: cover?.publicUrl ?? previous.thumbnailUrl,
        updatedAt: now,
      }

      const result = { endpoint, post: yield* projectPost(next, endpoint) }

      const assets = [
        ...new Map(
          [cover, banner].flatMap((upload) =>
            upload
              ? [
                  [
                    upload.assetId,
                    {
                      id: upload.assetId,
                      key: upload.key,
                      bucket: upload.bucket,
                      expectedSize: upload.fileSize,
                    },
                  ],
                ]
              : [],
          ),
        ).values(),
      ]

      const current = yield* authorize
      const patch = { content: banner ? (content ?? undefined) : undefined }
      yield* saveEditorialChange(
        db,
        actor.userId,
        previous,
        cover ? { ...patch, thumbnailUrl: cover.publicUrl } : patch,
        {
          ...operation,
          actorId: actor.userId,
          postId: input.postId,
          result: JSON.stringify(result),
          createdAt: now,
        },
        undefined,
        current.liveGuard,
        assets,
      )
      const committed = yield* replay

      if (Option.isNone(committed)) return yield* editorialConflict()

      return committed.value
    })

    return DraftArtworkService.of({ prepare, attach })
  }),
).pipe(Layer.provide(McpAuthorizationLive))
