import { Story } from '@effect/ui/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Predicate } from 'effect'

import { CreatorPageNoDeps } from './CreatorPage'
import { emptyDraft, validation } from './domain'
import {
  GenerateMosaic,
  ReadDraft,
  ReconcileDraft,
  ResolveMusic,
  ResolveQuote,
  SaveContent,
  UploadArtwork,
  UploadAudio,
  WriteDraft,
} from './operations'
import { CreatorPageMessage as M } from './state'

const principal = { id: 'creator', name: 'Creator', username: 'creator', role: 'admin' }

const props = { url: '/new/tweet', principal }

const remote = { id: 'post', slug: 'saved', updatedAt: '2026-11-07T00:00:01.000Z' }

const document = { version: 1, blocks: [] } satisfies { version: 1; blocks: [] }

describe('native creator legacy business parity', () => {
  it.effect('does not format source while its rendered preview is selected', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)

      s.send(M.UpdatedField({ field: 'content', value: 'Keep the source' }))
        .loaded('diagnostics', [])
        .send(M.PickedEditorMode({ mode: 'preview' }))
        .loaded('preview', document)
      const original = s.model

      s.send(M.ClickedFormat({ before: '**', after: '**', sample: 'bold text' }))
      assert.strictEqual(s.model, original)
    }),
  )

  it.effect(
    'preserves unsaved content and metadata when reviewing a new post as another type',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)

        s.send(M.UpdatedField({ field: 'title', value: 'A quoted signal' }))
          .send(M.UpdatedField({ field: 'content', value: 'The original **body**' }))
          .loaded('diagnostics', [])
          .send(M.UpdatedField({ field: 'slug', value: 'my-signal' }))
          .send(M.UpdatedTags({ value: 'radio, community' }))
          .send(M.RequestedOpenReview())
          .loaded('preview', document)
        const original = s.model.draft

        s.send(M.PickedKind({ kind: 'post' }))
        assert.deepEqual(s.model.draft, { ...original, kind: 'post' })
        assert.isTrue(s.model.review)
        s.send(M.PickedKind({ kind: 'micro' }))
        assert.deepEqual(s.model.draft, original)
        assert.isTrue(s.model.review)
      }),
  )

  it.effect('cannot switch a loaded post or mix to another persistence endpoint', () =>
    Effect.gen(function* () {
      for (const kind of ['post', 'mix'] satisfies ReadonlyArray<'post' | 'mix'>) {
        const url = kind === 'post' ? '/new/editorial?edit=saved' : '/new/mix?edit=saved'
        const s = yield* Story.make(CreatorPageNoDeps, { ...props, url })

        s.loaded('editable', {
          ...emptyDraft(kind, principal.id, 'saved'),
          title: 'Saved content',
          draft: true,
          creators: [principal],
        })
        const loaded = s.model

        s.send(M.PickedKind({ kind: kind === 'post' ? 'mix' : 'post' }))
        assert.strictEqual(s.model, loaded)
        assert.equal(s.model.draft.kind, kind)
        assert.equal(s.model.draft.editSlug, 'saved')
      }
    }),
  )

  it.effect(
    'restores a new locally saved draft with its pending attachment, body and uncommitted tags',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)

        const draft = {
          ...emptyDraft('micro', principal.id),
          title: 'Local writing',
          content: '::layout{width="wide"}\n\nRecovered body',
          musicUrl: 'https://music.test/pending',
          creatorIds: ['creator', 'collaborator'],
          tags: ['one', 'two'],
        }

        s.send(M.RequestedRecovery())
          .resolve(
            ReadDraft,
            M.CompletedReadDraft({
              key: 'creator:micro:new',
              revision: 0,
              draft,
            }),
          )
          .loaded('diagnostics', [])
        assert.deepEqual(s.model.draft, draft)
        assert.isTrue(s.model.bodyOpen)
        assert.isFalse(s.model.focusBody)
        assert.equal(s.model.attachment, 'music')
        assert.equal(s.model.tagsInput, 'one, two')
        assert.isNull(s.model.recovery)
        s.send(M.UpdatedTags({ value: 'one, two, ' })).send(
          M.UpdatedField({ field: 'title', value: 'Edited title' }),
        )
        assert.equal(s.model.tagsInput, 'one, two, ')
        assert.deepEqual(s.model.draft.tags, ['one', 'two'])
        assert.equal(s.model.draft.content, draft.content)
      }),
  )

  it.effect(
    'records remote success separately from local cleanup failure and rejects duplicate terminal results',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.UpdatedField({ field: 'title', value: 'Published text' }))
          .send(M.RequestedOpenReview())
          .send(M.RequestedPublish())
        const draft = s.model.draft

        const success = M.SucceededSaveContent({
          operation: 1,
          revision: 1,
          draft,
          saved: remote,
          publish: true,
        })

        s.resolve(SaveContent, success).resolve(
          ReconcileDraft,
          M.FailedReconcileDraft({ operation: 1, message: 'Local cleanup failed' }),
        )
        const completed = s.model

        assert.isTrue(completed.published)
        assert.equal(completed.draft.postId, 'post')
        assert.equal(completed.draft.editSlug, 'saved')
        assert.equal(completed.localError, 'Local cleanup failed')
        assert.isNull(completed.error)
        assert.isFalse(completed.saving)
        s.send(success).send(M.FailedOperation({ operation: 1, message: 'Old failure' }))
        assert.strictEqual(s.model, completed)
        s.send(M.RequestedPublish())
        assert.lengthOf(s.pending, 0)
        s.send(M.RequestedSave()).send(success)
        assert.equal(s.model.operation, 2)
        assert.isTrue(s.model.saving)
        s.resolve(SaveContent, M.FailedOperation({ operation: 2, message: 'Retry failed' }))
      }),
  )

  it.effect(
    'keeps newer writing and autosave failure while a remote write owns the earlier revision',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.UpdatedField({ field: 'title', value: 'First title' })).send(M.RequestedSave())
        const draft = s.model.draft
        s.send(M.UpdatedField({ field: 'title', value: 'New title' }))
          .send(M.RequestedAutosave())
          .expectExact(SaveContent, WriteDraft)
          .resolve(
            WriteDraft,
            M.FailedWriteDraft({ key: 'creator:micro:new', revision: 2, message: 'Full' }),
          )
        assert.isTrue(s.model.saving)
        s.send(M.RequestedSave())
        assert.lengthOf(s.pending, 1)
        s.resolve(
          SaveContent,
          M.SucceededSaveContent({
            operation: 1,
            revision: 1,
            draft,
            saved: remote,
            publish: false,
          }),
        ).resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))
        assert.equal(s.model.draft.title, 'New title')
        assert.equal(s.model.localError, 'Full')
        assert.equal(s.model.savedRevision, 1)
        assert.equal(s.model.revision, 2)
      }),
  )

  it.effect(
    'remote success supersedes both earlier and delayed autosave errors for its saved revision',
    () =>
      Effect.gen(function* () {
        for (const late of [false, true]) {
          const s = yield* Story.make(CreatorPageNoDeps, props)
          s.send(M.UpdatedField({ field: 'title', value: 'Saved content' })).send(M.RequestedSave())
          const draft = s.model.draft

          const failure = M.FailedWriteDraft({
            key: 'creator:micro:new',
            revision: 1,
            message: 'Full',
          })

          if (!late) s.send(failure)
          s.resolve(
            SaveContent,
            M.SucceededSaveContent({
              operation: 1,
              revision: 1,
              draft,
              saved: remote,
              publish: false,
            }),
          ).resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))

          if (late) s.send(failure)
          assert.isNull(s.model.localError)
          assert.isNull(s.model.error)
          assert.equal(s.model.savedRevision, s.model.revision)
        }
      }),
  )

  it.effect('ignores outdated local completion and failure without dismissing review', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)
      s.send(M.UpdatedField({ field: 'title', value: 'First' }))
        .send(M.UpdatedField({ field: 'title', value: 'Second' }))
        .send(M.RequestedOpenReview())
      const reviewed = s.model
      s.send(M.CompletedWriteDraft({ key: 'creator:micro:new', revision: 1 })).send(
        M.FailedWriteDraft({ key: 'creator:micro:new', revision: 1, message: 'Old' }),
      )
      assert.strictEqual(s.model, reviewed)
      s.send(M.CompletedWriteDraft({ key: 'creator:micro:new', revision: 2 }))
      assert.isTrue(s.model.review)
      assert.equal(s.model.localRevision, 2)
    }),
  )

  it.effect(
    'invalidates discarded remote and local ownership without claiming to undo a sent publication',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.UpdatedField({ field: 'title', value: 'Sent publication' }))
          .send(M.RequestedOpenReview())
          .send(M.RequestedPublish())
        const draft = s.model.draft
        s.send(M.RequestedDiscard())
          .send(M.ConfirmedDiscard())
          .resolve(
            WriteDraft,
            M.CompletedWriteDraft({ key: 'creator:micro:new', revision: s.model.revision }),
          )
        const discarded = s.model
        s.resolve(
          SaveContent,
          M.SucceededSaveContent({
            operation: 1,
            revision: 1,
            draft,
            saved: remote,
            publish: true,
          }),
        )
          .send(M.FailedOperation({ operation: 1, message: 'Late remote error' }))
          .send(M.FailedReconcileDraft({ operation: 1, message: 'Late cleanup' }))
        assert.strictEqual(s.model, discarded)
        assert.isNull(s.model.draft.postId ?? null)
      }),
  )

  it.effect(
    'retains transient invalid episode input across unrelated edits and blocks both writes until corrected',
    () =>
      Effect.gen(function* () {
        for (const value of ['0', '-2', '1.5', 'Infinity', 'NaN', '9007199254740992']) {
          const s = yield* Story.make(CreatorPageNoDeps, { ...props, url: '/new/mix' })
          s.send(M.UpdatedField({ field: 'audioUrl', value: 'https://media.test/mix.mp3' }))
            .send(M.UpdatedEpisode({ value }))
            .send(M.UpdatedField({ field: 'title', value: 'A mix' }))
            .send(M.RequestedOpenReview())
            .send(M.RequestedPublish())
            .send(M.RequestedSave())
          assert.lengthOf(s.pending, 0)
          assert.equal(s.model.episodeInput, value)
          assert.equal(s.model.episodeError, 'Episode number must be a positive whole number.')
          s.send(M.UpdatedEpisode({ value: '7' })).send(M.RequestedSave())
          assert.equal(s.model.draft.episodeNumber, 7)
          s.resolve(SaveContent, M.FailedOperation({ operation: 1, message: 'Fixture completion' }))
        }
      }),
  )

  it.effect('keeps quoted edits immutable independently of rendered disabled controls', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, { ...props, url: '/new/tweet?edit=existing' })
      s.loaded('editable', {
        ...emptyDraft('micro', principal.id, 'existing'),
        title: 'Saved',
        quotedPostId: 'original',
        draft: true,
        creators: [principal],
      })
      const original = s.model
      s.send(M.UpdatedField({ field: 'quoteUrl', value: 'https://goosebumps.fm/tweet/other' }))
        .send(M.RequestedQuote())
        .send(M.ClickedRemoveQuote())
        .send(M.SucceededResolveQuote({ revision: 0, id: 'other', title: 'Other' }))
      assert.strictEqual(s.model, original)
    }),
  )

  it.effect(
    'rejects stale same-URL music and quote successes and failures but keeps unrelated writing',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        const url = 'https://music.test/album'
        s.send(M.UpdatedField({ field: 'musicUrl', value: url })).send(M.RequestedMusic())
        const first = s.model.musicRevision
        s.send(M.UpdatedField({ field: 'musicUrl', value: 'https://music.test/other' }))
          .send(M.UpdatedField({ field: 'musicUrl', value: url }))
          .send(M.RequestedMusic())
        const latest = s.model.musicRevision
        s.send(
          M.SucceededResolveMusic({
            revision: first,
            entityType: 'album',
            entityId: 'old',
            title: 'Old',
            image: null,
          }),
        )
          .send(M.FailedResolveMusic({ revision: first, message: 'Old failure' }))
          .send(M.UpdatedField({ field: 'title', value: 'Unrelated writing' }))
          .resolve(
            ResolveMusic,
            M.SucceededResolveMusic({
              revision: latest,
              entityType: 'album',
              entityId: 'current',
              title: 'Current',
              image: null,
            }),
          )
          .loaded('attachmentPreview', document)
          .loaded(
            'references',
            {
              entityType: 'album',
              entityId: 'current',
              offset: 0,
              attempt: s.model.referenceRevision,
            },
            { data: [], pagination: { hasMore: false } },
          )
        assert.equal(s.model.draft.title, 'Unrelated writing')
        assert.equal(s.model.draft.musicEntityId, 'current')
        s.send(M.ClickedRemoveMusic()).send(
          M.SucceededResolveMusic({
            revision: latest,
            entityType: 'album',
            entityId: 'current',
            title: 'Current',
            image: null,
          }),
        )
        assert.isNull(s.model.draft.musicEntityId)
        assert.isNull(s.model.draft.musicEntityType)
        assert.equal(s.model.draft.musicUrl, '')

        s.send(
          M.UpdatedField({ field: 'quoteUrl', value: 'https://goosebumps.fm/tweet/current' }),
        ).send(M.RequestedQuote())
        const quote = s.model.quoteRevision
        s.send(M.UpdatedField({ field: 'quoteUrl', value: 'https://goosebumps.fm/tweet/other' }))
          .send(M.UpdatedField({ field: 'quoteUrl', value: 'https://goosebumps.fm/tweet/current' }))
          .send(M.RequestedQuote())
          .send(M.SucceededResolveQuote({ revision: quote, id: 'stale', title: 'Stale' }))
          .send(M.FailedResolveQuote({ revision: quote, message: 'Stale quote failure' }))
          .resolve(
            ResolveQuote,
            M.SucceededResolveQuote({
              revision: s.model.quoteRevision,
              id: 'current',
              title: 'Current',
            }),
          )
        assert.equal(s.model.draft.quotedPostId, 'current')
        assert.isNull(s.model.error)
      }),
  )

  it.effect('ignores discarded hydration and artwork results, including delayed failures', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)
      s.send(M.RequestedRecovery()).send(
        M.ChoseArtwork({ files: [new File(['image'], 'cover.png')] }),
      )
      const revision = s.model.artworkRevision
      s.send(M.RequestedDiscard())
        .send(M.ConfirmedDiscard())
        .resolve(
          WriteDraft,
          M.CompletedWriteDraft({ key: 'creator:micro:new', revision: s.model.revision }),
        )
      const discarded = s.model
      s.resolve(
        ReadDraft,
        M.FailedReadDraft({ key: 'creator:micro:new', revision: 0, message: 'Old read' }),
      ).resolve(
        UploadArtwork,
        M.FailedUploadArtwork({ kind: 'micro', revision, message: 'Old image error' }),
      )
      assert.strictEqual(s.model, discarded)
    }),
  )

  it.effect(
    'guards mosaic ownership across duplicate requests, dismissal and same-source regeneration',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.RequestedMosaic()).send(M.RequestedMosaic()).expectExact(GenerateMosaic)
        s.send(M.ClickedDiscardMosaic()).send(M.RequestedMosaic())
        const pending = s.model
        s.send(M.SucceededGenerateMosaic({ operation: 1, content: '', url: 'old.png' })).send(
          M.FailedGenerateMosaic({ operation: 1, content: '', message: 'Old failure' }),
        )
        assert.strictEqual(s.model, pending)
        s.resolve(
          GenerateMosaic,
          M.FailedGenerateMosaic({ operation: 2, content: '', message: 'No images' }),
        )
        assert.equal(s.model.error, 'No images')
        assert.equal(s.model.draft.thumbnailUrl, '')
      }),
  )

  it.effect('uses cumulative native reference queries and the actual prior page size', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(CreatorPageNoDeps, props)

      const reference = {
        id: 'one',
        slug: 'one',
        title: 'Earlier thoughts',
        content: null,
        creators: [],
      }

      s.send(M.UpdatedField({ field: 'title', value: 'Current thoughts' }))
        .send(
          M.PickedMusic({ entityType: 'track', entityId: 'track', title: 'Track', image: null }),
        )
        .loaded('attachmentPreview', document)

      const args = {
        entityType: 'track',
        entityId: 'track',
        offset: 0,
        attempt: s.model.referenceRevision,
      } satisfies { entityType: 'track'; entityId: string; offset: number; attempt: number }

      s.loaded('references', args, { data: [reference], pagination: { hasMore: true } })
        .send(M.ClickedMoreReferences())
        .loaded(
          'references',
          { ...args, offset: 1 },
          { data: [{ ...reference, id: 'two', slug: 'two' }], pagination: { hasMore: false } },
        )
      assert.equal(s.model.referenceOffset, 1)
      assert.deepEqual(
        s.queries.references.flatMap(({ result }) =>
          Predicate.isTagged(result, 'Success') ? result.value.data.map(({ id }) => id) : [],
        ),
        ['one', 'two'],
      )
      s.send(M.ClickedRemoveMusic())
      assert.lengthOf(s.queries.references, 0)
    }),
  )

  it.effect(
    'preserves collaborators, rejects unknown selection and cannot remove the last author',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.RequestedRecovery())
          .resolve(
            ReadDraft,
            M.CompletedReadDraft({
              key: 'creator:micro:new',
              revision: 0,
              draft: { ...emptyDraft('micro', 'creator'), creatorIds: ['creator', 'restored'] },
            }),
          )
          .send(M.ClickedRecover())
          .send(M.UpdatedAuthorQuery({ value: 'Ada' }))
          .loaded('authors', [{ id: 'ada', name: 'Ada', username: 'ada' }])
          .send(M.PickedAuthor({ id: 'ada' }))
        const selected = s.model
        s.send(M.PickedAuthor({ id: 'ada' })).send(M.PickedAuthor({ id: 'not-a-result' }))
        assert.strictEqual(s.model, selected)
        assert.deepEqual(s.model.draft.creatorIds, ['creator', 'restored', 'ada'])
        s.send(M.ClickedRemoveAuthor({ id: 'restored' }))
          .send(M.ClickedRemoveAuthor({ id: 'creator' }))
          .send(M.ClickedRemoveAuthor({ id: 'ada' }))
        assert.deepEqual(s.model.draft.creatorIds, ['ada'])
      }),
  )

  it.effect(
    'keeps bodies optional by default, reveals inserts and recovery, and retains the opened editor after clearing',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        assert.isFalse(s.model.bodyOpen)
        s.send(M.UpdatedField({ field: 'title', value: 'A title' }))
        assert.isFalse(s.model.bodyOpen)
        s.send(M.PickedEditorMode({ mode: 'preview' })).send(M.ToggledBodyEditor({ open: true }))
        assert.equal(s.model.mode, 'source')
        assert.isTrue(s.model.focusBody)
        s.send(M.UpdatedMediaUrl({ value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
          .send(M.ClickedInsertMedia())
          .loaded('diagnostics', [])
        assert.equal(
          s.model.draft.content,
          '::media{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}',
        )
        s.send(M.ToggledBodyEditor({ open: false }))
        assert.isTrue(s.model.bodyOpen)
        s.send(M.UpdatedField({ field: 'content', value: '' }))
        assert.isTrue(s.model.bodyOpen)
        s.send(M.RequestedDiscard())
          .send(M.ConfirmedDiscard())
          .resolve(
            WriteDraft,
            M.CompletedWriteDraft({ key: 'creator:micro:new', revision: s.model.revision }),
          )
        assert.isFalse(s.model.bodyOpen)
      }),
  )

  it.effect(
    'normalizes only playable media, inserts canonical directives and preserves authored source',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)

        for (const value of [
          'https://bandcamp.com',
          'https://babakushi.bandcamp.com/music',
          'not a url',
        ]) {
          s.send(M.UpdatedMediaUrl({ value })).send(M.ClickedInsertMedia())
          assert.equal(s.model.draft.content, '')
          assert.isNotNull(s.model.mediaError)
        }

        s.send(M.UpdatedField({ field: 'content', value: 'Opening paragraph.' }))
          .loaded('diagnostics', [])
          .send(M.UpdatedMediaUrl({ value: 'http://babakushi.bandcamp.com/track/the-vigil' }))
          .send(M.ClickedInsertMedia())
          .loaded('diagnostics', [])
        assert.equal(
          s.model.draft.content,
          'Opening paragraph.\n\n::media{url="https://babakushi.bandcamp.com/track/the-vigil"}',
        )
        assert.equal(s.model.mediaUrl, '')
        assert.equal(
          validation({ ...s.model.draft, title: 'x'.repeat(256) }),
          'Tweets are capped at 255 characters.',
        )
        assert.isNull(validation({ ...s.model.draft, title: 'x'.repeat(256), kind: 'post' }))
      }),
  )

  it.effect(
    'commits successive paused checkpoints even when completion overtakes streamed progress',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.ChoseAudio({ files: [new File(['abcdefghijk'], 'mix.mp3')] }))
          .resolve(
            UploadAudio,
            M.FailedUploadAudio({ paused: true, message: 'Paused', checkpointPercent: 36 }),
          )
          .send(M.ProgressedUpload({ percent: 36 }))
        assert.equal(s.model.uploadPercent, 36)
        s.send(M.ClickedResumeUpload())
          .send(M.ProgressedUpload({ percent: 36 }))
          .resolve(
            UploadAudio,
            M.FailedUploadAudio({ paused: true, message: 'Paused', checkpointPercent: 72 }),
          )
          .send(M.ProgressedUpload({ percent: 36 }))
          .send(M.ProgressedUpload({ percent: 72 }))
        assert.equal(s.model.uploadState, 'paused')
        assert.equal(s.model.uploadPercent, 72)
      }),
  )

  it.effect(
    'does not let delayed progress roll a paused checkpoint backward and allows a separate save',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(CreatorPageNoDeps, props)
        s.send(M.UpdatedField({ field: 'title', value: 'Draft' }))
          .send(M.ChoseAudio({ files: [new File(['audio'], 'mix.mp3')] }))
          .send(M.ProgressedUpload({ percent: 36 }))
          .resolve(UploadAudio, M.FailedUploadAudio({ paused: true, message: 'Paused' }))
          .send(M.ProgressedUpload({ percent: 0 }))
        assert.equal(s.model.uploadPercent, 36)
        s.send(M.RequestedSave()).resolve(
          SaveContent,
          M.FailedOperation({ operation: 1, message: 'Fixture completion' }),
        )
      }),
  )
})
