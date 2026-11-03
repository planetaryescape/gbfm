import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { PersistDraft, Save } from './command'
import { initialModel } from './init'
import { Message } from './message'
import {
  CreatorRequestError,
  CreatorService,
  CreatorStorageError,
  type CreatorOperations,
} from './services'
import { update } from './update'

const input = { kind: 'micro' as const, editSlug: null, creatorId: 'creator', authorized: true }

const ready = () => {
  const model = initialModel(input)

  return { ...model, phase: 'writing' as const, draft: { ...model.draft, title: 'Draft' } }
}

const service = (overrides: Partial<CreatorOperations> = {}): CreatorOperations => ({
  findMusicReferences: () => Effect.die('Unexpected references'),
  searchAuthors: () => Effect.die('Unexpected authors'),
  readLocalDraft: () => Effect.die('Unexpected local read'),
  writeLocalDraft: () => Effect.void,
  clearLocalDraft: () => Effect.void,
  loadEditable: () => Effect.die('Unexpected editable read'),
  resolveMusic: () => Effect.die('Unexpected music'),
  resolveQuote: () => Effect.die('Unexpected quote'),
  resolvePostMusic: () => Effect.die('Unexpected post music'),
  save: () => Effect.succeed({ id: 'post', slug: 'saved' }),
  renderPreview: () => Effect.die('Unexpected preview'),
  uploadImage: () => Effect.die('Unexpected image'),
  generateMosaic: () => Effect.die('Unexpected mosaic'),
  ...overrides,
})

describe('creator publication and durability characterization', () => {
  it('does not let local save completion change an active remote save or a published outcome', () => {
    const saving = update(ready(), Message.DraftSaveRequested()).model
    expect(update(saving, Message.LocallySaved()).model).toBe(saving)

    const published = update(
      saving,
      Message.Saved({ id: 'post', slug: 'post', published: true }),
    ).model

    expect(update(published, Message.LocallySaved()).model).toBe(published)
    expect(published.draft).toMatchObject({ editSlug: 'post', postId: 'post' })

    const edited = update(
      published,
      Message.Changed({ field: 'content', value: 'Later edits' }),
    ).model

    expect(edited.phase).toBe('published')
    expect(edited.saveState).toBe('unsaved')
  })

  it('currently issues duplicate save and publish commands and accepts either completion order', () => {
    const saving = update(ready(), Message.DraftSaveRequested()).model
    expect(update(saving, Message.DraftSaveRequested()).commands?.map(({ name }) => name)).toEqual([
      'Creator.Save',
    ])
    const publishing = update(saving, Message.PublishRequested())
    expect(publishing.commands?.map(({ name }) => name)).toContain('Creator.Save')

    const published = update(
      publishing.model,
      Message.Saved({ id: 'post', slug: 'published', published: true }),
    ).model

    expect(
      update(published, Message.Saved({ id: 'post', slug: 'draft', published: false })).model.phase,
    ).toBe('writing')
  })

  it('currently treats remote success followed by local cleanup failure as save failure', async () => {
    const writes: Array<boolean> = []
    const command = Save({ draft: ready().draft, creatorId: input.creatorId, publish: true })

    const result = await Effect.runPromise(
      command.effect.pipe(
        Effect.provideService(
          CreatorService,
          service({
            save: ({ publish }) =>
              Effect.sync(() => {
                writes.push(publish)

                return { id: 'post', slug: 'saved' }
              }),
            clearLocalDraft: () =>
              Effect.fail(
                new CreatorStorageError({ operation: 'clear', message: 'Local cleanup failed' }),
              ),
          }),
        ),
      ),
    )

    expect(writes).toEqual([true])
    expect(result).toEqual(Message.Failed({ operation: 'save', message: 'Local cleanup failed' }))
    expect(update(ready(), result).model).toMatchObject({ phase: 'writing', saveState: 'failed' })
  })

  it('reports remote write failure without clearing the local draft', async () => {
    const cleared: Array<string> = []

    const result = await Effect.runPromise(
      Save({ draft: ready().draft, creatorId: input.creatorId, publish: false }).effect.pipe(
        Effect.provideService(
          CreatorService,
          service({
            save: () =>
              Effect.fail(
                new CreatorRequestError({ operation: 'save', status: 503, message: 'Unavailable' }),
              ),
            clearLocalDraft: (key) =>
              Effect.sync(() => {
                cleared.push(key)
              }),
          }),
        ),
      ),
    )

    expect(cleared).toEqual([])
    expect(result).toEqual(Message.Failed({ operation: 'save', message: 'Unavailable' }))
  })

  it('currently lets autosave failure end the saving phase while remote work remains pending', async () => {
    const saving = update(ready(), Message.DraftSaveRequested()).model

    const result = await Effect.runPromise(
      PersistDraft({ draft: saving.draft, key: 'micro:new' }).effect.pipe(
        Effect.provideService(
          CreatorService,
          service({
            writeLocalDraft: () =>
              Effect.fail(new CreatorStorageError({ operation: 'write', message: 'Full' })),
          }),
        ),
      ),
    )

    const failed = update(saving, result).model
    expect(failed).toMatchObject({ phase: 'writing', saveState: 'failed', error: 'autosave: Full' })
    expect(
      update(failed, Message.Saved({ id: 'post', slug: 'saved', published: true })).model.phase,
    ).toBe('published')
  })

  it('closes review independently of save outcome and does not cancel a pending remote save on discard', () => {
    const reviewed = update(ready(), Message.ReviewRequested()).model
    expect(reviewed.phase).toBe('reviewing')
    const closed = update(reviewed, Message.ReviewClosed()).model
    expect(closed.phase).toBe('writing')
    const pending = update(reviewed, Message.PublishRequested()).model
    const discarded = update(pending, Message.DiscardRequested())
    expect(discarded.commands).toBeUndefined()
    expect(discarded.model.draft.title).toBe('')

    const late = update(
      discarded.model,
      Message.Saved({ id: 'late', slug: 'late', published: true }),
    ).model

    expect(late.phase).toBe('published')
    expect(late.draft).toMatchObject({ title: '', editSlug: 'late', postId: 'late' })
  })

  it('retains the preview document during refresh and accepts only the current content key', () => {
    const document = { version: 1 as const, blocks: [] }
    const model = { ...ready(), draft: { ...ready().draft, content: 'first' } }
    const previewing = update(model, Message.EditorModeChanged({ mode: 'preview' })).model
    const loaded = update(previewing, Message.PreviewLoaded({ content: 'first', document })).model
    const edited = update(loaded, Message.Changed({ field: 'content', value: 'second' })).model
    expect(edited.previewDocument).toEqual(document)
    expect(edited.preview).toBe('loading')
    expect(update(edited, Message.PreviewFailed({ content: 'first' })).model).toBe(edited)
    expect(update(edited, Message.PreviewLoaded({ content: 'first', document })).model).toBe(edited)
    expect(update(edited, Message.DiagnosticsFailed({ content: 'first' })).model).toBe(edited)
    const searched = update(edited, Message.AuthorQueryChanged({ value: 'new' })).model
    expect(update(searched, Message.AuthorSearchFailed({ query: 'old' })).model).toBe(searched)
  })

  it('currently accepts an old same-post music attachment after editing its URL, while preserving other edits', () => {
    const saved = {
      ...ready(),
      draft: { ...ready().draft, postId: 'post', editSlug: 'post', musicUrl: 'https://old.test' },
    }

    const pending = update(saved, Message.ResolvePostMusicRequested()).model
    expect(update(pending, Message.PublishRequested()).commands).toBeUndefined()
    expect(update(pending, Message.DraftSaveRequested()).commands).toBeUndefined()

    const edited = update(
      pending,
      Message.Changed({ field: 'musicUrl', value: 'https://new.test' }),
    ).model

    const content = update(
      edited,
      Message.Changed({ field: 'content', value: 'Unsaved content' }),
    ).model

    const resolved = update(
      content,
      Message.PostMusicResolved({
        postId: 'post',
        entityId: 'old',
        entityType: 'track',
        title: 'Old',
        artistNames: [],
        coverImageUrl: null,
        url: 'https://old.test',
      }),
    ).model

    expect(resolved.draft).toMatchObject({
      musicUrl: 'https://old.test',
      content: 'Unsaved content',
    })
    expect(resolved.resolvingPostMusic).toBe(false)
  })

  it('serializes upload UI actions while leaving save and upload lifetimes independent', () => {
    const selected = new File(['audio'], 'mix.mp3')
    const uploading = update(ready(), Message.AudioChosen({ files: [selected] })).model
    expect(update(uploading, Message.AudioChosen({ files: [selected] })).commands).toBeUndefined()
    expect(
      update(uploading, Message.DraftSaveRequested()).commands?.map(({ name }) => name),
    ).toEqual(['Creator.Save'])
    const pausing = update(uploading, Message.UploadPauseRequested()).model
    expect(update(pausing, Message.UploadPauseAcknowledged()).model).toBe(pausing)
    expect(update(pausing, Message.UploadResumeRequested()).commands).toBeUndefined()
    const paused = update(pausing, Message.UploadPaused({ percent: 50 })).model
    expect(update(paused, Message.UploadProgressed({ percent: 20 })).model).toBe(paused)
    const cancelling = update(paused, Message.UploadCancelRequested()).model
    expect(update(cancelling, Message.UploadCancelRequested()).commands).toBeUndefined()
    const failed = update(cancelling, Message.UploadFailed({ message: 'Abort failed' })).model
    expect(update(failed, Message.UploadResumeRequested()).commands).toHaveLength(1)
    const cancelled = update(failed, Message.UploadCancelled()).model
    expect(cancelled).toMatchObject({ uploadState: 'idle', uploadPercent: 0 })
  })
})
