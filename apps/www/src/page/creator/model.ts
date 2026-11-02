import * as Dialog from '@foldkit/ui/dialog'
import { RichContentDiagnostic, RichContentDocument } from '@gbfm/rich-content/schema'
import { Schema } from 'effect'

import type { CreatorDraft } from './services'
import { CreatorDraftSchema as Draft, CreatorIdentity, MusicReference } from './services'

export const Kind = Schema.Literals(['micro', 'post', 'mix'])

export const MosaicState = Schema.TaggedUnion({
  Idle: {},
  Generating: { content: Schema.String },
  Ready: { url: Schema.String, content: Schema.String },
  Failed: { message: Schema.String },
})

export const Model = Schema.Struct({
  draft: Draft,
  reviewDialog: Dialog.Model,
  creatorId: Schema.String,
  creators: Schema.Array(CreatorIdentity),
  authorized: Schema.Boolean,
  phase: Schema.Literals([
    'loading',
    'writing',
    'reviewing',
    'saving',
    'uploading',
    'published',
    'forbidden',
  ]),
  saveState: Schema.Literals(['saved', 'unsaved', 'saved-locally', 'failed']),
  error: Schema.NullOr(Schema.String),
  episodeError: Schema.NullOr(Schema.String),
  tagsInput: Schema.String,
  authorQuery: Schema.String,
  authorSearch: Schema.Literals(['idle', 'loading', 'ready', 'failed']),
  authorResults: Schema.Array(CreatorIdentity),
  episodeInput: Schema.String,
  editorMode: Schema.Literals(['source', 'preview']),
  diagnostics: Schema.Array(RichContentDiagnostic),
  externalMediaUrl: Schema.String,
  externalMediaError: Schema.NullOr(Schema.String),
  /** Server-rendered preview of `previewContent`, the same document publishing produces. */
  preview: Schema.Literals(['idle', 'loading', 'ready', 'failed']),
  previewContent: Schema.NullOr(Schema.String),
  previewDocument: Schema.NullOr(RichContentDocument),
  musicPreviewTitle: Schema.NullOr(Schema.String),
  musicPreviewMeta: Schema.NullOr(Schema.String),
  musicPreviewImage: Schema.NullOr(Schema.String),
  musicReferences: Schema.Array(MusicReference),
  musicReferenceState: Schema.Literals(['idle', 'loading', 'ready', 'failed']),
  musicReferenceOffset: Schema.Number,
  musicReferenceRequestId: Schema.Number,
  musicReferencesHasMore: Schema.Boolean,
  resolvingPostMusic: Schema.Boolean,
  postMusicNotice: Schema.NullOr(Schema.String),
  mosaic: MosaicState,
  quotePreview: Schema.NullOr(Schema.String),
  uploadPercent: Schema.Number,
  uploadState: Schema.Literals(['idle', 'running', 'pausing', 'paused', 'failed', 'cancelling']),
})

export type Model = typeof Model.Type

export const keyOf = (draft: CreatorDraft) => `${draft.kind}:${draft.editSlug ?? 'new'}`

export const TWEET_MAX_LENGTH = 255

export const draftValidationError = (draft: CreatorDraft): string | null => {
  if (!draft.title.trim() && !draft.content.trim()) return 'Add a title or some content.'

  if (draft.kind === 'micro' && draft.title.length > TWEET_MAX_LENGTH)
    return `Tweets are capped at ${TWEET_MAX_LENGTH} characters.`

  return null
}
