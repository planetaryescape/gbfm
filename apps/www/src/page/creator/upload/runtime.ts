import { Context, Data, Effect, Layer, Queue, Stream } from 'effect'

import { AlreadyInProgressError, InvalidResponseError, type ResumableUploadError } from './errors'
import { cancelProgram, uploadProgram, type UploadProgress } from './program'
import { computeFileFingerprint } from './protocol'
import { ResumableUploadStorage, ResumableUploadStorageLive } from './storage'
import { UploadTransport, UploadTransportLive } from './transport'

type Ownership =
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'Retained'; readonly file: File }
  | { readonly _tag: 'Running'; readonly file: File | null; readonly controller: AbortController }
  | { readonly _tag: 'Pausing'; readonly file: File | null; readonly controller: AbortController }

const Ownership = Data.taggedEnum<Ownership>()

const retainedFile = Ownership.$match({
  Empty: () => null,
  Retained: ({ file }) => file,
  Running: ({ file }) => file,
  Pausing: ({ file }) => file,
})

const activeController = Ownership.$match({
  Empty: () => null,
  Retained: () => null,
  Running: ({ controller }) => controller,
  Pausing: ({ controller }) => controller,
})

const clearFile = Ownership.$match({
  Empty: () => Ownership.Empty(),
  Retained: () => Ownership.Empty(),
  Running: ({ controller }) => Ownership.Running({ controller, file: null }),
  Pausing: ({ controller }) => Ownership.Pausing({ controller, file: null }),
})

export class CreatorUpload extends Context.Service<
  CreatorUpload,
  {
    readonly start: (file: File) => Effect.Effect<string, ResumableUploadError>
    readonly resume: Effect.Effect<string, ResumableUploadError>
    readonly pause: Effect.Effect<void>
    readonly cancel: Effect.Effect<void, ResumableUploadError>
    readonly progress: Stream.Stream<UploadProgress>
  }
>()('@gbfm/www/CreatorUpload') {}

export const CreatorUploadLayer = Layer.effect(
  CreatorUpload,
  Effect.gen(function* () {
    const storage = yield* ResumableUploadStorage
    const transport = yield* UploadTransport
    const listeners = new Set<(progress: UploadProgress) => void>()
    let ownership: Ownership = Ownership.Empty()

    yield* Effect.addFinalizer(() => Effect.sync(() => activeController(ownership)?.abort()))

    const start = Effect.fn('CreatorUpload.start')(function* (selected: File) {
      if (activeController(ownership))
        return yield* new AlreadyInProgressError({ message: 'An upload is already running.' })
      const controller = new AbortController()
      ownership = Ownership.Running({ controller, file: selected })

      return yield* Effect.gen(function* () {
        const checkpoint = yield* storage.read(computeFileFingerprint(selected))

        const result = yield* uploadProgram(
          { file: selected, fileType: 'audio' },
          {
            signal: controller.signal,
            isPaused: () => Ownership.$is('Pausing')(ownership),
            onCheckpoint: () => {},
            onProgress: (progress) => listeners.forEach((listener) => listener(progress)),
            checkpoint: checkpoint ?? undefined,
          },
        )

        ownership = clearFile(ownership)

        return result.url
      }).pipe(
        Effect.provideService(ResumableUploadStorage, storage),
        Effect.provideService(UploadTransport, transport),
        Effect.ensuring(
          Effect.sync(() => {
            controller.abort()
            const file = retainedFile(ownership)
            ownership = file ? Ownership.Retained({ file }) : Ownership.Empty()
          }),
        ),
      )
    })

    return CreatorUpload.of({
      start,
      resume: Effect.gen(function* () {
        const file = retainedFile(ownership)

        if (!file)
          return yield* new InvalidResponseError({
            message: 'Select the original audio file to resume.',
          })

        return yield* start(file)
      }).pipe(Effect.withSpan('CreatorUpload.resume')),
      pause: Effect.sync(() => {
        if (Ownership.$is('Running')(ownership))
          ownership = Ownership.Pausing({ file: ownership.file, controller: ownership.controller })
      }),
      cancel: Effect.gen(function* () {
        if (activeController(ownership))
          return yield* new AlreadyInProgressError({
            message: 'Pause the upload before cancelling.',
          })

        const file = retainedFile(ownership)

        if (file) {
          const checkpoint = yield* storage.read(computeFileFingerprint(file))

          if (checkpoint)
            yield* cancelProgram(checkpoint, new AbortController().signal).pipe(
              Effect.provideService(ResumableUploadStorage, storage),
              Effect.provideService(UploadTransport, transport),
            )
        }

        ownership = clearFile(ownership)

        return undefined
      }).pipe(Effect.withSpan('CreatorUpload.cancel')),
      progress: Stream.callback<UploadProgress>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (progress: UploadProgress) => {
              Queue.offerUnsafe(queue, progress)
            }

            listeners.add(listener)

            return listener
          }),
          (listener) =>
            Effect.sync(() => {
              listeners.delete(listener)
            }),
        ),
      ),
    })
  }),
)

export const CreatorUploadLive = CreatorUploadLayer.pipe(
  Layer.provide(ResumableUploadStorageLive),
  Layer.provide(UploadTransportLive),
)
