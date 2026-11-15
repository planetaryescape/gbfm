import { Effect, Layer } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError, GetPostResult } from '../contracts'
import { AttachDraftArtworkInput, PrepareDraftImageInput, PreparedDraftImage } from './contracts'
import { DraftArtworkService, DraftArtworkServiceLayer } from './service'

export const DraftArtworkToolkit = Toolkit.make(
  Tool.make('prepare_draft_image_upload', {
    description:
      'Prepare a private JPEG, PNG or WebP upload for your own unpublished editorial. Requires posts:read and drafts:write, latest expectedVersion, a new UUIDv4 requestId, exact byte size and base64 MD5 of the original bytes. PUT raw bytes to uploadUrl with ALL returned headers within five minutes. This create-only URL cannot overwrite bytes. Identical retries replay the exact original URL until expiry; changed retries conflict. Preparation does not edit the draft. Then call attach_draft_artwork with the upload requestId and latest draft version. Never publishes.',
    parameters: PrepareDraftImageInput,
    success: PreparedDraftImage,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('attach_draft_artwork', {
    description:
      'Attach completed owned image uploads to your unpublished editorial using their prepare_draft_image_upload requestIds. coverUploadRequestId sets the cover thumbnail; banner inserts or replaces the leading standalone Markdown image, preserving a leading ::layout directive and all other prose. No banner DB field is changed. Requires latest expectedVersion and a new UUIDv4 requestId per edit. Exact retries replay the original saved result for 24 hours; changed retries and stale versions conflict. Upload receipts must be less than 24 hours old and bound to this draft and actor. Never publishes.',
    parameters: AttachDraftArtworkInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'drafts:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const DraftArtworkHandlersLive = DraftArtworkToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* DraftArtworkService

    return { prepare_draft_image_upload: service.prepare, attach_draft_artwork: service.attach }
  }),
).pipe(Layer.provide(DraftArtworkServiceLayer))
