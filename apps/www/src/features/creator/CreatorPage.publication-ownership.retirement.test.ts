import { Component } from '@effect/ui'
import { HtmlPlay } from '@effect/ui/html/testing'
import { TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type { ResolvePostMusicResponse } from '@gbfm/api/post'
import { Deferred, Effect, Layer, Schema, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'

import { CreatorPageNoDeps, creatorRuntimeLayer } from './CreatorPage'
import { emptyDraft } from './domain'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { GetEditable } from './queries'
import {
  CreatorDraftSchema,
  CreatorRequestError,
  CreatorStorageError,
  CreatorUploadError,
  CreatorService,
  CreatorServiceLive,
} from './services'
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

it.layer(Layer.mergeAll(TestHost.layer(), Layer.succeed(HttpClient.HttpClient, client)), {
  buildPerTest: true,
})('Creator retirement publication ownership', (it) => {
  it.effect(
    'remote save failure never reconciles or deletes checkpoint and operation two retries successfully',
    () =>
      Effect.gen(function* () {
        const bytes = JSON.stringify({
          ...emptyDraft('micro', 'author-a'),
          title: 'Checkpoint bytes',
        })

        const stored = new Map([['author-a:micro:new', bytes]])
        const reconciled: Array<string> = []
        let requests = 0

        const saving = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            save: () =>
              Effect.suspend(() => {
                requests++

                if (requests === 1)
                  return Effect.fail(
                    new CreatorRequestError({
                      operation: 'save',
                      status: 503,
                      message: 'Unavailable',
                    }),
                  )

                return Effect.succeed({
                  id: 'post-a',
                  slug: 'saved',
                  updatedAt: '2026-11-27T12:00:00.000Z',
                })
              }),
            reconcileLocalDraft: (key) =>
              Effect.sync(() => {
                reconciled.push(key)
                stored.delete(key)
              }),
          })),
        ).pipe(Layer.provide(service))

        const C = CreatorPageNoDeps.pipe(
          Component.provide(runtime.pipe(Layer.provide(saving), Layer.provideMerge(upload))),
        )

        const play = yield* HtmlPlay.make(C, props)
        play.root.send(M.UpdatedField({ field: 'title', value: 'Draft' }))
        play.root.send(M.RequestedSave())
        yield* TestHost.settle
        assert.equal(requests, 1)
        assert.equal(play.root.model()?.operation, 1)
        assert.equal(play.root.model()?.saving, false)
        assert.equal(play.root.model()?.error, 'Unavailable')
        assert.deepEqual(reconciled, [])
        assert.equal(stored.get('author-a:micro:new'), bytes)
        play.root.send(M.RequestedSave())
        yield* TestHost.settle
        assert.equal(requests, 2)
        assert.equal(play.root.model()?.operation, 2)
        assert.equal(play.root.model()?.draft.postId, 'post-a')
        assert.equal(play.root.model()?.draft.editSlug, 'saved')
        assert.equal(play.root.model()?.notice, 'Draft saved privately.')
        assert.deepEqual(reconciled, ['author-a:micro:new'])
        assert.equal(stored.size, 0)
      }),
  )

  for (const operation of ['music', 'quote']) {
    for (const replacement of [false, true]) {
      it.effect(
        `delayed ${operation} failure after discard replacement=${replacement} cannot mutate current editor`,
        () =>
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<never, CreatorRequestError>()
            const completed: Array<string> = []

            const failure = Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.onExit(() =>
                Effect.sync(() => {
                  completed.push(operation)
                }),
              ),
              Effect.uninterruptible,
            )

            const delayed = Layer.effect(
              CreatorService,
              Effect.map(CreatorService, (base) => ({
                ...base,
                resolveMusic: () => failure,
                resolveQuote: () => failure,
                writeLocalDraft: () => Effect.void,
              })),
            ).pipe(Layer.provide(service))

            const C = CreatorPageNoDeps.pipe(
              Component.provide(runtime.pipe(Layer.provide(delayed), Layer.provideMerge(upload))),
            )

            const play = yield* HtmlPlay.make(C, props)

            if (operation === 'music') {
              play.root.send(M.UpdatedField({ field: 'musicUrl', value: 'https://music.test/old' }))
              play.root.send(M.RequestedMusic())
            } else {
              play.root.send(
                M.UpdatedField({ field: 'quoteUrl', value: 'https://goosebumps.fm/tweet/old' }),
              )
              play.root.send(M.RequestedQuote())
            }

            yield* TestHost.settle
            yield* Deferred.await(entered)
            play.root.send(M.RequestedDiscard())
            play.root.send(M.ConfirmedDiscard())
            yield* TestHost.settle

            if (replacement)
              play.root.send(M.UpdatedField({ field: 'title', value: 'Replacement' }))
            yield* TestHost.settle
            const before = play.root.model()
            yield* Deferred.fail(
              release,
              new CreatorRequestError({
                operation,
                status: 503,
                message: 'Old failure',
              }),
            )
            yield* TestHost.settle
            assert.deepEqual(completed, [operation])
            assert.deepEqual(play.root.model(), before)
            assert.isNull(play.root.model()?.error)

            if (operation === 'music') {
              play.root.send(
                M.UpdatedField({ field: 'musicUrl', value: 'https://music.test/current' }),
              )
              play.root.send(M.RequestedMusic())
            } else {
              play.root.send(
                M.UpdatedField({ field: 'quoteUrl', value: 'https://goosebumps.fm/tweet/current' }),
              )
              play.root.send(M.RequestedQuote())
            }

            yield* TestHost.settle
            assert.equal(play.root.model()?.error, 'Old failure')
          }),
      )
    }
  }

  for (const operation of ['read', 'artwork']) {
    for (const replacement of [false, true]) {
      it.effect(
        `delayed ${operation} failure after discard replacement=${replacement} preserves current editor`,
        () =>
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const returned: Array<string> = []

            const delayed = Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(
                Effect.sync(() => {
                  returned.push(operation)
                }),
              ),
              Effect.uninterruptible,
            )

            const adapter = Layer.effect(
              CreatorService,
              Effect.map(CreatorService, (base) => ({
                ...base,
                readLocalDraft: () =>
                  operation === 'read'
                    ? delayed.pipe(
                        Effect.andThen(
                          Effect.fail(
                            new CreatorStorageError({
                              operation: 'read',
                              message: 'Old read failure',
                            }),
                          ),
                        ),
                      )
                    : Effect.succeed(null),
                uploadImage: () =>
                  delayed.pipe(
                    Effect.andThen(
                      Effect.fail(
                        new CreatorUploadError({
                          stage: 'image',
                          status: 503,
                          message: 'Old image failure',
                        }),
                      ),
                    ),
                  ),
                writeLocalDraft: () => Effect.void,
              })),
            ).pipe(Layer.provide(service))

            const C = CreatorPageNoDeps.pipe(
              Component.provide(runtime.pipe(Layer.provide(adapter), Layer.provideMerge(upload))),
            )

            const play = yield* HtmlPlay.make(C, props)

            if (operation === 'artwork')
              play.root.send(M.ChoseArtwork({ files: [new File(['image'], 'cover.png')] }))
            yield* TestHost.settle
            yield* Deferred.await(entered)
            play.root.send(M.RequestedDiscard())
            play.root.send(M.ConfirmedDiscard())
            yield* TestHost.settle

            if (replacement)
              play.root.send(M.UpdatedField({ field: 'title', value: 'Replacement' }))
            yield* TestHost.settle
            const before = play.root.model()
            yield* Deferred.succeed(release, undefined)
            yield* TestHost.settle
            assert.deepEqual(returned, [operation])
            assert.deepEqual(play.root.model(), before)

            if (operation === 'read') {
              play.root.send(M.RequestedRecovery())
              yield* TestHost.settle
              assert.equal(play.root.model()?.localError, 'Old read failure')
            } else {
              play.root.send(M.ChoseArtwork({ files: [new File(['image'], 'current.png')] }))
              yield* TestHost.settle
              assert.equal(play.root.model()?.error, 'artwork upload: Old image failure')
            }
          }),
      )
    }
  }

  for (const source of ['local', 'empty']) {
    it.effect(
      `new editor ${source} recovery reads only the principal-scoped key and never overwrites bytes`,
      () =>
        Effect.gen(function* () {
          const draft = {
            ...emptyDraft('micro', props.principal.id),
            title: 'Local title',
            content: 'Local body',
          }

          const bytes = source === 'local' ? JSON.stringify(draft) : null
          const stored = new Map<string, string>()

          if (bytes !== null) stored.set('author-a:micro:new', bytes)
          const reads: Array<string> = []
          const writes: Array<string> = []

          const adapter = Layer.effect(
            CreatorService,
            Effect.map(CreatorService, (base) => ({
              ...base,
              readLocalDraft: (key) =>
                Effect.gen(function* () {
                  reads.push(key)
                  const value = stored.get(key)

                  if (value === undefined) return null

                  return yield* Schema.decodeUnknownEffect(
                    Schema.fromJsonString(CreatorDraftSchema),
                  )(value).pipe(
                    Effect.mapError(
                      () =>
                        new CreatorStorageError({
                          operation: 'read',
                          message: 'Invalid fixture bytes',
                        }),
                    ),
                  )
                }),
              writeLocalDraft: (key, value) =>
                Effect.sync(() => {
                  writes.push(key)
                  stored.set(key, JSON.stringify(value))
                }),
            })),
          ).pipe(Layer.provide(service))

          const C = CreatorPageNoDeps.pipe(
            Component.provide(runtime.pipe(Layer.provide(adapter), Layer.provideMerge(upload))),
          )

          const play = yield* HtmlPlay.make(C, props)
          yield* TestHost.settle
          assert.deepEqual(reads, ['author-a:micro:new'])
          assert.deepEqual(writes, [])
          assert.equal(play.root.model()?.draft.title, source === 'local' ? 'Local title' : '')
          assert.equal(play.root.model()?.draft.content, source === 'local' ? 'Local body' : '')
          assert.isTrue(play.root.model()?.recovered)
          assert.equal(play.root.model()?.localRevision, source === 'local' ? 1 : 0)
          assert.equal(stored.get('author-a:micro:new') ?? null, bytes)
        }),
    )
  }

  for (const publish of [false, true]) {
    it.effect(
      `one remote owner publish=${publish} preserves later writing and resolves saved music without duplicate work`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const musicEntered = yield* Deferred.make<void>()
          const musicRelease = yield* Deferred.make<void>()
          const saves: Array<boolean> = []
          const musicCalls: Array<string> = []

          const adapter = Layer.effect(
            CreatorService,
            Effect.map(CreatorService, (base) => ({
              ...base,
              save: ({ publish: intent }) =>
                Effect.sync(() => {
                  saves.push(intent)
                }).pipe(
                  Effect.andThen(Deferred.succeed(entered, undefined)),
                  Effect.andThen(Deferred.await(release)),
                  Effect.as({ id: 'post-a', slug: 'saved', updatedAt: '2026-11-27T12:00:00.000Z' }),
                ),
              resolvePostMusic: (postId, url, expectedUpdatedAt) =>
                Effect.sync(() => {
                  musicCalls.push(postId)
                  assert.equal(expectedUpdatedAt, '2026-11-27T12:00:00.000Z')

                  return {
                    postId,
                    url,
                    entityType: 'track',
                    entityId: 'track-a',
                    title: 'Attached song',
                    artistNames: [],
                    coverImageUrl: null,
                    updatedAt: '2026-11-27T12:00:01.000Z',
                  } satisfies {
                    postId: string
                    url: string
                    entityType: 'track'
                    entityId: string
                    title: string
                    artistNames: Array<string>
                    coverImageUrl: null
                    updatedAt: string
                  }
                }).pipe(
                  Effect.tap(() => Deferred.succeed(musicEntered, undefined)),
                  Effect.tap(() => Deferred.await(musicRelease)),
                ),
              reconcileLocalDraft: () => Effect.void,
              writeLocalDraft: () => Effect.void,
            })),
          ).pipe(Layer.provide(service))

          const C = CreatorPageNoDeps.pipe(
            Component.provide(runtime.pipe(Layer.provide(adapter), Layer.provideMerge(upload))),
          )

          const play = yield* HtmlPlay.make(C, props)
          play.root.send(M.UpdatedField({ field: 'title', value: 'Draft' }))

          if (publish) play.root.send(M.RequestedOpenReview())
          play.root.send(publish ? M.RequestedPublish() : M.RequestedSave())
          yield* TestHost.settle
          yield* Deferred.await(entered)
          play.root.send(M.RequestedSave())
          play.root.send(M.RequestedPublish())
          play.root.send(M.PickedKind({ kind: 'mix' }))
          yield* TestHost.settle
          assert.deepEqual(saves, [publish])
          assert.equal(play.root.model()?.draft.kind, 'micro')
          yield* Deferred.succeed(release, undefined)
          yield* TestHost.settle
          assert.equal(play.root.model()?.published, publish)
          assert.equal(play.root.model()?.draft.postId, 'post-a')
          play.root.send(M.UpdatedField({ field: 'content', value: 'Unsaved notes' }))
          play.root.send(M.UpdatedField({ field: 'musicUrl', value: 'https://music.test/current' }))
          play.root.send(M.RequestedMusic())
          yield* TestHost.settle
          yield* Deferred.await(musicEntered)
          play.root.send(M.RequestedMusic())
          yield* TestHost.settle
          assert.deepEqual(musicCalls, ['post-a'])
          yield* Deferred.succeed(musicRelease, undefined)
          yield* TestHost.settle
          assert.equal(play.root.model()?.saving, false)
          assert.equal(play.root.model()?.draft.content, 'Unsaved notes')
          assert.equal(play.root.model()?.draft.musicEntityId, 'track-a')
          assert.equal(play.root.model()?.draft.expectedUpdatedAt, '2026-11-27T12:00:01.000Z')
          assert.isNull(play.root.model()?.error)
        }),
    )
  }

  for (const outcome of ['success', 'failure']) {
    it.effect(
      `saved-post same URL reentry rejects old ${outcome} while the fresh music operation remains pending`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()

          const old = yield* Deferred.make<
            typeof ResolvePostMusicResponse.Type,
            CreatorRequestError
          >()

          const current = yield* Deferred.make<
            typeof ResolvePostMusicResponse.Type,
            CreatorRequestError
          >()

          let calls = 0

          const adapter = Layer.effect(
            CreatorService,
            Effect.map(CreatorService, (base) => ({
              ...base,
              resolvePostMusic: () =>
                Effect.suspend(() => {
                  calls++

                  if (calls === 1)
                    return Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(old)),
                    )

                  return Deferred.await(current)
                }),
            })),
          ).pipe(Layer.provide(service))

          const C = CreatorPageNoDeps.pipe(
            Component.provide(
              Layer.mergeAll(
                runtime,
                GetEditable.toLayer(() =>
                  Effect.succeed({
                    ...emptyDraft('post', 'author-a', 'saved'),
                    postId: 'post-a',
                    title: 'Saved',
                    draft: true,
                    creators: [],
                  }),
                ),
              ).pipe(Layer.provide(adapter), Layer.provideMerge(upload)),
            ),
          )

          const play = yield* HtmlPlay.make(C, { ...props, url: '/new/editorial?edit=saved' })
          yield* TestHost.settle
          play.root.send(M.UpdatedField({ field: 'musicUrl', value: 'https://old.test' }))
          play.root.send(M.RequestedMusic())
          yield* TestHost.settle
          yield* Deferred.await(entered)
          play.root.send(M.UpdatedField({ field: 'musicUrl', value: 'https://new.test' }))
          play.root.send(M.UpdatedField({ field: 'musicUrl', value: 'https://old.test' }))
          play.root.send(M.RequestedMusic())
          yield* TestHost.settle

          const response: typeof ResolvePostMusicResponse.Type = {
            postId: 'post-a',
            url: 'https://old.test',
            entityType: 'track',
            entityId: 'old',
            title: 'Old',
            artistNames: [],
            coverImageUrl: null,
          }

          if (outcome === 'success') yield* Deferred.succeed(old, response)
          else
            yield* Deferred.fail(
              old,
              new CreatorRequestError({ operation: 'music', status: 503, message: 'Old failure' }),
            )
          yield* TestHost.settle
          assert.equal(calls, 2)
          assert.isTrue(play.root.model()?.saving)
          assert.isNull(play.root.model()?.draft.musicEntityId)
          assert.isNull(play.root.model()?.error)
          yield* Deferred.succeed(current, { ...response, entityId: 'current', title: 'Current' })
          yield* TestHost.settle
          assert.isFalse(play.root.model()?.saving)
          assert.equal(play.root.model()?.draft.musicEntityId, 'current')
        }),
    )
  }

  it.effect(
    'accepted mosaic survives later writing, while generation failure and dismissal preserve artwork',
    () =>
      Effect.gen(function* () {
        const release = yield* Deferred.make<File, CreatorRequestError>()
        let generations = 0

        const adapter = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            generateMosaic: () =>
              Effect.suspend(() => {
                generations++

                if (generations === 1) return Effect.succeed(new File(['image'], 'mosaic.png'))

                return Deferred.await(release)
              }),
            uploadImage: () => Effect.succeed('https://images.test/mosaic.png'),
            writeLocalDraft: () => Effect.void,
          })),
        ).pipe(Layer.provide(service))

        const C = CreatorPageNoDeps.pipe(
          Component.provide(runtime.pipe(Layer.provide(adapter), Layer.provideMerge(upload))),
        )

        const play = yield* HtmlPlay.make(C, { ...props, url: '/new/editorial' })
        play.root.send(M.UpdatedField({ field: 'thumbnailUrl', value: 'original.png' }))
        play.root.send(M.UpdatedField({ field: 'content', value: 'First version' }))
        play.root.send(M.RequestedMosaic())
        yield* TestHost.settle
        assert.equal(play.root.model()?.draft.thumbnailUrl, 'original.png')
        play.root.send(M.ClickedApplyMosaicCover())
        play.root.send(M.UpdatedField({ field: 'content', value: 'New version' }))
        yield* TestHost.settle
        assert.equal(play.root.model()?.draft.thumbnailUrl, 'https://images.test/mosaic.png')
        play.root.send(M.RequestedMosaic())
        play.root.send(M.RequestedMosaic())
        yield* TestHost.settle
        assert.equal(generations, 2)
        const draft = play.root.model()?.draft
        yield* Deferred.fail(
          release,
          new CreatorRequestError({
            operation: 'mosaic',
            status: 503,
            message: 'No images',
          }),
        )
        yield* TestHost.settle
        assert.deepEqual(play.root.model()?.draft, draft)
        assert.isFalse(play.root.model()?.mosaicBusy)
        assert.include(play.root.model()?.error, 'No images')
        play.root.send(M.ClickedDiscardMosaic())
        yield* TestHost.settle
        assert.deepEqual(play.root.model()?.draft, draft)
        assert.isNull(play.root.model()?.mosaic)
      }),
  )

  for (const afterPublication of [false, true]) {
    it.effect(
      `actual autosave completion afterPublication=${afterPublication} cannot dismiss review or roll back publication`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const completed: Array<string> = []

          const adapter = Layer.effect(
            CreatorService,
            Effect.map(CreatorService, (base) => ({
              ...base,
              writeLocalDraft: () =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    Effect.sync(() => {
                      completed.push('written')
                    }),
                  ),
                  Effect.uninterruptible,
                ),
              save: () => Effect.succeed({ id: 'post-a', slug: 'published' }),
              reconcileLocalDraft: () => Effect.void,
            })),
          ).pipe(Layer.provide(service))

          const C = CreatorPageNoDeps.pipe(
            Component.provide(runtime.pipe(Layer.provide(adapter), Layer.provideMerge(upload))),
          )

          const play = yield* HtmlPlay.make(C, props)
          yield* TestHost.settle
          play.root.send(M.UpdatedField({ field: 'title', value: 'Draft' }))
          play.root.send(M.RequestedAutosave())
          play.root.send(M.RequestedOpenReview())
          yield* TestHost.settle
          yield* Deferred.await(entered)
          assert.isTrue(play.root.model()?.review)

          if (afterPublication) {
            play.root.send(M.RequestedPublish())
            yield* TestHost.settle
            assert.isTrue(play.root.model()?.published)
          }

          yield* Deferred.succeed(release, undefined)
          yield* TestHost.settle
          assert.deepEqual(completed, ['written'])

          if (afterPublication) {
            assert.isTrue(play.root.model()?.published)
            assert.equal(play.root.model()?.notice, 'Published.')
            assert.equal(play.root.model()?.draft.postId, 'post-a')
          } else {
            assert.isTrue(play.root.model()?.review)
            assert.equal(play.root.model()?.localRevision, play.root.model()?.revision)
          }
        }),
    )
  }

  it.effect(
    'quote adapter rejects a mismatched slug and uses body fallback for the current null-title tweet',
    () =>
      Effect.gen(function* () {
        let requests = 0

        const adapter = Layer.effect(
          CreatorService,
          Effect.map(CreatorService, (base) => ({
            ...base,
            resolveQuote: () =>
              Effect.sync(() => {
                requests++

                return {
                  id: requests === 1 ? 'old-id' : 'current-id',
                  slug: requests === 1 ? 'old-thread' : 'current-thread',
                  title: null,
                  content: 'Current tweet',
                }
              }),
          })),
        ).pipe(Layer.provide(service))

        const C = CreatorPageNoDeps.pipe(
          Component.provide(runtime.pipe(Layer.provide(adapter), Layer.provideMerge(upload))),
        )

        const play = yield* HtmlPlay.make(C, props)
        play.root.send(
          M.UpdatedField({
            field: 'quoteUrl',
            value: 'https://goosebumps.fm/tweet/current-thread',
          }),
        )
        play.root.send(M.RequestedQuote())
        yield* TestHost.settle
        assert.isNull(play.root.model()?.draft.quotedPostId)
        assert.include(play.root.model()?.error, 'did not match')
        play.root.send(M.RequestedQuote())
        yield* TestHost.settle
        assert.equal(requests, 2)
        assert.equal(play.root.model()?.draft.quotedPostId, 'current-id')
        assert.equal(play.root.model()?.quoteTitle, 'Current tweet')
      }),
  )
})
