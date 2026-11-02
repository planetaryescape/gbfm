import * as Button from '@foldkit/ui/button'
import { canCreatePosts } from '@gbfm/core/roles'
import { Match } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import type { Principal } from '../../model'
import { imageSource } from '../../view/artwork'
import { richContentView } from '../../view/rich-content/render'
import { Message } from './message'
import { draftValidationError, TWEET_MAX_LENGTH, type Model } from './model'
import { mosaicView } from './mosaic-view'
import { review } from './review-view'

export interface ViewInputs {
  readonly role: string | null
  readonly principal: Principal | null
}

type Builder = HtmlBuilder<typeof Message.Type>

const field = (
  h: Builder,
  label: string,
  value: string,
  name: 'title' | 'slug' | 'description' | 'musicUrl' | 'thumbnailUrl' | 'audioUrl',
  placeholder = '',
) =>
  h.label(
    [],
    [
      label,
      h.input([
        h.Value(value),
        h.Placeholder(placeholder),
        h.OnInput((next) => Message.Changed({ field: name, value: next })),
      ]),
    ],
  )

const publishType = (model: Model, h: Builder, busy: boolean) =>
  h.div(
    [h.Class('creator-type')],
    [
      h.span([], ['Post type']),
      h.div(
        [h.Class('creator-type-options')],
        [
          ...(['micro', 'post'] as const).map((kind) =>
            h.button(
              [
                h.Type('button'),
                h.AriaPressed(String(model.draft.kind === kind)),
                h.Disabled(busy || Boolean(model.draft.editSlug)),
                h.OnClick(Message.KindChanged({ kind })),
              ],
              [kind === 'micro' ? 'Tweet' : 'Editorial'],
            ),
          ),
          model.draft.kind === 'mix'
            ? h.button([h.Type('button'), h.AriaPressed('true'), h.Disabled(true)], ['Mix'])
            : h.empty,
        ],
      ),
    ],
  )

/** Prose classes shared with published tweets so the preview matches the public page. */
export const previewProseClass =
  'prose prose-base dark:prose-invert max-w-none prose-headings:font-black prose-headings:tracking-tighter prose-p:leading-relaxed prose-a:text-foreground prose-a:underline'

const preview = (model: Model, h: Builder): Html => {
  if (!model.draft.content.trim())
    return h.p([h.Class('creator-empty')], ['Your rendered post will appear here.'])

  const stale = model.previewContent !== model.draft.content || model.preview === 'loading'

  return h.div(
    [h.Class('creator-preview-state'), h.AriaBusy(model.preview === 'loading')],
    [
      model.preview === 'failed'
        ? h.div(
            [h.Class('creator-inline-alert'), h.Role('alert')],
            [
              h.p([], ['The preview could not load. Your draft is still saved on this device.']),
              h.button(
                [h.Type('button'), h.Class('btn btn-sm'), h.OnClick(Message.PreviewRequested())],
                ['Try again'],
              ),
            ],
          )
        : h.empty,
      model.preview === 'loading'
        ? h.p([h.Class('creator-preview-status'), h.Role('status')], ['Rendering preview…'])
        : h.empty,
      model.previewDocument && model.preview !== 'failed'
        ? h.div(
            [h.Class(stale ? 'creator-preview-body is-stale' : 'creator-preview-body')],
            [richContentView(model.previewDocument, h, { className: previewProseClass })],
          )
        : model.preview === 'loading'
          ? h.div(
              [h.Class('creator-preview-skeleton'), h.AriaHidden(true)],
              [h.span([]), h.span([]), h.span([])],
            )
          : h.empty,
    ],
  )
}

const editor = (model: Model, h: Builder): Html => {
  const controls = [
    ['Heading', '## ', '', 'Heading'],
    ['Bold', '**', '**', 'bold text'],
    ['Italic', '_', '_', 'italic text'],
    ['Link', '[', '](https://)', 'link text'],
    ['Quote', '> ', '', 'Quoted text'],
    ['List', '- ', '', 'List item'],
  ] as const

  const previewing = model.editorMode === 'preview'

  const tool = (label: string, title: string, message: Message) =>
    Button.view(
      {
        onClick: message,
        isDisabled: previewing,
        toView: ({ button }) =>
          h.button(
            [
              ...button,
              h.Title(previewing ? `${title} (switch to Source to edit)` : title),
              h.AriaLabel(title),
            ],
            [label],
          ),
      },
      h,
    )

  return h.section(
    [h.Class('creator-editor'), h.AriaLabel('Rich text editor')],
    [
      h.div(
        [h.Class('creator-editor-bar')],
        [
          h.div(
            [
              h.Class('creator-editor-tools'),
              h.Role('toolbar'),
              h.AriaLabel('Formatting controls'),
            ],
            [
              ...controls.map(([label, before, after, sample]) =>
                tool(label, label, Message.FormatInserted({ before, after, sample })),
              ),
              model.draft.musicEntityId
                ? tool('Music', 'Insert attached music', Message.MusicEmbedInserted())
                : h.empty,
            ],
          ),
          h.div(
            [h.Class('creator-editor-modes'), h.Role('group'), h.AriaLabel('Editor view')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.AriaPressed(String(model.editorMode === 'source')),
                  h.OnClick(Message.EditorModeChanged({ mode: 'source' })),
                ],
                ['Source'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.AriaPressed(String(previewing)),
                  h.OnClick(Message.EditorModeChanged({ mode: 'preview' })),
                ],
                ['Preview'],
              ),
            ],
          ),
        ],
      ),
      previewing
        ? h.div([h.Class('creator-preview')], [preview(model, h)])
        : h.label(
            [h.Class('creator-source')],
            [
              h.span([h.Class('sr-only')], ['Writing canvas']),
              h.textarea([
                h.Value(model.draft.content),
                h.OnInput((value) => Message.Changed({ field: 'content', value })),
                h.Rows(18),
                h.Placeholder('Start writing…'),
              ]),
            ],
          ),
      model.diagnostics.length
        ? h.ul(
            [h.Class('creator-diagnostics'), h.AriaLabel('Source diagnostics')],
            model.diagnostics.map((item) =>
              h.li([], [`${item.line ? `Line ${item.line}: ` : ''}${item.message}`]),
            ),
          )
        : h.empty,
    ],
  )
}

/** One URL field with its submit action, so Enter attaches and every attachment looks alike. */
const attachRow = (
  h: Builder,
  input: {
    readonly id: string
    readonly label: string
    readonly hint: string
    readonly value: string
    readonly placeholder: string
    readonly action: string
    readonly busy?: boolean
    readonly error?: string | null
    readonly onInput: (value: string) => Message
    readonly onSubmit: Message
  },
): Html =>
  h.div(
    [h.Class('creator-attach')],
    [
      h.label([h.For(`${input.id}-input`), h.Class('creator-attach-label')], [input.label]),
      h.form(
        [h.Class('creator-attach-row'), h.OnSubmit(input.onSubmit)],
        [
          h.input([
            h.Id(`${input.id}-input`),
            h.Type('url'),
            h.Value(input.value),
            h.Disabled(Boolean(input.busy)),
            h.Placeholder(input.placeholder),
            h.AriaDescribedBy(`${input.id}-hint${input.error ? ` ${input.id}-error` : ''}`),
            h.AriaInvalid(Boolean(input.error)),
            h.OnInput(input.onInput),
          ]),
          Button.view(
            {
              type: 'submit',
              isDisabled: !input.value.trim() || Boolean(input.busy),
              toView: ({ button }) =>
                h.button(
                  [...button, h.Class('btn'), h.AriaBusy(Boolean(input.busy))],
                  [input.action],
                ),
            },
            h,
          ),
        ],
      ),
      input.error
        ? h.p(
            [h.Id(`${input.id}-error`), h.Class('creator-field-error'), h.Role('alert')],
            [input.error],
          )
        : h.empty,
      h.small([h.Id(`${input.id}-hint`), h.Class('creator-attach-hint')], [input.hint]),
    ],
  )

const musicReferences = (model: Model, h: Builder): Html => {
  if (model.draft.kind !== 'micro' || !model.draft.musicEntityId) return h.empty

  const references = model.musicReferences.filter((post) => post.id !== model.draft.postId)

  return h.section(
    [
      h.Class('border border-border bg-card p-4 space-y-3'),
      h.AriaLabel('Previous music references'),
    ],
    [
      h.strong([], ['Previously shared?']),
      h.p(
        [h.Class('text-sm text-muted-foreground'), h.Role('status')],
        [
          model.musicReferenceState === 'loading'
            ? 'Checking published tweets…'
            : model.musicReferenceState === 'failed'
              ? 'Could not check previous tweets. You can still save or publish.'
              : references.length
                ? 'This music appears in these published tweets. You can still share it again.'
                : 'No other published tweets found for this music.',
        ],
      ),
      h.ul(
        [h.Class('space-y-3')],
        references.map((post) =>
          h.li(
            [],
            [
              h.a(
                [
                  h.Href(`/tweet/${encodeURIComponent(post.slug)}`),
                  h.Target('_blank'),
                  h.Rel('noopener noreferrer'),
                  h.Class('text-highlight underline underline-offset-4 wrap-anywhere'),
                ],
                [(post.title?.trim() || post.content?.trim() || 'View tweet').slice(0, 255)],
              ),
              h.p(
                [h.Class('text-sm text-muted-foreground')],
                [
                  post.creators
                    .map((creator) => creator.name || creator.username || 'Unknown author')
                    .join(', ') || 'Unknown author',
                  ' · Opens in a new tab',
                ],
              ),
            ],
          ),
        ),
      ),
      model.musicReferenceState === 'failed' || model.musicReferencesHasMore
        ? h.button(
            [
              h.Type('button'),
              h.Class('btn btn-quiet btn-sm'),
              h.Disabled(model.musicReferenceState === 'loading'),
              h.OnClick(Message.MusicReferencesRequested()),
            ],
            [model.musicReferenceState === 'failed' ? 'Retry reference check' : 'Show more tweets'],
          )
        : h.empty,
    ],
  )
}

const musicSlot = (model: Model, h: Builder, busy: boolean): Html =>
  model.draft.musicEntityId
    ? h.article(
        [h.Class('creator-music-card'), h.AriaLabel('Attached music')],
        [
          model.musicPreviewImage
            ? h.img([imageSource(model.musicPreviewImage), h.Alt('Music cover art')])
            : h.div([h.Class('creator-music-placeholder'), h.AriaHidden(true)], ['♫']),
          h.div(
            [h.Class('creator-music-copy')],
            [
              h.strong([], [model.musicPreviewTitle ?? 'Attached music']),
              h.small([], [model.musicPreviewMeta ?? model.draft.musicEntityType ?? 'music']),
              model.draft.musicUrl ? h.small([], [model.draft.musicUrl]) : h.empty,
            ],
          ),
          h.div(
            [h.Class('creator-music-actions')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class('btn btn-quiet btn-sm'),
                  h.Title('Remove music'),
                  h.AriaLabel('Remove music'),
                  h.Disabled(busy),
                  h.OnClick(Message.MusicRemoved()),
                ],
                ['Remove'],
              ),
            ],
          ),
        ],
      )
    : attachRow(h, {
        id: 'creator-music',
        label: 'Music URL',
        busy,
        hint: 'Attached music shows as a catalog card with listening links under the post.',
        value: model.draft.musicUrl,
        placeholder: 'Spotify, Apple Music or Bandcamp link',
        action: model.draft.postId ? 'Attach & save music' : 'Attach music',
        onInput: (value) => Message.Changed({ field: 'musicUrl', value }),
        onSubmit: model.draft.postId
          ? Message.ResolvePostMusicRequested()
          : Message.ResolveMusicRequested(),
      })

const metadata = (model: Model, h: Builder, busy: boolean, principal: Principal | null): Html =>
  h.section(
    [h.Class('creator-metadata'), h.AriaLabel('Post details')],
    [
      h.div(
        [h.Key('post-artwork'), h.Class('creator-artwork')],
        [
          h.span([], ['Artwork']),
          model.draft.thumbnailUrl
            ? h.img([imageSource(model.draft.thumbnailUrl), h.Alt('Post artwork preview')])
            : h.label(
                [h.Class('creator-artwork-upload')],
                [
                  h.span([], ['Upload artwork']),
                  h.input([
                    h.Type('file'),
                    h.Accept('image/*'),
                    h.Disabled(busy),
                    h.OnFileChange((files) => Message.ArtworkChosen({ files: [...files] })),
                  ]),
                ],
              ),
          field(h, 'Artwork URL', model.draft.thumbnailUrl, 'thumbnailUrl', 'Artwork URL'),
          mosaicView(model, h, busy),
        ],
      ),
      h.div(
        [h.Key('metadata-fields'), h.Class('creator-metadata-fields')],
        [
          model.draft.kind === 'post'
            ? field(
                h,
                'Description',
                model.draft.description,
                'description',
                'A short introduction',
              )
            : h.empty,
          h.div(
            [h.Class('flex flex-col gap-2')],
            [
              h.span([], ['Authors']),
              h.ul(
                [h.AriaLabel('Authors'), h.Class('m-0 list-none p-0 text-sm')],
                (model.draft.creatorIds.length ? model.draft.creatorIds : [model.creatorId]).map(
                  (id) => {
                    const creator =
                      principal?.id === id
                        ? principal
                        : model.creators.find((creator) => creator.id === id)

                    return h.li(
                      [h.Key(id), h.Class('flex items-center justify-between gap-3 py-1')],
                      [
                        creator?.name?.trim() ||
                          (creator?.username?.trim()
                            ? `@${creator.username.trim()}`
                            : 'Author name unavailable — retained from saved draft'),
                        h.button(
                          [
                            h.Type('button'),
                            h.Class('btn btn-quiet btn-sm'),
                            h.Disabled(busy || model.draft.creatorIds.length <= 1),
                            h.OnClick(Message.AuthorRemoved({ id })),
                          ],
                          ['Remove'],
                        ),
                      ],
                    )
                  },
                ),
              ),
              h.details(
                [h.Class('text-xs text-muted-foreground')],
                [
                  h.summary([h.Class('cursor-pointer min-h-11 content-center')], ['Add authors']),
                  h.form(
                    [h.OnSubmit(Message.AuthorSearchRequested())],
                    [
                      h.label(
                        [h.Class('mt-2')],
                        [
                          'Search by name or username',
                          h.input([
                            h.Value(model.authorQuery),
                            h.AriaLabel('Search authors'),
                            h.Disabled(busy),
                            h.OnInput((value) => Message.AuthorQueryChanged({ value })),
                          ]),
                        ],
                      ),
                      h.button(
                        [
                          h.Type('submit'),
                          h.Class('btn mt-2'),
                          h.Disabled(
                            busy || !model.authorQuery.trim() || model.authorSearch === 'loading',
                          ),
                        ],
                        ['Search authors'],
                      ),
                    ],
                  ),
                  h.p(
                    [h.Role('status')],
                    [
                      Match.value(model.authorSearch).pipe(
                        Match.when('loading', () => 'Searching authors…'),
                        Match.when(
                          'failed',
                          () =>
                            'Could not search authors. Check your connection and sign-in, then try again.',
                        ),
                        Match.when('ready', () =>
                          model.authorResults.length
                            ? 'Select an author to add. Showing up to 10 matches.'
                            : 'No authors found. Try another name or username.',
                        ),
                        Match.orElse(
                          () => 'At least one author is required. Search to add collaborators.',
                        ),
                      ),
                    ],
                  ),
                  h.ul(
                    [h.AriaLabel('Author search results'), h.Class('m-0 list-none p-0')],
                    model.authorResults.map((creator) =>
                      h.li(
                        [h.Key(creator.id)],
                        [
                          h.button(
                            [
                              h.Type('button'),
                              h.Class('btn creator-author-result'),
                              h.Disabled(busy || model.draft.creatorIds.includes(creator.id)),
                              h.OnClick(Message.AuthorSelected({ id: creator.id })),
                            ],
                            [
                              `${creator.name || creator.username || 'Unnamed author'}${creator.username ? ` · @${creator.username}` : ''}${model.draft.creatorIds.includes(creator.id) ? ' — Selected' : ''}`,
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          field(h, 'Story URL', model.draft.slug, 'slug', 'generated-from-title'),
        ],
      ),
      h.label(
        [h.Key('tags-field'), h.Class('creator-tags-field')],
        [
          'Tags',
          h.input([
            h.Value(model.tagsInput),
            h.AriaLabel('Tags'),
            h.OnInput((value) => Message.TagsChanged({ value })),
            h.Placeholder('house, johannesburg'),
          ]),
          h.small([], ['Separate tags with commas.']),
        ],
      ),
    ],
  )

const composerExtras = (model: Model, h: Builder): Html =>
  h.div(
    [h.Class('creator-extras')],
    [
      model.draft.kind !== 'mix' && !model.draft.editSlug
        ? h.div(
            [h.Class('creator-quote')],
            [
              attachRow(h, {
                id: 'creator-quote',
                label: 'Quote a tweet',
                hint: 'Paste a goosebumps.fm tweet link.',
                value: model.draft.quoteUrl,
                placeholder: 'https://goosebumps.fm/tweet/…',
                action: 'Attach quote',
                onInput: (value) => Message.QuoteUrlChanged({ value }),
                onSubmit: Message.ResolveQuoteRequested(),
              }),
              model.quotePreview
                ? h.blockquote([], [h.small([], ['Quoted tweet']), h.p([], [model.quotePreview])])
                : h.empty,
            ],
          )
        : h.empty,
      attachRow(h, {
        id: 'creator-media',
        label: 'Embed media',
        hint: 'Adds a YouTube, SoundCloud, Bandcamp or Spotify player inside the post.',
        value: model.externalMediaUrl,
        placeholder: 'https://…',
        action: 'Embed',
        error: model.externalMediaError,
        onInput: (value) => Message.ExternalMediaChanged({ value }),
        onSubmit: Message.ExternalMediaInserted(),
      }),
    ],
  )

const mixFields = (model: Model, h: Builder, busy: boolean): Html =>
  h.div(
    [h.Class('creator-mix-fields')],
    [
      field(h, 'Existing audio URL', model.draft.audioUrl, 'audioUrl'),
      h.label(
        [],
        [
          'Show ID',
          h.input([
            h.Value(model.draft.showId ?? ''),
            h.OnInput((value) => Message.ShowChanged({ value })),
          ]),
        ],
      ),
      h.label(
        [],
        [
          'Episode number',
          h.input([
            h.Type('number'),
            h.Min('1'),
            h.Step('1'),
            h.Value(model.episodeInput),
            h.OnInput((value) => Message.EpisodeChanged({ value })),
          ]),
        ],
      ),
      h.label(
        [],
        [
          'Mix audio',
          h.input([
            h.Type('file'),
            h.Accept('audio/*'),
            h.Disabled(busy),
            h.OnFileChange((files) => Message.AudioChosen({ files: [...files] })),
          ]),
        ],
      ),
      model.uploadState !== 'idle'
        ? h.div(
            [h.Class('upload-progress'), h.Role('region'), h.AriaLabel('Audio upload')],
            [
              h.p(
                [h.Role('status')],
                [
                  `${Match.value(model.uploadState).pipe(
                    Match.when('running', () => 'Uploading'),
                    Match.when('pausing', () => 'Pausing after the current part'),
                    Match.when('paused', () => 'Upload paused'),
                    Match.when('failed', () => 'Upload failed'),
                    Match.when('cancelling', () => 'Cancelling upload'),
                    Match.exhaustive,
                  )} · ${model.uploadPercent}%`,
                ],
              ),
              h.progress(
                [
                  h.Value(String(model.uploadPercent)),
                  h.Max('100'),
                  h.AriaLabel('Audio upload progress'),
                ],
                [],
              ),
              model.uploadState === 'running'
                ? h.button(
                    [
                      h.Type('button'),
                      h.Class('btn btn-sm'),
                      h.OnClick(Message.UploadPauseRequested()),
                    ],
                    ['Pause upload'],
                  )
                : h.empty,
              model.uploadState === 'paused' || model.uploadState === 'failed'
                ? h.div(
                    [],
                    [
                      h.button(
                        [
                          h.Type('button'),
                          h.Class('btn btn-sm'),
                          h.OnClick(Message.UploadResumeRequested()),
                        ],
                        ['Resume upload'],
                      ),
                      h.button(
                        [
                          h.Type('button'),
                          h.Class('btn btn-quiet btn-sm'),
                          h.OnClick(Message.UploadCancelRequested()),
                        ],
                        ['Cancel upload'],
                      ),
                    ],
                  )
                : h.empty,
            ],
          )
        : h.empty,
    ],
  )

export const view = defineView<Model, typeof Message.Type, ViewInputs>((model, inputs, h) => {
  if (!model.authorized || !canCreatePosts(inputs.role))
    return h.section(
      [h.Class('page narrow')],
      [h.h1([], ['Creator access required']), h.p([], ['Your account cannot publish content.'])],
    )

  if (model.phase === 'loading')
    return h.section([h.Class('page narrow')], [h.p([], ['Loading draft…'])])

  const busy =
    model.phase === 'saving' ||
    model.phase === 'uploading' ||
    model.uploadState !== 'idle' ||
    model.resolvingPostMusic

  const validationError = draftValidationError(model.draft)
  const canContinue = !validationError && !model.episodeError

  const publicPath = Match.value(model.draft.kind).pipe(
    Match.when('micro', () => 'tweet'),
    Match.when('post', () => 'editorial'),
    Match.when('mix', () => 'mixes'),
    Match.exhaustive,
  )

  return h.section(
    [h.Class('page creator-page')],
    [
      h.header(
        [h.Class('creator-header')],
        [
          h.div(
            [h.Class('creator-status')],
            [
              model.draft.editSlug
                ? h.a(
                    [
                      h.Href(`/${publicPath}/${model.draft.editSlug}`),
                      h.Class('btn btn-quiet btn-sm'),
                    ],
                    ['← Back to post'],
                  )
                : h.empty,
              h.span(
                [
                  h.Role('status'),
                  h.AriaLive('polite'),
                  h.DataAttribute('save-state', model.saveState),
                ],
                [
                  model.phase === 'saving'
                    ? 'Saving…'
                    : Match.value(model.saveState).pipe(
                        Match.when('saved-locally', () => 'Draft saved locally'),
                        Match.when('saved', () => 'All changes saved'),
                        Match.when('unsaved', () => 'Unsaved changes'),
                        Match.when('failed', () => 'Not saved'),
                        Match.exhaustive,
                      ),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('creator-actions')],
            [
              validationError && !busy
                ? h.small(
                    [h.Id('creator-continue-hint'), h.Class('creator-actions-hint')],
                    [validationError],
                  )
                : h.empty,
              Button.view(
                {
                  onClick: Message.DiscardRequested(),
                  isDisabled: busy,
                  toView: ({ button }) =>
                    h.button([...button, h.Class('btn btn-quiet')], ['Discard']),
                },
                h,
              ),
              Button.view(
                {
                  onClick: Message.DraftSaveRequested(),
                  isDisabled: busy || !canContinue,
                  toView: ({ button }) =>
                    h.button(
                      [
                        ...button,
                        h.Class('btn'),
                        ...(validationError ? [h.AriaDescribedBy('creator-continue-hint')] : []),
                      ],
                      ['Save draft'],
                    ),
                },
                h,
              ),
              Button.view(
                {
                  onClick: Message.ReviewRequested(),
                  isDisabled: busy || !canContinue,
                  toView: ({ button }) =>
                    h.button(
                      [
                        ...button,
                        h.Class('btn btn-primary'),
                        ...(validationError ? [h.AriaDescribedBy('creator-continue-hint')] : []),
                      ],
                      ['Continue'],
                    ),
                },
                h,
              ),
            ],
          ),
        ],
      ),
      model.error ? h.p([h.Class('form-error'), h.Role('alert')], [model.error]) : h.empty,
      model.episodeError
        ? h.p([h.Class('form-error'), h.Role('alert')], [model.episodeError])
        : h.empty,
      model.draft.kind === 'micro' && model.draft.title.length > TWEET_MAX_LENGTH
        ? h.p(
            [h.Class('form-error'), h.Role('alert')],
            [`Tweets are capped at ${TWEET_MAX_LENGTH} characters (${model.draft.title.length}).`],
          )
        : h.empty,
      model.phase === 'published'
        ? h.p(
            [h.Class('creator-published'), h.Role('status')],
            [
              'Published. ',
              h.a(
                [h.Href(`/${publicPath}/${encodeURIComponent(model.draft.slug)}`)],
                ['View post'],
              ),
            ],
          )
        : h.empty,
      review(model, h, busy, canContinue, {
        publishType: publishType(model, h, busy),
        metadata: metadata(model, h, busy, inputs.principal),
      }),
      model.phase === 'reviewing'
        ? h.empty
        : h.div(
            [h.Class('creator-workspace')],
            [
              h.main(
                [h.Class('creator-canvas')],
                [
                  h.label(
                    [h.Class('creator-title')],
                    [
                      h.span([h.Class('sr-only')], ['Title']),
                      h.textarea([
                        h.Value(model.draft.title),
                        h.AriaLabel('Title'),
                        h.Rows(1),
                        h.Maxlength(model.draft.kind === 'micro' ? TWEET_MAX_LENGTH + 100 : 500),
                        h.Placeholder(
                          model.draft.kind === 'micro' ? 'What’s playing?' : 'Story title',
                        ),
                        h.OnInput((value) => Message.Changed({ field: 'title', value })),
                      ]),
                      model.draft.kind === 'micro'
                        ? h.small([], [`${model.draft.title.length}/${TWEET_MAX_LENGTH}`])
                        : h.empty,
                    ],
                  ),
                  model.draft.kind !== 'mix' ? musicSlot(model, h, busy) : h.empty,
                  musicReferences(model, h),
                  model.draft.kind !== 'mix' && model.draft.postId
                    ? h.section(
                        [h.AriaLabel('Saved post music')],
                        [
                          h.button(
                            [
                              h.Type('button'),
                              h.Class('secondary'),
                              h.Disabled(busy),
                              h.OnClick(Message.ResolvePostMusicRequested()),
                            ],
                            [
                              model.resolvingPostMusic
                                ? 'Resolving music…'
                                : model.draft.musicEntityId
                                  ? 'Re-resolve saved post music'
                                  : 'Resolve saved post music',
                            ],
                          ),
                          h.p(
                            [],
                            [
                              'Uses Music URL, or finds a link in saved content. Saves only the music attachment; it does not publish or save other edits.',
                            ],
                          ),
                          model.postMusicNotice
                            ? h.p([h.Role('status')], [model.postMusicNotice])
                            : h.empty,
                        ],
                      )
                    : h.empty,
                  editor(model, h),
                  composerExtras(model, h),
                  model.draft.kind === 'mix' ? mixFields(model, h, busy) : h.empty,
                ],
              ),
            ],
          ),
    ],
  )
})
