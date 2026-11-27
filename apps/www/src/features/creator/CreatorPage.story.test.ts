import { Story } from '@effect/ui/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { CreatorPageNoDeps } from './CreatorPage'
import { emptyDraft, insertBanner, selection } from './domain'
import {
  GenerateMosaic,
  PauseUpload,
  ReadDraft,
  ReconcileDraft,
  ResolveMusic,
  SaveContent,
  UploadAudio,
  UploadArtwork,
  WriteDraft,
} from './operations'
import { CreatorPageMessage as M } from './state'

const principal = { id: 'author-a', name: 'Author', username: 'author', role: 'admin' }

const props = { url: '/new/tweet', principal }

describe('native creator', () => {
  it.effect(
    'persists dismissal of recovery so an older local draft does not reappear on reload',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)

        s.send(M.UpdatedField({ field: 'title', value: 'Current writing' }))
          .send(M.RequestedRecovery())
          .resolve(
            ReadDraft,
            M.CompletedReadDraft({
              key: 'author-a:micro:new',
              revision: 1,
              draft: { ...emptyDraft('micro', principal.id), title: 'Old recovered draft' },
            }),
          )
          .send(M.ClickedDismissRecovery())
          .expectExact(WriteDraft)
          .resolve(WriteDraft, M.CompletedWriteDraft({ key: 'author-a:micro:new', revision: 1 }))

        assert.isNull(s.model.recovery)
        assert.equal(s.model.draft.title, 'Current writing')
        assert.equal(s.model.localRevision, 1)
      }),
  )

  it('preserves a leading layout directive when replacing a generated banner', () => {
    assert.equal(
      insertBanner(
        '::layout{type="spotlight"}\n\n![Old artwork](https://images.test/old.png)\n\nEssay body',
        'https://images.test/new.png',
      ),
      '::layout{type="spotlight"}\n![Editorial artwork](https://images.test/new.png)\n\nEssay body',
    )
  })

  it.effect('keeps generated mosaic application explicit and guards stale source', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, { ...props, url: '/new/editorial' })

      s.send(M.UpdatedField({ field: 'content', value: 'Original source' }))
        .loaded('diagnostics', [])
        .send(M.RequestedMosaic())
        .expectExact(GenerateMosaic)
        .resolve(
          GenerateMosaic,
          M.SucceededGenerateMosaic({
            operation: 1,
            content: 'Original source',
            url: 'https://images.test/mosaic.png',
          }),
        )

      assert.equal(s.model.draft.thumbnailUrl, '')
      s.send(M.UpdatedField({ field: 'content', value: 'A newer source' }))
        .loaded('diagnostics', [])
        .send(M.ClickedApplyMosaicCover())

      assert.equal(s.model.draft.thumbnailUrl, '')
      assert.include(s.model.error, 'source changed')
    }),
  )

  it.effect('applies generated cover and banner controls without replacing the article', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, { ...props, url: '/new/editorial' })
      const content = '::layout{type="spotlight"}\n\nKeep the article'

      s.send(M.UpdatedField({ field: 'content', value: content }))
        .loaded('diagnostics', [])
        .send(M.RequestedMosaic())
        .resolve(
          GenerateMosaic,
          M.SucceededGenerateMosaic({
            operation: 1,
            content,
            url: 'https://images.test/mosaic.png',
          }),
        )
        .send(M.ClickedApplyMosaicCover())
        .send(M.ClickedApplyMosaicBanner())
        .loaded('diagnostics', [])

      assert.equal(s.model.draft.thumbnailUrl, 'https://images.test/mosaic.png')
      assert.include(s.model.draft.content, 'Keep the article')
      assert.isTrue(s.model.draft.content.startsWith('::layout{type="spotlight"}'))
      assert.include(s.model.draft.content, '![Editorial artwork](https://images.test/mosaic.png)')
    }),
  )

  it.effect('does not drop uploaded artwork when the author keeps typing', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)

      s.send(M.ChoseArtwork({ files: [new File(['image'], 'cover.png', { type: 'image/png' })] }))
        .send(M.UpdatedField({ field: 'title', value: 'Typed during artwork upload' }))
        .resolve(
          UploadArtwork,
          M.SucceededUploadArtwork({
            kind: 'micro',
            revision: 1,
            previousUrl: '',
            url: 'https://images.test/cover.png',
          }),
        )

      assert.equal(s.model.draft.title, 'Typed during artwork upload')
      assert.equal(s.model.draft.thumbnailUrl, 'https://images.test/cover.png')
      assert.isFalse(s.model.artworkBusy)
    }),
  )

  it.effect(
    'publishes an editable revision and discards back to the most recent save, not the original query',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, {
          ...props,
          url: '/new/editorial?edit=essay',
        })

        s.loaded('editable', {
          ...emptyDraft('post', principal.id, 'essay'),
          postId: 'post-a',
          title: 'Saved title',
          content: 'Original saved body',
          slug: 'essay',
          expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
          draft: true,
          creators: [principal],
        })
          .loaded('diagnostics', [])
          .send(M.UpdatedField({ field: 'content', value: 'The published revision' }))
          .loaded('diagnostics', [])
          .send(M.RequestedOpenReview())
          .loaded('preview', { version: 1, blocks: [] })
          .send(M.RequestedPublish())

        const draft = s.model.draft

        assert.equal(draft.expectedUpdatedAt, '2026-11-26T12:00:00.000Z')

        s.resolve(
          SaveContent,
          M.SucceededSaveContent({
            draft,
            revision: 1,
            operation: 1,
            publish: true,
            saved: { id: 'post-a', slug: 'essay', updatedAt: '2026-11-26T12:00:01.000Z' },
          }),
        )
          .resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))
          .send(M.UpdatedField({ field: 'content', value: 'Later unsaved changes' }))
          .loaded('diagnostics', [])
          .send(M.RequestedDiscard())
          .send(M.ConfirmedDiscard())
          .loaded('diagnostics', [])

        assert.equal(s.model.draft.content, 'The published revision')
        assert.equal(s.model.draft.expectedUpdatedAt, '2026-11-26T12:00:01.000Z')

        s.resolve(
          WriteDraft,
          M.CompletedWriteDraft({ key: 'author-a:post:essay', revision: s.model.revision }),
        )
      }),
  )
  it('recognizes all existing authoring entry URLs', () => {
    assert.deepEqual(selection('/new/editorial?edit=essay'), { kind: 'post', slug: 'essay' })
    assert.deepEqual(selection('/new/mix'), { kind: 'mix', slug: null })
    assert.deepEqual(selection('/mix-upload'), { kind: 'mix', slug: null })
    assert.deepEqual(selection('/new/tweet'), { kind: 'micro', slug: null })
  })

  it.effect('preserves edits made during a remote save and reconciles its identity', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)
      s.send(M.UpdatedField({ field: 'title', value: 'First title' }))
      const draft = s.model.draft
      s.send(M.RequestedSave()).expectExact(SaveContent)
      s.send(M.UpdatedField({ field: 'content', value: 'Typed while saving' })).loaded(
        'diagnostics',
        [],
      )
      s.resolve(
        SaveContent,
        M.SucceededSaveContent({
          operation: 1,
          revision: 1,
          draft,
          publish: false,
          saved: { id: 'post-a', slug: 'first-title', updatedAt: '2026-11-26T12:00:00.000Z' },
        }),
      )
      assert.equal(s.model.draft.content, 'Typed while saving')
      assert.equal(s.model.draft.editSlug, 'first-title')
      assert.equal(s.model.draft.postId, 'post-a')
      assert.equal(s.model.savedRevision, 1)
      assert.equal(s.model.revision, 2)
      s.resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))
    }),
  )

  it.effect('keeps local writing after a guarded server revision conflict', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)
      s.send(M.UpdatedField({ field: 'title', value: 'Do not lose this' }))
        .send(M.RequestedSave())
        .resolve(
          SaveContent,
          M.FailedOperation({ operation: 1, message: 'This post changed elsewhere.' }),
        )
      assert.equal(s.model.draft.title, 'Do not lose this')
      assert.equal(s.model.saving, false)
      assert.include(s.model.error, 'changed elsewhere')
    }),
  )

  it.effect(
    'requires review before publishing and retains new edits after publishing an older revision',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.UpdatedField({ field: 'title', value: 'Reviewed title' })).send(
          M.RequestedPublish(),
        )
        assert.lengthOf(s.pending, 0)
        s.send(M.RequestedOpenReview()).send(M.RequestedPublish()).expectExact(SaveContent)
        const draft = s.model.draft
        s.send(M.UpdatedField({ field: 'content', value: 'New unpublished edit' }))
          .loaded('diagnostics', [])
          .resolve(
            SaveContent,
            M.SucceededSaveContent({
              operation: 1,
              revision: 1,
              draft,
              publish: true,
              saved: { id: 'post-a', slug: 'reviewed-title' },
            }),
          )
        assert.equal(s.model.published, false)
        assert.equal(s.model.draft.content, 'New unpublished edit')
        s.resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))
      }),
  )

  it.effect(
    'ignores a stale music resolution instead of overwriting a later attachment choice',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.UpdatedField({ field: 'musicUrl', value: 'https://bandcamp.com/album/old' }))
          .send(M.RequestedMusic())
          .send(M.UpdatedField({ field: 'musicUrl', value: 'https://bandcamp.com/album/new' }))
          .resolve(
            ResolveMusic,
            M.SucceededResolveMusic({
              revision: 1,
              entityType: 'album',
              entityId: 'old',
              title: 'Old result',
              image: null,
            }),
          )
        assert.isNull(s.model.draft.musicEntityId)
        assert.include(s.model.draft.musicUrl, '/new')
      }),
  )

  it.effect('does not replace active writing with a late unsaved-recovery read', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)
      s.send(M.RequestedRecovery())
        .expectExact(ReadDraft)
        .send(M.UpdatedField({ field: 'title', value: 'Already typing' }))
        .resolve(
          ReadDraft,
          M.CompletedReadDraft({
            key: 'author-a:micro:new',
            revision: 0,
            draft: { ...emptyDraft('micro', principal.id), title: 'Old local draft' },
          }),
        )
      assert.equal(s.model.draft.title, 'Already typing')
      assert.isNull(s.model.recovery)
    }),
  )

  it.effect(
    'pauses and resumes the retained multipart upload through its real service command seam',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, { ...props, url: '/new/mix' })
        const file = new File(['audio bytes'], 'mix.mp3', { type: 'audio/mpeg' })
        s.send(M.ChoseAudio({ files: [file] }))
          .expectExact(UploadAudio)
          .send(M.ClickedPauseUpload())
          .resolve(PauseUpload, M.CompletedPauseUpload())
          .resolve(UploadAudio, M.FailedUploadAudio({ message: 'Paused', paused: true }))
        assert.equal(s.model.uploadState, 'paused')
        s.send(M.ClickedResumeUpload())
          .expectExact(UploadAudio)
          .resolve(UploadAudio, M.SucceededUploadAudio({ url: 'https://media.example/mix.mp3' }))
        assert.equal(s.model.draft.audioUrl, 'https://media.example/mix.mp3')
        assert.equal(s.model.uploadState, 'idle')
      }),
  )

  it.effect('does not issue a save for an unauthorized principal', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, {
        ...props,
        principal: { ...principal, role: null },
      })

      s.send(M.UpdatedField({ field: 'title', value: 'Forbidden' })).send(M.RequestedSave())
      assert.lengthOf(s.pending, 0)
      assert.equal(s.model.draft.title, '')
    }),
  )
})
