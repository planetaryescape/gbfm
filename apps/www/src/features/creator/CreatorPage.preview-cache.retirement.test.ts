import { Component } from '@effect/ui'
import { HtmlPlay } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type {
  RichContentBlock,
  RichContentDocument,
  RichContentInline,
} from '@gbfm/rich-content/schema'
import { Data, Deferred, Effect, Layer, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'

import { CreatorPageNoDeps, creatorRuntimeLayer } from './CreatorPage'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { GetDiagnostics, GetPreview } from './queries'
import { CreatorService, CreatorServiceLive } from './services'
import { CreatorPageMessage as M } from './state'
import { CreatorUpload } from './upload/runtime'

const document = (value: string): RichContentDocument => ({
  version: 1,
  blocks: [
    Data.taggedEnum<RichContentBlock>().Paragraph({
      children: [Data.taggedEnum<RichContentInline>().Text({ value })],
    }),
  ],
})

const client = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
)

const upload = Layer.succeed(CreatorUpload, {
  start: () => Effect.succeed('https://media.example/mix.mp3'),
  resume: Effect.succeed('https://media.example/mix.mp3'),
  pause: Effect.void,
  cancel: Effect.void,
  progress: Stream.empty,
})

const service = Layer.effect(
  CreatorService,
  Effect.map(CreatorService, (base) => ({
    ...base,
    readLocalDraft: () => Effect.succeed(null),
    writeLocalDraft: () => Effect.void,
  })),
).pipe(Layer.provide(CreatorServiceLive))

const tick = TestHost.settle.pipe(
  Effect.andThen(TestClock.adjust('300 millis')),
  Effect.andThen(TestHost.settle),
)

it.layer(Layer.mergeAll(TestHost.layer(), Layer.succeed(HttpClient.HttpClient, client)), {
  buildPerTest: true,
})('Creator native preview cache retention', (it) => {
  for (const outcome of ['success', 'failure']) {
    it.effect(
      `retains first preview in the native query cache while second is pending and rejects its late ${outcome}`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const second = yield* Deferred.make<RichContentDocument, string>()
          const returned: Array<string> = []
          const renders: Array<string> = []

          const C = CreatorPageNoDeps.pipe(
            Component.provide(
              Layer.mergeAll(
                creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
                GetDiagnostics.toLayer(() => Effect.succeed([])),
                GetPreview.toLayer(({ content }) =>
                  Effect.suspend(() => {
                    renders.push(content)

                    if (content === 'First')
                      return Effect.succeed(document('First rendered document'))

                    return Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(second)),
                      Effect.onExit(() =>
                        Effect.sync(() => {
                          returned.push('second')
                        }),
                      ),
                      Effect.uninterruptible,
                    )
                  }),
                ),
              ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
            ),
          )

          const play = yield* HtmlPlay.make(C, {
            url: '/new/editorial',
            principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
          })

          play.root.send(M.UpdatedField({ field: 'content', value: 'First' }))
          play.root.send(M.PickedEditorMode({ mode: 'preview' }))
          yield* tick
          yield* play.expect(Locator.text('First rendered document')).toExist()
          play.root.send(M.UpdatedField({ field: 'content', value: 'Second' }))
          yield* tick
          yield* Deferred.await(entered)
          assert.deepEqual(renders, ['First', 'Second'])
          assert.deepEqual(returned, [])
          play.root.send(M.UpdatedField({ field: 'content', value: 'First' }))
          yield* TestHost.settle
          assert.isDefined(play.root.query(Locator.text('First rendered document')))
          yield* play.expect(Locator.text('First rendered document')).toExist()
          assert.deepEqual(renders, ['First', 'Second'])

          if (outcome === 'success')
            yield* Deferred.succeed(second, document('Obsolete second document'))
          else yield* Deferred.fail(second, 'Obsolete second failure')
          yield* TestHost.settle
          assert.deepEqual(returned, ['second'])
          yield* play.expect(Locator.text('First rendered document')).toExist()
          yield* play.expect(Locator.text('Obsolete second document')).toBeAbsent()
          yield* play
            .expect(Locator.text('The preview could not load. Your source is still here.'))
            .toBeAbsent()
          assert.equal(play.root.model()?.draft.content, 'First')
          yield* tick
          assert.deepEqual(renders, ['First', 'Second'])
        }),
    )

    it.effect(
      `a genuinely late first render ${outcome} cannot replace the current second source`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const first = yield* Deferred.make<RichContentDocument, string>()
          const returned: Array<string> = []
          const renders: Array<string> = []

          const C = CreatorPageNoDeps.pipe(
            Component.provide(
              Layer.mergeAll(
                creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
                GetDiagnostics.toLayer(() => Effect.succeed([])),
                GetPreview.toLayer(({ content }) =>
                  Effect.suspend(() => {
                    renders.push(content)

                    if (content === 'Second')
                      return Effect.succeed(document('Current second document'))

                    return Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(first)),
                      Effect.onExit(() =>
                        Effect.sync(() => {
                          returned.push('first')
                        }),
                      ),
                      Effect.uninterruptible,
                    )
                  }),
                ),
              ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
            ),
          )

          const play = yield* HtmlPlay.make(C, {
            url: '/new/editorial',
            principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
          })

          play.root.send(M.UpdatedField({ field: 'content', value: 'First' }))
          play.root.send(M.PickedEditorMode({ mode: 'preview' }))
          yield* tick
          yield* Deferred.await(entered)
          play.root.send(M.UpdatedField({ field: 'content', value: 'Second' }))
          yield* tick
          yield* play.expect(Locator.text('Current second document')).toExist()

          if (outcome === 'success')
            yield* Deferred.succeed(first, document('Obsolete first document'))
          else yield* Deferred.fail(first, 'Obsolete first failure')
          yield* TestHost.settle
          assert.deepEqual(returned, ['first'])
          assert.deepEqual(renders, ['First', 'Second'])
          assert.equal(play.root.model()?.draft.content, 'Second')
          yield* play.expect(Locator.text('Current second document')).toExist()
          yield* play.expect(Locator.text('Obsolete first document')).toBeAbsent()
          yield* play
            .expect(Locator.text('The preview could not load. Your source is still here.'))
            .toBeAbsent()
        }),
    )
  }
})
