import { Effect, Layer } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError, GetPostResult, UpdateDraftInput } from '../contracts'
import { AttachDraftArtworkInput, PrepareDraftImageInput, PreparedDraftImage } from './contracts'
import { DraftArtworkService, DraftArtworkServiceLayer } from './service'

export const DraftArtworkToolkit = Toolkit.make(
  Tool.make('update_post', {
    description:
      'Edit supplied title, content or description on your authored editorial, whether unpublished or already published. WARNING: edits to published posts immediately change live pages. Requires posts:read and creator:write, latest get_post expectedVersion and a new UUIDv4 requestId. Omitted fields are preserved; description:null clears it. Never changes publication state, creators, slug, type or music associations. Micro posts are not supported. Exact retries replay the original committed result for 24 hours and repair currently attached public media after a copy failure; changed retries and stale versions conflict. Never publishes or unpublishes a post.',
    parameters: UpdateDraftInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'creator:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('prepare_post_image_upload', {
    description:
      'Prepare a private create-only JPEG, PNG or WebP upload for your authored editorial, published or unpublished. Requires posts:read and creator:write, latest expectedVersion, a new UUIDv4 requestId, filename, MIME type, exact byte size and base64 MD5. PUT original bytes with ALL returned headers within five minutes. Preparation never edits content or exposes private bytes publicly. Identical retries replay the original URL without extending its expiry; changed retries conflict. Then use attach_post_artwork. Micro posts are not supported.',
    parameters: PrepareDraftImageInput,
    success: PreparedDraftImage,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'creator:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('attach_post_artwork', {
    description:
      'Attach completed owned uploads to your authored editorial, published or unpublished. WARNING: artwork edits to published posts change live pages and permanently create public image copies. Requires posts:read and creator:write, latest expectedVersion and a new UUIDv4 edit requestId. coverUploadRequestId sets the cover; banner inserts or replaces the leading standalone Markdown image, preserving ::layout and other prose. Upload receipts must belong to this actor and post and be less than 24 hours old. Exact retries replay the original committed result for 24 hours and repair currently attached public copies after failure; changed retries and stale versions conflict. Never changes publication state. Micro posts are not supported.',
    parameters: AttachDraftArtworkInput,
    success: GetPostResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['posts:read', 'creator:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
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

    return {
      prepare_draft_image_upload: service.prepare,
      attach_draft_artwork: service.attach,
      update_post: service.updatePost,
      prepare_post_image_upload: service.preparePostImage,
      attach_post_artwork: service.attachPostArtwork,
    }
  }),
).pipe(Layer.provide(DraftArtworkServiceLayer))
