import { Component } from '@effect/ui'
import { HtmlPlay } from '@effect/ui/html/testing'
import { TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'

import { CreatorPageNoDeps, creatorRuntimeLayer } from './CreatorPage'
import { emptyDraft } from './domain'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { GetEditable } from './queries'
import { CreatorService, CreatorServiceLive, type CreatorDraft } from './services'
import { CreatorPageMessage as M } from './state'
import { CreatorUpload } from './upload/runtime'

const props = {
  url: '/new/editorial?edit=saved',
  principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
}

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

it.layer(Layer.mergeAll(TestHost.layer(), Layer.succeed(HttpClient.HttpClient, client)), {
  buildPerTest: true,
})('Creator named-edit recovery', (it) => {
  it.effect(
    'named remote edit performs no unrequested local read and preserves existing local bytes',
    () =>
      Effect.gen(function* () {
        const draft = {
          ...emptyDraft('post', 'author-a', 'saved'),
          title: 'Remote title',
          content: 'Remote body',
          postId: 'post-a',
        }

        const local = JSON.stringify({
          ...draft,
          title: 'Local title',
          content: 'Unrequested local body',
        })

        const stored = new Map([['author-a:post:saved', local]])
        const reads: Array<string> = []
        const writes: Array<string> = []

        const storage = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            readLocalDraft: (key) =>
              Effect.sync(() => {
                reads.push(key)

                return { ...draft, title: 'Local title', content: 'Unrequested local body' }
              }),
            writeLocalDraft: (key, value) =>
              Effect.sync(() => {
                writes.push(key)
                stored.set(key, JSON.stringify(value))
              }),
          })),
        ).pipe(Layer.provide(CreatorServiceLive))

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
              GetEditable.toLayer(() => Effect.succeed({ ...draft, draft: true, creators: [] })),
            ).pipe(Layer.provide(storage), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, props)
        yield* TestHost.settle
        assert.equal(play.root.model()?.draft.title, 'Remote title')
        assert.equal(play.root.model()?.draft.content, 'Remote body')
        assert.deepEqual(writes, [])
        assert.equal(stored.get('author-a:post:saved'), local)
        assert.deepEqual(reads, [])
      }),
  )

  for (const kind of ['post', 'mix'] satisfies ReadonlyArray<'post' | 'mix'>) {
    it.effect(
      `named ${kind} checkpoints body immediately and metadata only after the two-second debounce`,
      () =>
        Effect.gen(function* () {
          const key = `author-a:${kind}:saved`

          const draft = {
            ...emptyDraft(kind, 'author-a', 'saved'),
            title: 'Remote title',
            content: 'Remote body',
            postId: kind === 'post' ? 'post-a' : undefined,
          }

          const localBytes = JSON.stringify({ ...draft, content: 'Pre-existing local body' })
          const stored = new Map([[key, localBytes]])
          const reads: Array<string> = []
          const writes: Array<{ key: string; draft: CreatorDraft }> = []

          const storage = Layer.effect(
            CreatorService,
            Effect.map(CreatorService, (base) => ({
              ...base,
              readLocalDraft: (requested) =>
                Effect.sync(() => {
                  reads.push(requested)

                  return { ...draft, content: 'Pre-existing local body' }
                }),
              writeLocalDraft: (requested, value) =>
                Effect.sync(() => {
                  writes.push({ key: requested, draft: value })
                  stored.set(requested, JSON.stringify(value))
                }),
            })),
          ).pipe(Layer.provide(CreatorServiceLive))

          const C = CreatorPageNoDeps.pipe(
            Component.provide(
              Layer.mergeAll(
                creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
                GetEditable.toLayer(() => Effect.succeed({ ...draft, draft: true, creators: [] })),
              ).pipe(Layer.provide(storage), Layer.provideMerge(upload)),
            ),
          )

          const url = kind === 'post' ? '/new/editorial?edit=saved' : '/new/mix?edit=saved'
          const play = yield* HtmlPlay.make(C, { ...props, url })
          yield* TestHost.settle
          yield* TestClock.adjust('2 seconds')
          yield* TestHost.settle
          assert.deepEqual(reads, [])
          assert.deepEqual(writes, [])
          assert.equal(stored.get(key), localBytes)
          assert.isTrue(play.root.model()?.recovered)
          play.root.send(M.UpdatedField({ field: 'content', value: 'New named-edit body' }))
          yield* TestHost.settle
          assert.lengthOf(writes, 1)
          assert.equal(writes[0]?.key, key)
          assert.equal(writes[0]?.draft.content, 'New named-edit body')
          assert.equal(writes[0]?.draft.title, 'Remote title')
          play.root.send(M.UpdatedField({ field: 'title', value: 'First metadata edit' }))
          yield* TestHost.settle
          yield* TestClock.adjust('1 second')
          yield* TestHost.settle
          assert.lengthOf(writes, 1)
          play.root.send(M.UpdatedField({ field: 'title', value: 'Latest metadata edit' }))
          yield* TestHost.settle
          yield* TestClock.adjust('1999 millis')
          yield* TestHost.settle
          assert.lengthOf(writes, 1)
          yield* TestClock.adjust('1 millis')
          yield* TestHost.settle
          assert.lengthOf(writes, 2)
          assert.equal(writes[1]?.key, key)
          assert.equal(writes[1]?.draft.title, 'Latest metadata edit')
          assert.equal(writes[1]?.draft.content, 'New named-edit body')
          assert.deepEqual([...stored.keys()], [key])
          assert.deepEqual(reads, [])
        }),
    )
  }

  it.effect(
    'named edit still reads and offers scoped local recovery only after explicit request',
    () =>
      Effect.gen(function* () {
        const draft = {
          ...emptyDraft('post', 'author-a', 'saved'),
          title: 'Remote title',
          content: 'Remote body',
        }

        const local = { ...draft, title: 'Local title', content: 'Explicit local body' }
        const bytes = JSON.stringify(local)
        const stored = new Map([['author-a:post:saved', bytes]])
        const reads: Array<string> = []

        const storage = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            readLocalDraft: (key) =>
              Effect.sync(() => {
                reads.push(key)

                return local
              }),
            writeLocalDraft: (key, value) =>
              Effect.sync(() => {
                stored.set(key, JSON.stringify(value))
              }),
          })),
        ).pipe(Layer.provide(CreatorServiceLive))

        const C = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
              GetEditable.toLayer(() => Effect.succeed({ ...draft, draft: true, creators: [] })),
            ).pipe(Layer.provide(storage), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(C, props)
        yield* TestHost.settle
        assert.deepEqual(reads, [])
        assert.equal(stored.get('author-a:post:saved'), bytes)
        play.root.send(M.RequestedRecovery())
        yield* TestHost.settle
        assert.deepEqual(reads, ['author-a:post:saved'])
        assert.equal(play.root.model()?.draft.content, 'Remote body')
        assert.deepEqual(play.root.model()?.recovery, local)
        assert.equal(stored.get('author-a:post:saved'), bytes)
        play.root.send(M.ClickedRecover())
        yield* TestHost.settle
        assert.deepEqual(play.root.model()?.draft, local)
        assert.isNull(play.root.model()?.recovery)
        assert.equal(stored.get('author-a:post:saved'), bytes)
      }),
  )
})
