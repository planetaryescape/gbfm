import { assert, describe, it } from '@effect/vitest'
import type { ResolvePostMusicResponse } from '@gbfm/api/post'
import { Effect, Layer, Stream } from 'effect'

import { emptyDraft } from './domain'
import { PauseUpload, ResolvePostMusic, SaveContent, UploadAudio } from './operations'
import { CreatorRequestError, CreatorService, CreatorServiceLive, type SaveInput } from './services'
import { CreatorPageMessage as M } from './state'
import { NetworkError, UploadPaused } from './upload/errors'
import { CreatorUpload } from './upload/runtime'

describe('native creator command service seams', () => {
  it.effect(
    'projects acknowledged bytes into each pause result without leaking the checkpoint',
    () =>
      Effect.gen(function* () {
        const checkpoint = {
          fileFingerprint: 'synthetic-a',
          uploadId: 'synthetic-upload',
          key: 'audio/synthetic.mp3',
          chunkSize: 4,
          totalBytes: 11,
          totalParts: 3,
          contentType: 'audio/mpeg',
          fileName: 'mix.mp3',
          createdAt: 0,
          updatedAt: 0,
        }

        const first = { partNumber: 1, etag: 'etag-1', size: 4 }
        const second = { partNumber: 2, etag: 'etag-2', size: 4 }

        const service = Layer.succeed(CreatorUpload, {
          start: () =>
            Effect.fail(
              new UploadPaused({
                checkpoint: { ...checkpoint, completedParts: [first] },
              }),
            ),
          resume: Effect.fail(
            new UploadPaused({
              checkpoint: { ...checkpoint, completedParts: [first, second] },
            }),
          ),
          pause: Effect.void,
          cancel: Effect.void,
          progress: Stream.empty,
        })

        const context = yield* Layer.build(UploadAudio.layer.pipe(Layer.provide(service)))

        const firstPause = yield* UploadAudio.make({
          file: new File(['abcdefghijk'], 'mix.mp3'),
        }).effect.pipe(Effect.provide(context))

        const secondPause = yield* UploadAudio.make({}).effect.pipe(Effect.provide(context))
        assert.deepEqual(
          firstPause,
          M.FailedUploadAudio({
            message: 'Upload paused.',
            paused: true,
            checkpointPercent: 36,
          }),
        )
        assert.deepEqual(
          secondPause,
          M.FailedUploadAudio({
            message: 'Upload paused.',
            paused: true,
            checkpointPercent: 72,
          }),
        )
      }),
  )

  it.effect('does not serialize upload checkpoints or transport credentials into UI results', () =>
    Effect.gen(function* () {
      const service = Layer.succeed(CreatorUpload, {
        start: () =>
          Effect.fail(
            new UploadPaused({
              checkpoint: {
                fileFingerprint: 'file-a',
                uploadId: 'private-upload-identity',
                key: 'private-storage-key',
                chunkSize: 10,
                totalBytes: 10,
                totalParts: 1,
                contentType: 'audio/mpeg',
                fileName: 'mix.mp3',
                completedParts: [],
                createdAt: 0,
                updatedAt: 0,
              },
            }),
          ),
        resume: Effect.fail(
          new NetworkError({
            message: 'https://storage.test/part?X-Amz-Signature=private-upload-signature',
          }),
        ),
        pause: Effect.void,
        cancel: Effect.void,
        progress: Stream.empty,
      })

      const context = yield* Layer.build(UploadAudio.layer.pipe(Layer.provide(service)))

      const paused = yield* UploadAudio.make({ file: new File(['audio'], 'mix.mp3') }).effect.pipe(
        Effect.provide(context),
      )

      const failed = yield* UploadAudio.make({}).effect.pipe(Effect.provide(context))

      assert.deepEqual(
        paused,
        M.FailedUploadAudio({ message: 'Upload paused.', paused: true, checkpointPercent: 0 }),
      )
      assert.notInclude(JSON.stringify(paused), 'private-upload-identity')
      assert.notInclude(JSON.stringify(paused), 'private-storage-key')
      assert.notInclude(JSON.stringify(failed), 'private-upload-signature')
    }),
  )

  it.effect('passes revision and publish intent to the real creator adapter contract', () =>
    Effect.gen(function* () {
      const writes: Array<SaveInput> = []

      const service = Layer.effect(
        CreatorService,
        Effect.map(CreatorService, (base) => ({
          ...base,
          save: (input: SaveInput) =>
            Effect.sync(() => {
              writes.push(input)

              return { id: 'post-a', slug: 'saved', updatedAt: '2026-11-26T12:00:01.000Z' }
            }),
        })),
      ).pipe(Layer.provide(CreatorServiceLive))

      const draft = {
        ...emptyDraft('post', 'author-a', 'saved'),
        title: 'Preserve revision',
        expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
      }

      const context = yield* Layer.build(SaveContent.layer.pipe(Layer.provide(service)))

      const result = yield* SaveContent.make({
        draft,
        creatorId: 'author-a',
        revision: 9,
        operation: 12,
        publish: true,
      }).effect.pipe(Effect.provide(context))

      assert.deepEqual(writes, [{ draft, creatorId: 'author-a', publish: true }])
      assert.deepEqual(
        result,
        M.SucceededSaveContent({
          draft,
          revision: 9,
          operation: 12,
          publish: true,
          saved: { id: 'post-a', slug: 'saved', updatedAt: '2026-11-26T12:00:01.000Z' },
        }),
      )
    }),
  )

  it.effect('maps a typed server conflict to the owning operation without losing its draft', () =>
    Effect.gen(function* () {
      const service = Layer.effect(
        CreatorService,
        Effect.map(CreatorService, (base) => ({
          ...base,
          save: () =>
            Effect.fail(
              new CreatorRequestError({
                operation: 'save content',
                status: 409,
                message: 'Another editor saved first.',
              }),
            ),
        })),
      ).pipe(Layer.provide(CreatorServiceLive))

      const context = yield* Layer.build(SaveContent.layer.pipe(Layer.provide(service)))

      const result = yield* SaveContent.make({
        draft: { ...emptyDraft('post', 'author-a'), title: 'Keep me' },
        creatorId: 'author-a',
        revision: 3,
        operation: 8,
        publish: false,
      }).effect.pipe(Effect.provide(context))

      assert.deepEqual(
        result,
        M.FailedOperation({ operation: 8, message: 'Another editor saved first.' }),
      )
    }),
  )

  it.effect('uses the saved-post music resolution seam with the observed server revision', () =>
    Effect.gen(function* () {
      const resolutions: Array<ReadonlyArray<string | undefined>> = []

      const service = Layer.effect(
        CreatorService,
        Effect.map(CreatorService, (base) => ({
          ...base,
          resolvePostMusic: (postId: string, url: string, expectedUpdatedAt?: string) =>
            Effect.sync(() => {
              resolutions.push([postId, url, expectedUpdatedAt])

              return {
                postId,
                entityType: 'album',
                entityId: 'album-a',
                url,
                title: 'Native album',
                artistNames: [],
                coverImageUrl: null,
                updatedAt: '2026-11-26T12:00:01.000Z',
              } satisfies typeof ResolvePostMusicResponse.Type
            }),
        })),
      ).pipe(Layer.provide(CreatorServiceLive))

      const context = yield* Layer.build(ResolvePostMusic.layer.pipe(Layer.provide(service)))

      const result = yield* ResolvePostMusic.make({
        postId: 'post-a',
        url: 'https://music.example/album',
        expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
        operation: 7,
      }).effect.pipe(Effect.provide(context))

      assert.deepEqual(resolutions, [
        ['post-a', 'https://music.example/album', '2026-11-26T12:00:00.000Z'],
      ])
      assert.deepEqual(
        result,
        M.SucceededResolvePostMusic({
          operation: 7,
          postId: 'post-a',
          entityType: 'album',
          entityId: 'album-a',
          title: 'Native album',
          image: null,
          updatedAt: '2026-11-26T12:00:01.000Z',
        }),
      )
    }),
  )

  it.effect('starts, pauses and resumes through one scoped upload service', () =>
    Effect.gen(function* () {
      const actions: Array<string> = []

      const service = Layer.succeed(CreatorUpload, {
        start: (file) =>
          Effect.sync(() => {
            actions.push(`start:${file.name}`)

            return 'https://media.example/audio.mp3'
          }),
        pause: Effect.sync(() => {
          actions.push('pause')
        }),
        resume: Effect.sync(() => {
          actions.push('resume')

          return 'https://media.example/audio.mp3'
        }),
        cancel: Effect.void,
        progress: Stream.empty,
      })

      const layers = Layer.mergeAll(UploadAudio.layer, PauseUpload.layer).pipe(
        Layer.provide(service),
      )

      const context = yield* Layer.build(layers)

      const result = yield* UploadAudio.make({ file: new File(['audio'], 'mix.mp3') }).effect.pipe(
        Effect.provide(context),
      )

      yield* PauseUpload.make().effect.pipe(Effect.provide(context))
      yield* UploadAudio.make({}).effect.pipe(Effect.provide(context))
      assert.deepEqual(actions, ['start:mix.mp3', 'pause', 'resume'])
      assert.deepEqual(result, M.SucceededUploadAudio({ url: 'https://media.example/audio.mp3' }))
    }),
  )
})
