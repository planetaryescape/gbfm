/* oxlint-disable effecttsgo/strict-effect-provide -- Each test invokes Effect.runPromise, making it an Effect application entry point. */
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { describe, expect, test } from 'vitest'

import { cancelProgram } from './program'
import type { PersistedResumableUpload } from './protocol'
import { ResumableUploadStorage, ResumableUploadStorageInMemory } from './storage'
import { UploadTransport } from './transport'

const makePersisted = (
  overrides: Partial<PersistedResumableUpload> = {},
): PersistedResumableUpload => ({
  fileFingerprint: '123:track.mp3:1',
  uploadId: 'upload-1',
  key: 'user/audio_123_track.mp3',
  chunkSize: 5_000_000,
  totalBytes: 12_000_000,
  totalParts: 3,
  contentType: 'audio/mpeg',
  fileName: 'track.mp3',
  completedParts: [
    { partNumber: 1, etag: 'etag-1', size: 5_000_000 },
    { partNumber: 2, etag: 'etag-2', size: 5_000_000 },
  ],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  ...overrides,
})

const runWith = <A, E>(
  layer: Layer.Layer<ResumableUploadStorage>,
  effect: Effect.Effect<A, E, ResumableUploadStorage>,
) => Effect.runPromise(Effect.provide(effect, layer))

describe('ResumableUploadStorage in-memory', () => {
  test('stores checkpoints independently by fingerprint until they are cleared', async () => {
    const first = makePersisted()
    const second = makePersisted({ fileFingerprint: '456:other.mp3:2', uploadId: 'upload-2' })

    const lifecycle = await runWith(
      ResumableUploadStorageInMemory,
      Effect.gen(function* () {
        const storage = yield* ResumableUploadStorage
        const unknown = yield* storage.read('missing')
        yield* storage.write(first)
        yield* storage.write(second)
        const storedFirst = yield* storage.read(first.fileFingerprint)
        const storedSecond = yield* storage.read(second.fileFingerprint)
        yield* storage.clear(first.fileFingerprint)
        const clearedFirst = yield* storage.read(first.fileFingerprint)
        const retainedSecond = yield* storage.read(second.fileFingerprint)

        return { unknown, storedFirst, storedSecond, clearedFirst, retainedSecond }
      }),
    )

    expect(lifecycle).toEqual({
      unknown: null,
      storedFirst: first,
      storedSecond: second,
      clearedFirst: null,
      retainedSecond: second,
    })
  })

  test('retains the checkpoint and reports failure when cancellation cannot abort remotely', async () => {
    const persisted = makePersisted()
    const controller = new AbortController()
    controller.abort()

    const result = await runWith(
      ResumableUploadStorageInMemory,
      Effect.gen(function* () {
        const storage = yield* ResumableUploadStorage
        yield* storage.write(persisted)

        const failure = yield* cancelProgram(persisted, controller.signal).pipe(
          Effect.provideService(UploadTransport, {
            fetch: () => Promise.resolve(Response.error()),
          }),
          Effect.flip,
        )

        return { failure, checkpoint: yield* storage.read(persisted.fileFingerprint) }
      }),
    )

    expect(result.failure._tag).toBe('UploadAborted')
    expect(result.checkpoint).toEqual(persisted)
  })
})
