import { Component } from '@effect/ui'
import { HtmlPlay } from '@effect/ui/html/testing'
import { TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { Deferred, Effect, Layer, Schema, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'

import { CreatorPageNoDeps, creatorRuntimeLayer } from './CreatorPage'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { GetDiagnostics, SearchAuthors } from './queries'
import {
  CreatorDraftSchema,
  CreatorService,
  CreatorServiceLive,
  reconcileStoredDraft,
} from './services'
import { CreatorPageMessage as M } from './state'
import { CreatorUpload } from './upload/runtime'

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
})('native creator checkpoint ownership', (it) => {
  it.effect(
    'cleans the original new key after two saves without resurrecting a clean revision',
    () =>
      Effect.gen(function* () {
        const values = new Map<string, string>([
          ['author-b:post:new', 'other owner bytes'],
          ['legacy-draft', 'legacy bytes'],
        ])

        const storage = {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => {
            values.set(key, value)
          },
          removeItem: (key: string) => {
            values.delete(key)
          },
        }

        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let saves = 0

        const service = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) =>
            CreatorService.of({
              ...base,
              readLocalDraft: (key) => {
                const value = storage.getItem(key)

                return value === null
                  ? Effect.succeed(null)
                  : Schema.decodeUnknownEffect(Schema.fromJsonString(CreatorDraftSchema))(
                      value,
                    ).pipe(Effect.orDie)
              },
              writeLocalDraft: (key, draft) =>
                Effect.sync(() => storage.setItem(key, JSON.stringify(draft))),
              reconcileLocalDraft: (key, saved, remote, retained) =>
                reconcileStoredDraft(storage, key, saved, remote, retained),
              save: () =>
                Effect.gen(function* () {
                  saves += 1

                  if (saves === 1) {
                    yield* Deferred.succeed(entered, undefined)
                    yield* Deferred.await(release)
                  }

                  return {
                    id: 'saved-post',
                    slug: 'saved-post',
                    updatedAt: `2026-11-27T12:00:0${saves}.000Z`,
                  }
                }),
            }),
          ),
        ).pipe(Layer.provide(CreatorServiceLive))

        const Creator = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
              GetDiagnostics.toLayer(() => Effect.succeed([])),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const play = yield* HtmlPlay.make(Creator, {
          url: '/new/editorial',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        })

        yield* TestHost.settle
        play.root.send(M.UpdatedField({ field: 'content', value: 'First body\n' }))
        yield* TestHost.settle
        play.root.send(M.RequestedSave())
        yield* TestHost.settle
        yield* Deferred.await(entered)
        play.root.send(M.UpdatedField({ field: 'content', value: 'Typed while pending\n\n' }))
        yield* TestHost.settle
        yield* Deferred.succeed(release, undefined)
        yield* TestHost.settle

        const retained = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(CreatorDraftSchema),
        )(storage.getItem('author-a:post:new'))

        assert.equal(retained.content, 'Typed while pending\n\n')
        assert.equal(retained.editSlug, 'saved-post')
        assert.equal(retained.expectedUpdatedAt, '2026-11-27T12:00:01.000Z')
        play.root.send(
          M.UpdatedField({ field: 'content', value: 'Body after first receipt\n\n\n' }),
        )
        yield* TestHost.settle
        assert.equal(values.has('author-a:post:saved-post'), false)
        assert.include(storage.getItem('author-a:post:new'), 'Body after first receipt')
        play.root.send(M.RequestedSave())
        yield* TestHost.settle
        assert.equal(play.root.model()?.savedRevision, play.root.model()?.revision)
        assert.isNull(storage.getItem('author-a:post:new'))
        play.root.send(M.RequestedAutosave())
        yield* TestHost.settle
        yield* TestClock.adjust('2 seconds')
        yield* TestHost.settle
        assert.isNull(storage.getItem('author-a:post:new'))
        assert.equal(values.has('author-a:post:saved-post'), false)
        assert.equal(play.root.model()?.draft.content, 'Body after first receipt\n\n\n')
        assert.equal(storage.getItem('author-b:post:new'), 'other owner bytes')
        assert.equal(storage.getItem('legacy-draft'), 'legacy bytes')
      }),
  )
  it.effect(
    'keeps metadata debounce but checkpoints review dismissal before immediate recovery',
    () =>
      Effect.gen(function* () {
        const values = new Map<string, string>()

        const service = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) =>
            CreatorService.of({
              ...base,
              readLocalDraft: (key) => {
                const value = values.get(key)

                return value === undefined
                  ? Effect.succeed(null)
                  : Schema.decodeUnknownEffect(Schema.fromJsonString(CreatorDraftSchema))(
                      value,
                    ).pipe(Effect.orDie)
              },
              writeLocalDraft: (key, draft) =>
                Effect.sync(() => {
                  values.set(key, JSON.stringify(draft))
                }),
            }),
          ),
        ).pipe(Layer.provide(CreatorServiceLive))

        const Creator = CreatorPageNoDeps.pipe(
          Component.provide(
            Layer.mergeAll(
              creatorRuntimeLayer.pipe(Layer.provide(CreatorLegacyRecoveryLive)),
              SearchAuthors.toLayer(() =>
                Effect.succeed([{ id: 'coauthor', name: 'Coauthor', username: 'coauthor' }]),
              ),
            ).pipe(Layer.provide(service), Layer.provideMerge(upload)),
          ),
        )

        const props = {
          url: '/new/tweet',
          principal: { id: 'author-a', name: 'Author', username: 'author', role: 'admin' },
        }

        yield* Effect.scoped(
          Effect.gen(function* () {
            const play = yield* HtmlPlay.make(Creator, props)
            yield* TestHost.settle
            play.root.send(M.UpdatedField({ field: 'title', value: 'Review metadata' }))
            play.root.send(M.UpdatedAuthorQuery({ value: 'Coauthor' }))
            yield* TestHost.settle
            yield* TestClock.adjust('300 millis')
            yield* TestHost.settle
            play.root.send(M.PickedAuthor({ id: 'coauthor' }))
            play.root.send(M.UpdatedTags({ value: 'radio, community' }))
            play.root.send(M.RequestedOpenReview())
            yield* TestHost.settle
            assert.deepEqual(play.root.model()?.draft.creatorIds, ['author-a', 'coauthor'])
            assert.isUndefined(values.get('author-a:micro:new'))
            play.root.send(M.RequestedCloseReview())
            yield* TestHost.settle
          }),
        )
        const reloaded = yield* HtmlPlay.make(Creator, props)
        yield* TestHost.settle
        assert.equal(reloaded.root.model()?.draft.title, 'Review metadata')
        assert.deepEqual(reloaded.root.model()?.draft.tags, ['radio', 'community'])
        assert.deepEqual(reloaded.root.model()?.draft.creatorIds, ['author-a', 'coauthor'])
      }),
  )
})
