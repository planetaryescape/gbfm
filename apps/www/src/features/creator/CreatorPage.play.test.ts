import { Component } from '@effect/ui'
import { HtmlLocator, HtmlPlay } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type {
  RichContentBlock,
  RichContentDiagnostic,
  RichContentDocument,
  RichContentInline,
} from '@gbfm/rich-content/schema'
import { Context, Data, Deferred, Effect, Layer, Stream } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'

import { CreatorPageNoDeps, creatorRuntimeLayer as creatorCommands } from './CreatorPage'
import { emptyDraft } from './domain'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { GetDiagnostics, GetEditable, GetPreview } from './queries'
import {
  CreatorRequestError,
  CreatorService,
  CreatorServiceLive,
  CreatorStorageError,
  type CreatorDraft,
} from './services'
import { CreatorPageMessage as M } from './state'
import { CreatorUpload } from './upload/runtime'

const Block = Data.taggedEnum<RichContentBlock>()

const creatorRuntimeLayer = creatorCommands.pipe(Layer.provide(CreatorLegacyRecoveryLive))

const Inline = Data.taggedEnum<RichContentInline>()

class DraftLog extends Context.Service<
  DraftLog,
  {
    readonly writes: Array<{ readonly key: string; readonly draft: CreatorDraft }>
  }
>()('test/creator/DraftLog') {}

const service = Layer.effect(
  CreatorService,
  Effect.gen(function* () {
    const base = yield* CreatorService
    const log = yield* DraftLog

    return {
      ...base,
      readLocalDraft: () => Effect.succeed(null),
      writeLocalDraft: (key: string, draft: CreatorDraft) =>
        Effect.sync(() => {
          log.writes.push({ key, draft })
        }),
    }
  }),
).pipe(Layer.provide(CreatorServiceLive))

const upload = Layer.succeed(CreatorUpload, {
  start: () => Effect.succeed('https://media.example/mix.mp3'),
  resume: Effect.succeed('https://media.example/mix.mp3'),
  pause: Effect.void,
  cancel: Effect.void,
  progress: Stream.empty,
})

const TestCreator = CreatorPageNoDeps.pipe(
  Component.provide(creatorRuntimeLayer.pipe(Layer.provide(service), Layer.provideMerge(upload))),
)

const client = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://gbfm.test')))

it.layer(
  Layer.mergeAll(
    TestHost.layer(),
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.sync(DraftLog, () => ({ writes: [] })),
  ),
  {
    buildPerTest: true,
  },
)('native creator runtime', (it) => {
  it.effect(
    'uses the attached server revision on the next save without losing unsaved writing',
    () =>
      Effect.gen(function* () {
        const before = '2026-11-26T12:00:00.000Z'
        const after = '2026-11-26T12:00:01.000Z'
        const revisions: Array<string | undefined> = []
        const savedTitles: Array<string> = []

        const musicService = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            resolvePostMusic: (postId: string, url: string, expectedUpdatedAt?: string) =>
              Effect.sync(() => {
                revisions.push(expectedUpdatedAt)

                return {
                  postId,
                  url,
                  entityType: 'track',
                  entityId: 'track-a',
                  title: 'Attached saved-post track',
                  artistNames: [],
                  coverImageUrl: null,
                  updatedAt: after,
                }
              }),
            save: ({ draft }: { readonly draft: CreatorDraft }) =>
              Effect.sync(() => {
                revisions.push(draft.expectedUpdatedAt)
                savedTitles.push(draft.title)

                return { id: 'post-a', slug: 'saved', updatedAt: after }
              }),
            reconcileLocalDraft: () => Effect.void,
          })),
        ).pipe(Layer.provide(service))

        const ComponentUnderTest = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              creatorRuntimeLayer,
              GetEditable.toLayer(() =>
                Effect.succeed({
                  ...emptyDraft('post', 'author-a', 'saved'),
                  postId: 'post-a',
                  title: 'Saved title',
                  expectedUpdatedAt: before,
                  draft: true,
                  creators: [],
                }),
              ),
            ).pipe(Layer.provide(musicService), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(ComponentUnderTest, {
          url: '/new/editorial?edit=saved',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        })

        yield* play
          .expect(HtmlLocator.role('textbox', { name: 'Title' }))
          .toHaveValue('Saved title')
        yield* play.type(HtmlLocator.role('textbox', { name: 'Title' }), 'Unsaved writing')
        yield* play.click(HtmlLocator.role('button', { name: 'Music' }))
        yield* play.type(
          HtmlLocator.role('textbox', { name: 'Music URL' }),
          'https://music.test/track',
        )
        yield* play.click(HtmlLocator.role('button', { name: 'Attach & save music' }))
        yield* play.expect(Locator.text('Music attachment saved.')).toExist()
        yield* play
          .expect(HtmlLocator.role('textbox', { name: 'Title' }))
          .toHaveValue('Unsaved writing')
        yield* play.click(HtmlLocator.role('button', { name: 'Save draft' }))
        yield* play.expect(Locator.text('Draft saved privately.')).toExist()
        assert.deepEqual(revisions, [before, after])
        assert.deepEqual(savedTitles, ['Unsaved writing'])
      }),
  )

  it.effect(
    'keeps the latest same-URL attachment after a delayed failure and inserts its canonical music directive',
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<never, CreatorRequestError>()
        const urls: Array<string> = []

        const musicService = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            resolveMusic: (url: string) =>
              Effect.suspend(() => {
                urls.push(url)

                if (urls.length === 1)
                  return Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                  )

                return Effect.succeed({
                  entityType: 'album',
                  entityId: 'current-album',
                  title: 'Current attached album',
                  artistNames: [],
                  coverImageUrl: null,
                })
              }),
          })),
        ).pipe(Layer.provide(service))

        const ComponentUnderTest = CreatorPageNoDeps.pipe(
          Component.provide(
            creatorRuntimeLayer.pipe(Layer.provide(musicService), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(ComponentUnderTest, {
          url: '/new/tweet',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        })

        const url = 'https://music.test/album'

        yield* play.click(HtmlLocator.role('button', { name: 'Music' }))
        yield* play.type(HtmlLocator.role('textbox', { name: 'Music URL' }), url)
        yield* play.click(HtmlLocator.role('button', { name: 'Attach music' }))
        yield* Deferred.await(entered)
        yield* play.type(
          HtmlLocator.role('textbox', { name: 'Music URL' }),
          'https://music.test/other',
        )
        yield* play.type(HtmlLocator.role('textbox', { name: 'Music URL' }), url)
        yield* play.click(HtmlLocator.role('button', { name: 'Attach music' }))
        yield* play.expect(Locator.text('Current attached album')).toExist()
        yield* Deferred.fail(
          release,
          new CreatorRequestError({
            operation: 'resolve music',
            status: 500,
            message: 'Old attachment failure',
          }),
        )
        yield* play.expect(Locator.text('Old attachment failure')).toBeAbsent()
        yield* play.expect(Locator.text('Current attached album')).toExist()
        play.root.send(M.UpdatedField({ field: 'content', value: 'Opening paragraph.' }))
        yield* play.click(HtmlLocator.role('button', { name: 'Insert music in body' }))
        yield* play
          .expect(HtmlLocator.role('textbox', { name: 'Body source', hidden: true }))
          .toHaveValue('Opening paragraph.\n\n::music{type="album" id="current-album"}')
        assert.deepEqual(urls, [url, url])
      }),
  )

  it.effect(
    'retains remote identity and newer writing when the real reconciliation command fails after publication',
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()

        const reconciliations: Array<{
          readonly key: string
          readonly saved: CreatorDraft
          readonly retained: CreatorDraft | null
        }> = []

        const failingCleanup = Layer.effect(
          CreatorService,
          Effect.gen(function* () {
            const base = yield* CreatorService

            return {
              ...base,
              save: () =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as({
                    id: 'published-a',
                    slug: 'published-version',
                    updatedAt: '2026-11-26T12:00:01.000Z',
                  }),
                ),
              reconcileLocalDraft: (key, saved, _remote, retained) =>
                Effect.sync(() => {
                  reconciliations.push({ key, saved, retained })
                }).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new CreatorStorageError({
                        operation: 'reconcile',
                        message: 'Local cleanup unavailable',
                      }),
                    ),
                  ),
                ),
            }
          }),
        ).pipe(Layer.provide(service))

        const ComponentUnderTest = CreatorPageNoDeps.pipe(
          Component.provide(
            creatorRuntimeLayer.pipe(Layer.provide(failingCleanup), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(ComponentUnderTest, {
          url: '/new/tweet',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        })

        yield* play.type(HtmlLocator.role('textbox', { name: 'Title' }), 'Published title')
        play.root.send(M.RequestedOpenReview())
        play.root.send(M.RequestedPublish())
        yield* TestHost.settle
        yield* Deferred.await(entered)
        yield* play.type(HtmlLocator.role('textbox', { name: 'Title' }), 'Newer local title')
        yield* Deferred.succeed(release, undefined)
        yield* play.expect(Locator.text('Local cleanup unavailable')).toExist()
        yield* play
          .expect(Locator.text('Published the saved version. Newer edits remain unpublished.'))
          .toExist()
        yield* play
          .expect(HtmlLocator.role('textbox', { name: 'Title' }))
          .toHaveValue('Newer local title')
        yield* play
          .expect(HtmlLocator.role('link', { name: '← Back to post' }))
          .toHaveAttribute('href', '/tweet/published-version')
        yield* play.expect(HtmlLocator.role('button', { name: 'Save draft' })).toBeDisabled(false)
        assert.lengthOf(reconciliations, 1)
        assert.equal(reconciliations[0]?.key, 'author-a:micro:new')
        assert.equal(reconciliations[0]?.saved.title, 'Published title')
        assert.equal(reconciliations[0]?.retained?.title, 'Newer local title')
      }),
  )

  it.effect(
    'keeps current source diagnostics after an older failure, title edits and source clearing',
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<ReadonlyArray<RichContentDiagnostic>, string>()

        const current: ReadonlyArray<RichContentDiagnostic> = [
          {
            severity: 'warning',
            code: 'unsupported-html',
            message: 'Current source warning',
            line: 1,
            column: 1,
          },
        ]

        const ComponentUnderTest = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              creatorRuntimeLayer,
              GetDiagnostics.toLayer(({ content }) =>
                content === '<script>old</script>'
                  ? Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                    )
                  : Effect.succeed(current),
              ),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(ComponentUnderTest, {
          url: '/new/editorial',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        })

        play.root.send(M.UpdatedField({ field: 'content', value: '<script>old</script>' }))
        yield* TestHost.settle
        yield* TestClock.adjust('300 millis')
        yield* TestHost.settle
        yield* Deferred.await(entered)
        play.root.send(M.UpdatedField({ field: 'content', value: '<div>current</div>' }))
        yield* TestHost.settle
        yield* TestClock.adjust('300 millis')
        yield* play.expect(Locator.text('Line 1: Current source warning')).toExist()
        yield* Deferred.fail(release, 'Old diagnostics failed')
        yield* play.expect(Locator.text('Line 1: Current source warning')).toExist()
        play.root.send(M.UpdatedField({ field: 'title', value: 'Renamed' }))
        yield* play.expect(Locator.text('Line 1: Current source warning')).toExist()
        play.root.send(M.UpdatedField({ field: 'content', value: '' }))
        yield* play.expect(Locator.text('Line 1: Current source warning')).toBeAbsent()
      }),
  )

  it.effect('does not replace a current preview when an older render completes late', () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<RichContentDocument, string>()

      const current: RichContentDocument = {
        version: 1,
        blocks: [
          Block.Paragraph({ children: [Inline.Text({ value: 'Current rendered preview' })] }),
        ],
      }

      const ComponentUnderTest = CreatorPageNoDeps.pipe(
        Component.provide(
          Layer.mergeAll(
            creatorRuntimeLayer,
            GetDiagnostics.toLayer(() => Effect.succeed([])),
            GetPreview.toLayer(({ content }) =>
              content === 'First'
                ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                : Effect.succeed(current),
            ),
          ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
        ),
      )

      const play = yield* HtmlPlay.make(ComponentUnderTest, {
        url: '/new/editorial',
        principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
      })

      play.root.send(M.UpdatedField({ field: 'content', value: 'First' }))
      play.root.send(M.PickedEditorMode({ mode: 'preview' }))
      yield* TestHost.settle
      yield* TestClock.adjust('300 millis')
      yield* TestHost.settle
      yield* Deferred.await(entered)
      play.root.send(M.UpdatedField({ field: 'content', value: 'Second' }))
      yield* TestHost.settle
      yield* TestClock.adjust('300 millis')
      yield* play.expect(Locator.text('Current rendered preview')).toExist()
      yield* Deferred.succeed(release, {
        version: 1,
        blocks: [Block.Paragraph({ children: [Inline.Text({ value: 'Old rendered preview' })] })],
      })
      yield* play.expect(Locator.text('Current rendered preview')).toExist()
      yield* play.expect(Locator.text('Old rendered preview')).toBeAbsent()
    }),
  )

  it.effect(
    'checkpoints a longer note before reload and reopens its canvas in a new creator lifetime',
    () =>
      Effect.gen(function* () {
        const drafts = new Map<string, CreatorDraft>()
        const body = 'An independent signal from the Foldkit composer.'

        const checkpointService = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            readLocalDraft: (key: string) => Effect.sync(() => drafts.get(key) ?? null),
            writeLocalDraft: (key: string, draft: CreatorDraft) =>
              Effect.sync(() => {
                drafts.set(key, draft)
              }),
          })),
        ).pipe(Layer.provide(service))

        const ComponentUnderTest = CreatorPageNoDeps.pipe(
          Component.provide(
            creatorRuntimeLayer.pipe(Layer.provide(checkpointService), Layer.provideMerge(upload)),
          ),
        )

        const props = {
          url: '/new/tweet',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        }

        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* HtmlPlay.make(ComponentUnderTest, props)
            yield* first.click(HtmlLocator.role('button', { name: '+ Add a longer note' }))
            yield* first.type(
              HtmlLocator.role('textbox', { name: 'Body source', hidden: true }),
              body,
            )
            yield* TestHost.settle
          }),
        )
        const reloaded = yield* HtmlPlay.make(ComponentUnderTest, props)
        yield* TestHost.settle
        assert.equal(reloaded.root.model()?.draft.content, body)
        assert.isTrue(reloaded.root.model()?.bodyOpen)
        yield* reloaded.expect(Locator.text('Longer note')).toExist()
        yield* reloaded
          .expect(HtmlLocator.role('textbox', { name: 'Body source', hidden: true }))
          .toHaveValue(body)
        assert.equal(drafts.get('author-a:micro:new')?.content, body)
        assert.deepEqual([...drafts.keys()], ['author-a:micro:new'])
      }),
  )

  it.effect(
    'autosaves edited text through the real command and service seam on the native clock',
    () =>
      Effect.gen(function* () {
        const play = yield* HtmlPlay.make(TestCreator, {
          url: '/new/tweet',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        })

        yield* play.type(HtmlLocator.role('textbox', { name: 'Title' }), 'Keep my writing')
        yield* TestClock.adjust('2 seconds')
        yield* play
          .expect(HtmlLocator.role('textbox', { name: 'Title' }))
          .toHaveValue('Keep my writing')

        const log = yield* DraftLog

        assert.equal(log.writes.at(-1)?.key, 'author-a:micro:new')
        assert.equal(log.writes.at(-1)?.draft.title, 'Keep my writing')
      }),
  )
})
