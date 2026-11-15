import { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'

import { MAX_IMAGE_SIZE, sanitizeKeySegment } from '@/services/upload-policy'

import { CreateDraftInput, EndpointIdentity } from '../contracts'

export const PrepareDraftImageInput = Schema.Struct({
  requestId: CreateDraftInput.fields.requestId,
  postId: PostId,
  expectedVersion: PostVersion,
  fileName: Schema.NonEmptyString.check(
    Schema.isMaxLength(255),
    Schema.makeFilter((name) => !['.', '..'].includes(sanitizeKeySegment(name))),
  ),
  contentType: Schema.Literals(['image/jpeg', 'image/png', 'image/webp']),
  fileSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_IMAGE_SIZE })),
  contentMd5: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]{22}==$/)),
})

export const PreparedDraftImage = Schema.Struct({
  endpoint: EndpointIdentity,
  post: Schema.Struct({ postId: PostId }),
  upload: Schema.Struct({
    requestId: CreateDraftInput.fields.requestId,
    assetId: Schema.String,
    key: Schema.String,
    publicUrl: Schema.String,
    uploadUrl: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
    fileSize: Schema.Int,
    bucket: Schema.String,
    expiresAt: Schema.Number,
  }),
})

export const AttachDraftArtworkInput = Schema.Struct({
  requestId: CreateDraftInput.fields.requestId,
  postId: PostId,
  expectedVersion: PostVersion,
  coverUploadRequestId: Schema.optionalKey(CreateDraftInput.fields.requestId),
  banner: Schema.optionalKey(
    Schema.Struct({
      uploadRequestId: CreateDraftInput.fields.requestId,
      alt: Schema.String.check(Schema.isMaxLength(500), Schema.isPattern(/^[^\r\n]*$/)),
    }),
  ),
}).check(
  Schema.makeFilter(
    (input) => input.coverUploadRequestId !== undefined || input.banner !== undefined,
  ),
)
