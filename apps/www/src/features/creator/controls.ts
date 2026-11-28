import type { Html } from '@effect/ui/html'

import { FocusAttachmentInput, FocusAttachmentTool } from './editor'
import type { CreatorIdentity } from './services'
import { CreatorPageMessage as M, type CreatorPageModel } from './state'

type H = Html.H<typeof M.Type>

const kinds = [
  { kind: 'micro', label: 'Tweet' },
  { kind: 'post', label: 'Editorial' },
  { kind: 'mix', label: 'Mix' },
] satisfies ReadonlyArray<{ kind: CreatorPageModel['draft']['kind']; label: string }>

export const CreatorKinds = (h: H, model: CreatorPageModel) =>
  h.div.class('creator-type-options').children(
    kinds.map(({ kind, label }) =>
      h.button
        .key(kind)
        .attrs({ type: 'button', 'aria-pressed': String(model.draft.kind === kind) })
        .class('btn btn-sm')
        .disabled(
          Boolean(model.draft.editSlug) ||
            model.saving ||
            model.artworkBusy ||
            model.legacyRecovery !== null ||
            model.uploadState !== 'idle',
        )
        .on('click', M.PickedKind({ kind }))
        .children(label),
    ),
  )

export const Field = (
  h: H,
  model: CreatorPageModel,
  label: string,
  field: 'title' | 'slug' | 'description' | 'thumbnailUrl' | 'musicUrl' | 'quoteUrl' | 'audioUrl',
  focus = false,
) => {
  const input = h.input
    .key(field)
    .attr('name', field)
    .attr(
      'aria-invalid',
      field === 'title' && model.draft.kind === 'micro' && model.draft.title.length > 255
        ? 'true'
        : undefined,
    )
    .value(model.draft[field])
    .disabled(field === 'musicUrl' && model.remoteKind === 'music' && model.saving)
    .on('input', ({ value }) => M.UpdatedField({ field, value }))
    .on('blur', M.RequestedAutosave())
    .on(
      'keydown',
      ({ key }) => {
        if (key !== 'Enter') return undefined

        if (field === 'musicUrl') return M.RequestedMusic()

        if (field === 'quoteUrl') return M.RequestedQuote()

        return undefined
      },
      { preventDefault: true },
    )

  return h.label.children(label, focus ? input.onMount(FocusAttachmentInput()) : input)
}

export const Button = (h: H, label: string, message: typeof M.Type, disabled = false) =>
  h.button
    .attr('type', 'button')
    .class('btn btn-sm')
    .disabled(disabled)
    .on('click', message)
    .children(label)

export const CreatorActions = (h: H, model: CreatorPageModel) =>
  h.div.class('creator-actions').children(
    h.button
      .attrs({ type: 'submit', form: 'creator-content-form', name: 'intent', value: 'draft' })
      .on('click', M.RequestedSave(), { preventDefault: true })
      .class('btn')
      .disabled(
        !model.ready ||
          model.saving ||
          model.uploadState !== 'idle' ||
          model.artworkBusy ||
          Boolean(model.episodeError),
      )
      .children('Save draft'),
    Button(
      h,
      'Continue',
      M.RequestedOpenReview(),
      !model.ready ||
        model.uploadState !== 'idle' ||
        model.artworkBusy ||
        Boolean(model.episodeError) ||
        (model.draft.kind === 'micro' && model.draft.title.length > 255),
    ),
    Button(
      h,
      'Discard',
      M.RequestedDiscard(),
      !model.ready || model.uploadState !== 'idle' || model.artworkBusy,
    ),
  )

const musicLabel = (model: CreatorPageModel) => {
  if (model.remoteKind === 'music') return 'Resolving music…'

  if (model.draft.musicEntityId) return 'Re-resolve saved post music'

  return 'Resolve saved post music'
}

const mosaicLabel = (model: CreatorPageModel) => {
  if (model.mosaicBusy) return 'Generating mosaic…'

  if (model.draft.thumbnailUrl.includes('mosaic-') || model.mosaic) return 'Regenerate mosaic'

  return 'Generate mosaic'
}

export const Tags = (h: H, model: CreatorPageModel) =>
  h.label.children(
    'Tags',
    h.input
      .attr('name', 'tags')
      .value(model.tagsInput)
      .on('input', ({ value }) => M.UpdatedTags({ value })),
  )

const AttachmentTool = (
  h: H,
  model: CreatorPageModel,
  label: string,
  attachment: 'music' | 'quote' | 'media',
) => {
  const button = h.button
    .key(`tool-${attachment}`)
    .attrs({
      type: 'button',
      'aria-expanded': String(model.attachment === attachment),
    })
    .on('click', M.ClickedAttachment({ attachment }))
    .children(label)

  return model.returnFocus === attachment ? button.onMount(FocusAttachmentTool()) : button
}

export const AttachmentControls = (h: H, model: CreatorPageModel) =>
  h.section
    .key('attachments')
    .class('creator-attachments')
    .children(
      h.div
        .attr('role', 'group')
        .attr('aria-label', 'Add to your tweet')
        .children(
          AttachmentTool(h, model, 'Music', 'music'),
          !model.draft.editSlug && AttachmentTool(h, model, 'Quote', 'quote'),
          AttachmentTool(h, model, 'Media', 'media'),
        ),
      model.attachment === 'music' &&
        h.div
          .key('music-panel')
          .children(
            Field(h, model, 'Music URL', 'musicUrl', true),
            Button(
              h,
              model.draft.postId ? 'Attach & save music' : 'Attach music',
              M.RequestedMusic(),
              !model.draft.musicUrl.trim() || model.saving || model.musicPending,
            ),
            model.draft.postId && Button(h, musicLabel(model), M.RequestedMusic(), model.saving),
          ),
      model.draft.musicEntityId &&
        h.article
          .attr('aria-label', 'Attached music')
          .children(
            h.p(model.musicTitle || 'Attached music'),
            Button(h, 'Insert music in body', M.ClickedInsertMusic()),
            Button(h, 'Remove music', M.ClickedRemoveMusic()),
          ),
      model.attachment === 'quote' &&
        !model.draft.editSlug &&
        h.div
          .key('quote-panel')
          .children(
            Field(h, model, 'Quote a tweet', 'quoteUrl', true),
            Button(
              h,
              'Attach quote',
              M.RequestedQuote(),
              !model.draft.quoteUrl.trim() || model.quotePending,
            ),
          ),
      model.draft.quotedPostId &&
        h.blockquote.children(
          h.small('Quoted tweet'),
          h.p(model.quoteTitle || 'Quote attached'),
          !model.draft.editSlug && Button(h, 'Remove quote', M.ClickedRemoveQuote()),
        ),
      model.attachment === 'media' &&
        h.div.key('media-panel').children(
          h.label.children(
            'Embed media',
            h.input
              .key('media-url')
              .value(model.mediaUrl)
              .attr('aria-invalid', model.mediaError ? 'true' : undefined)
              .on('keydown', ({ key }) => (key === 'Enter' ? M.ClickedInsertMedia() : undefined), {
                preventDefault: true,
              })
              .onMount(FocusAttachmentInput())
              .on('input', ({ value }) => M.UpdatedMediaUrl({ value })),
          ),
          Button(h, 'Embed', M.ClickedInsertMedia()),
        ),
    )

export const Artwork = (h: H, model: CreatorPageModel) =>
  h.section
    .key('artwork')
    .class('creator-metadata')
    .children(
      Field(h, model, 'Artwork URL', 'thumbnailUrl'),
      h.label.children(
        'Upload artwork',
        h.input
          .attrs({ type: 'file', accept: 'image/*' })
          .value('')
          .disabled(model.artworkBusy)
          .on('change', ({ files }) => M.ChoseArtwork({ files })),
      ),
      model.artworkBusy && h.p.attr('role', 'status').children('Uploading artwork…'),
      Button(h, mosaicLabel(model), M.RequestedMosaic(), model.mosaicBusy),
      model.mosaic &&
        h.div.children(
          h.img
            .attrs({
              src: model.mosaic.url,
              alt: 'Generated mosaic preview',
              width: '200',
              height: '200',
            })
            .class('max-w-full'),
          Button(h, 'Use mosaic', M.ClickedApplyMosaicCover()),
          Button(h, 'Insert mosaic as banner', M.ClickedApplyMosaicBanner()),
          Button(h, 'Keep existing artwork', M.ClickedDiscardMosaic()),
        ),
      model.draft.thumbnailUrl &&
        h.img
          .attrs({
            src: model.draft.thumbnailUrl,
            alt: 'Draft artwork',
            width: '200',
            height: '200',
          })
          .class('max-w-full'),
    )

export const AuthorPicker = (
  h: H,
  model: CreatorPageModel,
  authors: ReadonlyArray<typeof CreatorIdentity.Type>,
  failed: boolean,
  searched = false,
) =>
  h.section
    .key('authors')
    .class('creator-metadata')
    .children(
      h.h3('Authors'),
      h.ul
        .attr('aria-label', 'Authors')
        .children(
          model.draft.creatorIds.map((id) =>
            h.li
              .key(id)
              .children(
                h.span(
                  model.authorLabels[id] || 'Author name unavailable, retained from saved draft',
                ),
                Button(
                  h,
                  'Remove',
                  M.ClickedRemoveAuthor({ id }),
                  model.draft.creatorIds.length === 1,
                ),
              ),
          ),
        ),
      h.details.key('author-search').children(
        h.summary('Add authors'),
        h.label.children(
          'Search authors',
          h.input
            .value(model.authorQuery)
            .on('keydown', ({ key }) => (key === 'Enter' ? M.RequestedAuthors() : undefined), {
              preventDefault: true,
            })
            .on('input', ({ value }) => M.UpdatedAuthorQuery({ value })),
        ),
        Button(h, 'Search authors', M.RequestedAuthors(), !model.authorQuery.trim()),
        authors.map((author) =>
          Button(
            h,
            `${author.name || author.username || 'Author'}${author.username ? ` · @${author.username}` : ''}${model.draft.creatorIds.includes(author.id) ? ' · Selected' : ''}`,
            M.PickedAuthor({ id: author.id }),
            model.draft.creatorIds.includes(author.id),
          ),
        ),
        failed &&
          h.p
            .attr('role', 'alert')
            .children('Could not search authors. Try another name or username.'),
        searched &&
          authors.length === 0 &&
          model.authorQuery.trim() &&
          h.p.attr('role', 'status').children('No authors found. Try another name or username.'),
      ),
    )
