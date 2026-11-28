import { Component } from '@effect/ui'
import { HtmlPlay } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type {
  RichContentBlock,
  RichContentInline,
  RichContentDiagnostic,
  RichContentDocument,
} from '@gbfm/rich-content/schema'
import { Data, Deferred, Effect, Layer, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'

import { CreatorPageNoDeps, creatorRuntimeLayer } from './CreatorPage'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { GetDiagnostics, GetMusicReferences, GetPreview, SearchAuthors } from './queries'
import { CreatorService, CreatorServiceLive, type MusicReference } from './services'
import { CreatorPageMessage as M } from './state'
import { CreatorUpload } from './upload/runtime'

const props = {
  url: '/new/tweet',
  principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
}

const client = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
)

const service = Layer.effect(
  CreatorService,
  Effect.map(CreatorService, (base) => ({
    ...base,
    readLocalDraft: () => Effect.succeed(null),
  })),
).pipe(Layer.provide(CreatorServiceLive))

const upload = Layer.succeed(CreatorUpload, {
  start: () => Effect.succeed('https://media.example/mix.mp3'),
  resume: Effect.succeed('https://media.example/mix.mp3'),
  pause: Effect.void,
  cancel: Effect.void,
  progress: Stream.empty,
})

const runtime = creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive))

const reference = (id: string): typeof MusicReference.Type => ({
  id,
  slug: id,
  title: id,
  content: null,
  creators: [],
})

const page = (id: string, hasMore = false) => ({
  data: [reference(id)],
  pagination: { hasMore },
})

const attach = M.PickedMusic({
  entityType: 'track',
  entityId: 'track-1',
  title: 'Song',
  image: null,
})

const tick = TestHost.settle.pipe(
  Effect.andThen(TestClock.adjust('300 millis')),
  Effect.andThen(TestHost.settle),
)

it.layer(Layer.mergeAll(TestHost.layer(), Layer.succeed(HttpClient.HttpClient, client)), {
  buildPerTest: true,
})('Creator retirement query ownership', (it) => {
  it.effect(
    'reference failure preserves draft and permits actual publication, retry and cumulative pages',
    () =>
      Effect.gen(function* () {
        const calls: Array<{ offset: number; attempt: number }> = []
        const saves: Array<boolean> = []

        const saving = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            save: ({ publish }) =>
              Effect.sync(() => {
                saves.push(publish)

                return { id: 'post-a', slug: 'published' }
              }),
            reconcileLocalDraft: () => Effect.void,
          })),
        ).pipe(Layer.provide(service))

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              runtime,
              GetPreview.toLayer(() => Effect.succeed({ version: 1, blocks: [] })),
              GetMusicReferences.toLayer((args) =>
                Effect.suspend(() => {
                  calls.push(args)

                  if (calls.length === 1) return Effect.fail('References unavailable')

                  return Effect.succeed(
                    page(args.offset === 0 ? 'first' : 'second', args.offset === 0),
                  )
                }),
              ),
            ).pipe(Layer.provide(saving), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, props)
        play.root.send(M.UpdatedField({ field: 'title', value: 'My unsaved thoughts' }))
        play.root.send(attach)
        yield* TestHost.settle
        const draft = play.root.model()?.draft
        assert.isNull(play.root.model()?.error)
        yield* play
          .expect(Locator.text('Could not check previous tweets. Your draft is unchanged.'))
          .toExist()
        play.root.send(M.RequestedOpenReview())
        play.root.send(M.RequestedPublish())
        yield* TestHost.settle
        assert.deepEqual(saves, [true])
        assert.equal(play.root.model()?.notice, 'Published.')
        play.root.send(M.ClickedRetryMusicPreview())
        yield* TestHost.settle
        yield* play
          .expect(Locator.text('Could not check previous tweets. Your draft is unchanged.'))
          .toBeAbsent()
        assert.equal(play.root.model()?.draft.title, draft?.title)
        assert.equal(play.root.model()?.draft.musicEntityId, draft?.musicEntityId)
        play.root.send(M.ClickedMoreReferences())
        yield* TestHost.settle
        assert.deepEqual(
          calls.map(({ offset }) => offset),
          [0, 0, 1],
        )
        assert.deepEqual(play.root.model()?.referenceOffsets, [0, 1])
        yield* play.expect(Locator.text('first')).toExist()
        yield* play.expect(Locator.text('second')).toExist()
      }),
  )

  for (const outcome of ['success', 'failure']) {
    for (const afterLatest of [false, true]) {
      it.effect(
        `same-entity detach/reattach rejects old reference ${outcome} afterLatest=${afterLatest}`,
        () =>
          Effect.gen(function* () {
            const old = yield* Deferred.make<ReturnType<typeof page>, string>()
            const latest = yield* Deferred.make<ReturnType<typeof page>, string>()
            const entered = yield* Deferred.make<void>()
            const returned: Array<string> = []
            let calls = 0

            const C = CreatorPageNoDeps.pipe(
              Component.provide(
                Layer.mergeAll(
                  runtime,
                  GetPreview.toLayer(() => Effect.succeed({ version: 1, blocks: [] })),
                  GetMusicReferences.toLayer(() =>
                    Effect.suspend(() => {
                      calls++

                      if (calls === 1)
                        return Deferred.succeed(entered, undefined).pipe(
                          Effect.andThen(Deferred.await(old)),
                          Effect.onExit(() =>
                            Effect.sync(() => {
                              returned.push('old')
                            }),
                          ),
                          Effect.uninterruptible,
                        )

                      return Deferred.await(latest)
                    }),
                  ),
                ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
              ),
            )

            const play = yield* HtmlPlay.make(C, props)
            play.root.send(attach)
            yield* TestHost.settle
            yield* Deferred.await(entered)
            play.root.send(M.ClickedRemoveMusic())
            yield* TestHost.settle
            play.root.send(attach)
            yield* TestHost.settle
            assert.equal(calls, 2)

            if (afterLatest) {
              yield* Deferred.succeed(latest, page('current'))
              yield* TestHost.settle
            }

            if (outcome === 'success') yield* Deferred.succeed(old, page('stale'))
            else yield* Deferred.fail(old, 'Old references failed')
            yield* TestHost.settle
            assert.deepEqual(returned, ['old'])
            assert.isNull(play.root.model()?.error)

            if (!afterLatest) yield* Deferred.succeed(latest, page('current'))
            yield* TestHost.settle
            yield* play.expect(Locator.text('current')).toExist()
            yield* play.expect(Locator.text('stale')).toBeAbsent()
            yield* play
              .expect(Locator.text('Could not check previous tweets. Your draft is unchanged.'))
              .toBeAbsent()
            assert.equal(play.root.model()?.draft.musicEntityId, 'track-1')
          }),
      )
    }

    it.effect(`Ada to Grace rejects delayed author ${outcome} and preserves collaborators`, () =>
      Effect.gen(function* () {
        const old = yield* Deferred.make<
          ReadonlyArray<{ id: string; name: string; username: string }>,
          string
        >()

        const entered = yield* Deferred.make<void>()
        const returned: Array<string> = []

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              runtime,
              SearchAuthors.toLayer(({ query }) =>
                query === 'Ada'
                  ? Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(old)),
                      Effect.onExit(() =>
                        Effect.sync(() => {
                          returned.push('Ada')
                        }),
                      ),
                      Effect.uninterruptible,
                    )
                  : Effect.succeed([{ id: 'grace', name: 'Grace', username: 'grace' }]),
              ),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, props)
        play.root.send(M.UpdatedAuthorQuery({ value: 'Ada' }))
        yield* tick
        yield* Deferred.await(entered)
        play.root.send(M.UpdatedAuthorQuery({ value: 'Grace' }))
        yield* tick
        play.root.send(M.PickedAuthor({ id: 'grace' }))
        yield* TestHost.settle

        if (outcome === 'success')
          yield* Deferred.succeed(old, [{ id: 'ada', name: 'Ada', username: 'ada' }])
        else yield* Deferred.fail(old, 'Old author search failed')
        yield* TestHost.settle
        assert.deepEqual(returned, ['Ada'])
        play.root.send(M.PickedAuthor({ id: 'ada' }))
        play.root.send(M.PickedAuthor({ id: 'grace' }))
        play.root.send(M.PickedAuthor({ id: 'not-a-search-result' }))
        yield* TestHost.settle
        assert.deepEqual(play.root.model()?.draft.creatorIds, ['author-a', 'grace'])
        assert.equal(play.root.model()?.authorLabels.grace, 'Grace')
        assert.isNull(play.root.model()?.error)
        yield* play
          .expect(Locator.text('Could not search authors. Try another name or username.'))
          .toBeAbsent()
      }),
    )
  }

  it.effect(
    'preview failure retries actual rendering and selecting ready preview causes no redundant work',
    () =>
      Effect.gen(function* () {
        const calls: Array<string> = []

        const document: RichContentDocument = {
          version: 1,
          blocks: [
            Data.taggedEnum<RichContentBlock>().Paragraph({
              children: [
                Data.taggedEnum<RichContentInline>().Text({ value: 'Rendered current source' }),
              ],
            }),
          ],
        }

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              runtime,
              GetDiagnostics.toLayer(() => Effect.succeed([])),
              GetPreview.toLayer(({ content }) =>
                Effect.suspend(() => {
                  calls.push(content)

                  if (calls.length === 1) return Effect.fail('Render unavailable')

                  return Effect.succeed(document)
                }),
              ),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, { ...props, url: '/new/editorial' })
        play.root.send(M.UpdatedField({ field: 'content', value: 'Preview source' }))
        play.root.send(M.PickedEditorMode({ mode: 'preview' }))
        yield* tick
        assert.lengthOf(calls, 1)
        yield* play
          .expect(Locator.text('The preview could not load. Your source is still here.'))
          .toExist()
        play.root.send(M.ClickedRetryPreview())
        yield* tick
        assert.deepEqual(calls, ['Preview source', 'Preview source'])
        yield* play.expect(Locator.text('Rendered current source')).toExist()
        play.root.send(M.PickedEditorMode({ mode: 'preview' }))
        yield* tick
        assert.lengthOf(calls, 2)
        assert.equal(play.root.model()?.draft.content, 'Preview source')
        yield* play
          .expect(Locator.text('The preview could not load. Your source is still here.'))
          .toBeAbsent()
      }),
  )

  it.effect(
    'More retains first page while an obsolete page completion cannot replace a reattached current page',
    () =>
      Effect.gen(function* () {
        const oldMore = yield* Deferred.make<ReturnType<typeof page>, string>()
        const entered = yield* Deferred.make<void>()
        const returned: Array<string> = []
        const calls: Array<{ offset: number; attempt: number }> = []

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              runtime,
              GetPreview.toLayer(() => Effect.succeed({ version: 1, blocks: [] })),
              GetMusicReferences.toLayer((args) =>
                Effect.suspend(() => {
                  calls.push(args)

                  if (args.offset === 1)
                    return Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(oldMore)),
                      Effect.onExit(() =>
                        Effect.sync(() => {
                          returned.push('old page')
                        }),
                      ),
                      Effect.uninterruptible,
                    )

                  return Effect.succeed(
                    page(calls.length === 1 ? 'first page' : 'reattached page', true),
                  )
                }),
              ),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, props)
        play.root.send(attach)
        yield* TestHost.settle
        play.root.send(M.ClickedMoreReferences())
        yield* TestHost.settle
        yield* Deferred.await(entered)
        yield* play.expect(Locator.text('first page')).toExist()
        assert.deepEqual(play.root.model()?.referenceOffsets, [0, 1])
        play.root.send(M.ClickedRemoveMusic())
        yield* TestHost.settle
        yield* play.expect(Locator.text('first page')).toBeAbsent()
        play.root.send(attach)
        yield* TestHost.settle
        yield* play.expect(Locator.text('reattached page')).toExist()
        yield* Deferred.succeed(oldMore, page('stale second page'))
        yield* TestHost.settle
        assert.deepEqual(returned, ['old page'])
        yield* play.expect(Locator.text('reattached page')).toExist()
        yield* play.expect(Locator.text('stale second page')).toBeAbsent()
        assert.deepEqual(
          calls.map(({ offset }) => offset),
          [0, 1, 0],
        )
        assert.deepEqual(play.root.model()?.referenceOffsets, [0])
      }),
  )

  it.effect(
    'current diagnostics reject delayed old success, survive title edits and clear with source',
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const old = yield* Deferred.make<ReadonlyArray<RichContentDiagnostic>, string>()
        const returned: Array<string> = []

        const current: ReadonlyArray<RichContentDiagnostic> = [
          {
            severity: 'warning',
            code: 'unsupported-html',
            message: 'Current source warning',
            line: 1,
            column: 1,
          },
        ]

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              runtime,
              GetDiagnostics.toLayer(({ content }) =>
                content === '<script>old</script>'
                  ? Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(old)),
                      Effect.onExit(() =>
                        Effect.sync(() => {
                          returned.push('old diagnostics')
                        }),
                      ),
                      Effect.uninterruptible,
                    )
                  : Effect.succeed(current),
              ),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, { ...props, url: '/new/editorial' })
        play.root.send(M.UpdatedField({ field: 'content', value: '<script>old</script>' }))
        yield* tick
        yield* Deferred.await(entered)
        play.root.send(M.UpdatedField({ field: 'content', value: '<div>current</div>' }))
        yield* tick
        yield* play.expect(Locator.text('Line 1: Current source warning')).toExist()
        yield* Deferred.succeed(old, [])
        yield* TestHost.settle
        assert.deepEqual(returned, ['old diagnostics'])
        yield* play.expect(Locator.text('Line 1: Current source warning')).toExist()
        play.root.send(M.UpdatedField({ field: 'title', value: 'Renamed' }))
        yield* play.expect(Locator.text('Line 1: Current source warning')).toExist()
        play.root.send(M.UpdatedField({ field: 'content', value: '' }))
        yield* play.expect(Locator.text('Line 1: Current source warning')).toBeAbsent()
      }),
  )
})
