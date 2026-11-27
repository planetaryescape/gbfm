import { Mount } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import type { Html } from '@effect/ui/html'
import { canCreatePosts } from '@gbfm/core/roles'
import { Match, Predicate } from 'effect'

import { richContentView } from '../../ui/rich-content/render'
import {
  Artwork,
  AttachmentControls,
  AuthorPicker,
  Button,
  CreatorActions,
  CreatorKinds,
  Field,
  Tags,
} from './controls'
import { CreatorPageDef as D } from './definition'
import { publicHref, savedEditorHref } from './domain'
import { AttachMarkdownEditor, WarnBeforeLeave } from './editor'
import { CreatorPageMessage as M, type CreatorPageModel } from './state'

type H = Html.H<typeof M.Type>

const saveStatus = (model: CreatorPageModel) => {
  if (model.saving) return 'Saving…'

  if (model.revision === model.savedRevision) return 'All changes saved'

  if (model.localRevision === model.revision) return 'Draft saved locally'

  return 'Unsaved changes'
}

const publishLabel = (model: CreatorPageModel) => {
  if (model.saving) return 'Publishing…'

  if (model.draft.editSlug) return 'Update'

  return 'Publish'
}

const Editor = (h: H, model: CreatorPageModel) =>
  h.section
    .key('markdown-editor')
    .class('creator-editor')
    .children(
      h.div.class('creator-editor-bar').children(
        h.div
          .attr('role', 'toolbar')
          .attr('aria-label', 'Formatting controls')
          .children(
            Button(
              h,
              'Heading',
              M.ClickedFormat({ before: '## ', after: '', sample: 'Heading' }),
              model.mode !== 'source',
            ),
            Button(
              h,
              'Bold',
              M.ClickedFormat({ before: '**', after: '**', sample: 'bold text' }),
              model.mode !== 'source',
            ),
            Button(
              h,
              'Italic',
              M.ClickedFormat({ before: '_', after: '_', sample: 'italic text' }),
              model.mode !== 'source',
            ),
            Button(
              h,
              'Link',
              M.ClickedFormat({ before: '[', after: '](https://)', sample: 'link text' }),
              model.mode !== 'source',
            ),
            Button(
              h,
              'Quote',
              M.ClickedFormat({ before: '> ', after: '', sample: 'Quoted text' }),
              model.mode !== 'source',
            ),
            Button(
              h,
              'List',
              M.ClickedFormat({ before: '- ', after: '', sample: 'List item' }),
              model.mode !== 'source',
            ),
          ),
        Button(h, 'Source', M.PickedEditorMode({ mode: 'source' })),
        Button(h, 'Preview', M.PickedEditorMode({ mode: 'preview' })),
      ),
      h.div.attr('hidden', model.mode !== 'source' ? '' : undefined).children(
        h.div
          .class('creator-codemirror')
          .onMount(
            AttachMarkdownEditor({ content: model.draft.content, focus: model.focusBody }).pipe(
              Mount.map((value) => M.UpdatedField({ field: 'content', value })),
            ),
          ),
        h.details.children(
          h.summary('Plain text editor'),
          h.textarea
            .attrs({ name: 'content', 'aria-label': 'Body source', rows: '14' })
            .value(model.draft.content)
            .on('input', ({ value }) => M.UpdatedField({ field: 'content', value }))
            .on('blur', M.RequestedAutosave()),
        ),
      ),
    )

const uploadStatus = (model: CreatorPageModel) =>
  Match.value(model.uploadState).pipe(
    Match.when('idle', () => 'Ready to upload'),
    Match.when('running', () => 'Uploading'),
    Match.when('pausing', () => 'Pausing after the current part'),
    Match.when('paused', () => 'Upload paused'),
    Match.when('failed', () => 'Upload failed'),
    Match.when('cancelling', () => 'Cancelling upload'),
    Match.exhaustive,
  )

const Audio = (h: H, model: CreatorPageModel) =>
  h.section.attr('aria-label', 'Audio upload').children(
    h.h2('Mix audio'),
    Field(h, model, 'Existing audio URL', 'audioUrl'),
    h.label.children(
      'Mix audio',
      h.input
        .attrs({ type: 'file', accept: 'audio/*' })
        .value('')
        .disabled(
          model.uploadState === 'running' ||
            model.uploadState === 'pausing' ||
            model.uploadState === 'cancelling',
        )
        .on('change', ({ files }) => M.ChoseAudio({ files })),
    ),
    h.p('Reselect the original file after a reload to resume an unfinished upload.'),
    h.p
      .attr('role', 'status')
      .children(`${uploadStatus(model)} · ${Math.floor(model.uploadPercent)}%`),
    h.progress.attrs({
      value: String(Math.floor(model.uploadPercent)),
      max: '100',
      'aria-label': 'Audio upload progress',
    }),
    Button(h, 'Pause upload', M.ClickedPauseUpload(), model.uploadState !== 'running'),
    Button(
      h,
      'Resume upload',
      M.ClickedResumeUpload(),
      model.uploadState !== 'paused' && model.uploadState !== 'failed',
    ),
    Button(
      h,
      'Cancel upload',
      M.ClickedCancelUpload(),
      model.uploadState !== 'paused' && model.uploadState !== 'failed',
    ),
    model.draft.audioUrl && h.audio.attrs({ controls: '', src: model.draft.audioUrl }),
    h.label.children(
      'Show ID',
      h.input
        .attr('name', 'showId')
        .value(model.draft.showId ?? '')
        .on('input', ({ value }) => M.UpdatedShow({ value })),
    ),
    h.label.children(
      'Episode number',
      h.input
        .attrs({ name: 'episodeNumber', type: 'number', min: '1' })
        .value(model.episodeInput)
        .on('input', ({ value }) => M.UpdatedEpisode({ value })),
    ),
  )

export const CreatorView = D.view((h, state) => {
  const editable = h.queries.editable

  const model =
    !state.ready && Predicate.isTagged(editable, 'Success')
      ? {
          ...state,
          draft: editable.value,
          ready: true,
          bodyOpen: Boolean(editable.value.content.trim()),
        }
      : state

  if (!canCreatePosts(h.props.principal.role))
    return h.main
      .class('creator-page')
      .children(h.h1('Creator'), h.p('Your account does not have permission to create content.'))

  if (model.choosing)
    return h.main.class('creator-page').children(
      h.h1('What would you like to create?'),
      h.div.class('creator-type-options').children(
        h.a
          .attr('href', '/new/tweet')
          .on('click', M.PickedKind({ kind: 'micro' }), { preventDefault: true })
          .children('Tweet'),
        h.a
          .attr('href', '/new/editorial')
          .on('click', M.PickedKind({ kind: 'post' }), { preventDefault: true })
          .children('Editorial'),
        h.a
          .attr('href', '/new/mix')
          .on('click', M.PickedKind({ kind: 'mix' }), { preventDefault: true })
          .children('Mix'),
      ),
    )
  const preview = h.queries.preview
  const authors = h.queries.authors
  const references = h.queries.references

  const referenceRows = references.flatMap(({ result }) =>
    Predicate.isTagged(result, 'Success') ? result.value.data : [],
  )

  const referencesFailed = references.some(({ result }) => Predicate.isTagged(result, 'Failure'))

  const referencesPending = references.some(
    ({ result }) =>
      !Predicate.isTagged(result, 'Success') && !Predicate.isTagged(result, 'Failure'),
  )

  return h.main
    .class('page creator-page')
    .onMount(
      WarnBeforeLeave({
        dirty: model.revision !== model.savedRevision || model.uploadState !== 'idle',
      }),
    )
    .children(
      h.header
        .class('creator-header')
        .children(
          h.h1.class('text-base m-0').children('Creator'),
          h.p.attr('role', 'status').class('creator-status').children(saveStatus(model)),
          CreatorActions(h, model),
        ),
      h.p
        .class('text-sm text-muted-foreground')
        .children(
          'Drafts are private until you publish. Unsaved recovery is stored only on this device, for this account.',
        ),
      model.recovery &&
        (!model.legacyRecovery ||
          (h.props.principal.username === 'guidefari' &&
            model.legacyRecovery.ownerId === h.props.principal.id)) &&
        h.aside
          .attr('role', 'status')
          .children(
            h.h2('Recover unsaved writing?'),
            h.p(model.recovery.title || model.recovery.content.slice(0, 160)),
            Button(h, 'Recover draft', M.ClickedRecover(), model.legacyBusy),
            Button(h, 'Keep saved version', M.ClickedDismissRecovery(), model.legacyBusy),
          ),
      !model.ready &&
        h.div.children(
          h.p.attr('role', 'status').children('Loading your saved draft…'),
          Predicate.isTagged(h.queries.editable, 'Failure')
            ? h.button
                .attr('type', 'button')
                .on('click', M.RequestedReloadEditable())
                .children('Retry loading draft')
            : null,
        ),
      !model.review &&
        model.error &&
        h.p.attr('role', 'alert').class('form-error').children(model.error),
      !model.review && model.localError && h.p.attr('role', 'alert').children(model.localError),
      !model.review && model.episodeError && h.p.attr('role', 'alert').children(model.episodeError),
      model.mediaError && h.p.attr('role', 'alert').children(model.mediaError),
      model.notice &&
        h.p
          .class(model.published && 'creator-published')
          .attr('role', 'status')
          .children(model.notice),
      model.published &&
        h.a.attr('href', publicHref(model.draft)).children('View published content'),
      model.draft.editSlug &&
        h.a
          .attrs({
            href: savedEditorHref(model.draft.kind, model.draft.editSlug),
            target: '_blank',
            rel: 'noopener noreferrer',
          })
          .children('Open latest saved version (new tab)'),
      model.draft.editSlug && h.a.attr('href', publicHref(model.draft)).children('← Back to post'),
      h.details.children(
        h.summary('Search native music catalogue'),
        h.input
          .attr('aria-label', 'Search music')
          .value(model.musicQuery)
          .on('input', ({ value }) => M.UpdatedMusicQuery({ value })),
        Predicate.isTagged(h.queries.music, 'Success') &&
          h.queries.music.value
            .filter((music) =>
              `${music.title} ${music.artists}`
                .toLocaleLowerCase()
                .includes(model.musicQuery.toLocaleLowerCase()),
            )
            .slice(0, 30)
            .map((music) =>
              Button(
                h,
                `${music.title}${music.artists ? ` · ${music.artists}` : ''} (${music.entityType})`,
                M.PickedMusic(music),
              ),
            ),
        Predicate.isTagged(h.queries.music, 'Failure') &&
          h.p
            .attr('role', 'alert')
            .children('Music search failed. Try another search or attach a music URL.'),
      ),
      h.form
        .key('editor-form')
        .class('creator-workspace')
        .attrs({
          id: 'creator-content-form',
          method: 'post',
          action: '/actions/creator/save',
          'aria-label': 'Content editor',
        })
        .on('submit', ({ entries }) =>
          entries.some(([name, value]) => name === 'intent' && value === 'publish')
            ? M.RequestedOpenReview()
            : M.RequestedSave(),
        )
        .children(
          h.input.attrs({ type: 'hidden', name: 'kind', value: model.draft.kind }),
          h.input.attrs({ type: 'hidden', name: 'editSlug', value: model.draft.editSlug ?? '' }),
          h.input.attrs({
            type: 'hidden',
            name: 'expectedUpdatedAt',
            value: model.draft.expectedUpdatedAt ?? '',
          }),
          h.input.attrs({
            type: 'hidden',
            name: 'musicEntityType',
            value: model.draft.musicEntityType ?? '',
          }),
          h.input.attrs({
            type: 'hidden',
            name: 'musicEntityId',
            value: model.draft.musicEntityId ?? '',
          }),
          h.input.attrs({
            type: 'hidden',
            name: 'quotedPostId',
            value: model.draft.quotedPostId ?? '',
          }),
          model.draft.creatorIds.map((id) =>
            h.input.key(id).attrs({ type: 'hidden', name: 'creatorIds', value: id }),
          ),
          h.fieldset
            .class('creator-canvas border-0')
            .disabled(!model.ready)
            .children(
              h.legend('Write'),
              CreatorKinds(h, model),
              Field(h, model, 'Title', 'title'),
              model.draft.kind === 'micro' &&
                h.p.attr('id', 'creator-tweet-count').children(`${model.draft.title.length}/255`),
              model.draft.kind === 'micro' &&
                model.draft.title.length > 255 &&
                h.p
                  .attr('role', 'alert')
                  .children(`Tweets are capped at 255 characters (${model.draft.title.length}).`),
              Field(h, model, 'Story URL', 'slug'),
              Field(h, model, 'Description', 'description'),
              model.draft.kind === 'micro'
                ? h.details
                    .key('optional-body')
                    .attr('open', model.bodyOpen ? '' : undefined)
                    .on('toggle', ({ open }) => M.ToggledBodyEditor({ open }))
                    .children(
                      h
                        .summary(model.bodyOpen ? 'Longer note' : '+ Add a longer note')
                        .attr('role', 'button')
                        .on(
                          'click',
                          () =>
                            M.ToggledBodyEditor({
                              open: Boolean(model.draft.content.trim()) || !model.bodyOpen,
                            }),
                          { preventDefault: true },
                        ),
                      Editor(h, model),
                    )
                : Editor(h, model),
              Predicate.isTagged(h.queries.diagnostics, 'Success') &&
                h.queries.diagnostics.value.length > 0 &&
                h.ul
                  .attr('aria-label', 'Source diagnostics')
                  .children(
                    h.queries.diagnostics.value.map((diagnostic) =>
                      h.li.children(
                        h.p
                          .attr('role', diagnostic.severity === 'error' ? 'alert' : 'status')
                          .children(
                            `${diagnostic.line ? `Line ${diagnostic.line}: ` : ''}${diagnostic.message}`,
                          ),
                      ),
                    ),
                  ),
              Predicate.isTagged(h.queries.diagnostics, 'Failure') &&
                h.p
                  .attr('role', 'alert')
                  .children('Source diagnostics could not load. Your source is still here.'),
              model.mode === 'preview' &&
                h.section
                  .class('creator-preview creator-preview-body')
                  .children(
                    Predicate.isTagged(preview, 'Success')
                      ? richContentView(h, preview.value)
                      : h.div.children(
                          h.p
                            .attr(
                              'role',
                              Predicate.isTagged(preview, 'Failure') ? 'alert' : 'status',
                            )
                            .children(
                              Predicate.isTagged(preview, 'Failure')
                                ? 'The preview could not load. Your source is still here.'
                                : 'Rendering preview…',
                            ),
                          Predicate.isTagged(preview, 'Failure') &&
                            Button(h, 'Try again', M.ClickedRetryPreview()),
                        ),
                  ),
              AttachmentControls(h, model),
              h.details.key('artwork-details').children(h.summary('Artwork'), Artwork(h, model)),
              Predicate.isTagged(h.queries.attachmentPreview, 'Success') &&
                richContentView(h, h.queries.attachmentPreview.value),
              Predicate.isTagged(h.queries.attachmentPreview, 'Failure') &&
                h.div.children(
                  h.p
                    .attr('role', 'alert')
                    .children(
                      'The attached music preview could not load. The native music reference is retained.',
                    ),
                  Button(h, 'Retry music preview', M.ClickedRetryMusicPreview()),
                ),
              model.draft.kind === 'mix' && Audio(h, model),
              Tags(h, model),
              h.details
                .key('authors-details')
                .children(
                  h.summary('Authors'),
                  AuthorPicker(
                    h,
                    model,
                    Predicate.isTagged(authors, 'Success') ? authors.value : [],
                    Predicate.isTagged(authors, 'Failure'),
                    Predicate.isTagged(authors, 'Success'),
                  ),
                ),
              h.details.children(
                h.summary('Publish without JavaScript'),
                h.label.children(
                  h.input.attrs({ type: 'checkbox', name: 'confirmPublish', value: 'yes' }),
                  'I have reviewed this content and want it to be public.',
                ),
                h.button
                  .attrs({ type: 'submit', name: 'intent', value: 'publish' })
                  .children('Publish reviewed content'),
              ),
            ),
        ),
      references.length > 0 &&
        h.section.attr('aria-label', 'Previous music references').children(
          h.h2('Other tweets about this music'),
          referencesPending && h.p.attr('role', 'status').children('Checking published tweets…'),
          referencesFailed &&
            h.div.children(
              h.p
                .attr('role', 'status')
                .children('Could not check previous tweets. Your draft is unchanged.'),
              Button(h, 'Retry reference check', M.ClickedRetryMusicPreview()),
            ),
          !referencesPending &&
            !referencesFailed &&
            referenceRows.length === 0 &&
            h.p.attr('role', 'status').children('No other published tweets found.'),
          referenceRows.map((reference) =>
            h.article.key(reference.id).children(
              h.a
                .attrs({
                  href: `/tweet/${encodeURIComponent(reference.slug)}`,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                })
                .children(reference.title || reference.content || 'Read tweet'),
              h.p(
                reference.creators
                  .map((author) => author.name || author.username || 'Author')
                  .join(', '),
              ),
            ),
          ),
          references.some(
            ({ args, result }) =>
              args.offset === model.referenceOffset &&
              Predicate.isTagged(result, 'Success') &&
              result.value.pagination.hasMore,
          ) && Button(h, 'More references', M.ClickedMoreReferences()),
        ),
      Dialog(h, {
        key: 'publish',
        props: { open: model.review },
        onEmit: {
          RequestedOpen: () => M.RequestedOpenReview(),
          RequestedClose: () => M.RequestedCloseReview(),
          Settled: () => undefined,
        },
        view: (dialog) =>
          dialog.portal(h.dialog)?.children(
            dialog.backdrop(h.div)?.class('fixed inset-0 bg-black/60'),
            dialog
              .viewport(h.div)
              .class('fixed inset-0 grid place-items-center p-4')
              .children(
                dialog
                  .popup(h.div)
                  .class(
                    'creator-review bg-background p-6 w-full min-w-0 max-w-xl max-h-[90vh] overflow-y-auto break-words',
                  )
                  .children(
                    dialog.title(h.h2).children('Publish post'),
                    dialog.close(h.button).attr('aria-label', 'Close publish review').children('×'),
                    dialog
                      .description(h.p)
                      .children(
                        'Publishing makes this content public. Check the title, body, attachments and authors first.',
                      ),
                    h.h3(model.draft.title),
                    CreatorKinds(h, model),
                    model.error && h.p.attr('role', 'alert').children(model.error),
                    model.localError && h.p.attr('role', 'alert').children(model.localError),
                    model.episodeError && h.p.attr('role', 'alert').children(model.episodeError),
                    Field(h, model, 'Story URL', 'slug'),
                    Field(h, model, 'Description', 'description'),
                    Artwork(h, model),
                    Tags(h, model),
                    AuthorPicker(
                      h,
                      model,
                      Predicate.isTagged(authors, 'Success') ? authors.value : [],
                      Predicate.isTagged(authors, 'Failure'),
                      Predicate.isTagged(authors, 'Success'),
                    ),
                    h.p(model.draft.description),
                    h.div
                      .class('creator-review-body')
                      .children(
                        Predicate.isTagged(preview, 'Success')
                          ? richContentView(h, preview.value)
                          : h.pre
                              .class('whitespace-pre-wrap break-words')
                              .children(model.draft.content),
                      ),
                    Predicate.isTagged(h.queries.attachmentPreview, 'Success') &&
                      richContentView(h, h.queries.attachmentPreview.value),
                    model.draft.quotedPostId &&
                      h.blockquote.children(
                        h.small('Quoted tweet'),
                        h.p(model.quoteTitle || 'Quote attached'),
                      ),
                    Predicate.isTagged(preview, 'Failure') &&
                      h.p
                        .attr('role', 'alert')
                        .children(
                          'Rendered preview is unavailable. Review the source carefully before publishing.',
                        ),
                    Button(
                      h,
                      publishLabel(model),
                      M.RequestedPublish(),
                      model.saving || model.artworkBusy || Boolean(model.episodeError),
                    ),
                    dialog
                      .initialFocus(dialog.close(h.button))
                      .attr('type', 'button')
                      .disabled(model.saving)
                      .children('Keep editing'),
                  ),
              ),
          ) ?? h.div,
      }),
      Dialog(h, {
        key: 'discard',
        props: { open: model.discarding },
        onEmit: {
          RequestedOpen: () => M.RequestedDiscard(),
          RequestedClose: () => M.RequestedCloseDiscard(),
          Settled: () => undefined,
        },
        view: (dialog) =>
          dialog.portal(h.dialog)?.children(
            dialog
              .viewport(h.div)
              .class('fixed inset-0 grid place-items-center')
              .children(
                dialog
                  .popup(h.div)
                  .class('bg-background p-6')
                  .children(
                    dialog.title(h.h2).children('Discard unsaved changes?'),
                    dialog
                      .description(h.p)
                      .children(
                        'This restores the saved version. It does not delete or unpublish the server copy.',
                      ),
                    Button(h, 'Discard changes', M.ConfirmedDiscard(), model.saving),
                    dialog.initialFocus(dialog.close(h.button)).children('Keep writing'),
                  ),
              ),
          ) ?? h.div,
      }),
    )
})
