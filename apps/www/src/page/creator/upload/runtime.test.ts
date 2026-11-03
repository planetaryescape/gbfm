import { Cause, Effect, Exit, Fiber, Layer, Option, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { StorageQuotaError } from './errors'
import { uploadProgram } from './program'
import {
  computeFileFingerprint,
  createPersistedUpload,
  type PersistedResumableUpload,
} from './protocol'
import { CreatorUpload, CreatorUploadLayer } from './runtime'
import { ResumableUploadStorage } from './storage'
import { UploadTransport } from './transport'

const file = (name = 'mix.mp3') =>
  new File(['abcdef'], name, { type: 'audio/mpeg', lastModified: 1 })

const fixture = () => {
  const checkpoints = new Map<string, PersistedResumableUpload>()
  const requests: Array<{ url: string; init: RequestInit }> = []
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const abortEntered = Promise.withResolvers<void>()
  const abortRelease = Promise.withResolvers<void>()
  let hold = false
  let fail = false
  let clearFails = false
  let completeFails = false
  let holdAbort = false
  let remoteParts: PersistedResumableUpload['completedParts'] = []

  const storage = Layer.succeed(ResumableUploadStorage, {
    read: (key) => Effect.sync(() => checkpoints.get(key) ?? null),
    write: (value) =>
      Effect.sync(() => {
        checkpoints.set(value.fileFingerprint, value)
      }),
    clear: (key) =>
      clearFails
        ? Effect.fail(new StorageQuotaError({ message: 'Full' }))
        : Effect.sync(() => {
            checkpoints.delete(key)
          }),
  })

  const transport = Layer.succeed(UploadTransport, {
    fetch: async (url, init) => {
      requests.push({ url, init })

      if (url.endsWith('/abort') && holdAbort) {
        abortEntered.resolve()
        await abortRelease.promise
      }

      if (url === 'https://upload.test/part') {
        if (hold) {
          entered.resolve()
          await release.promise
        }

        return fail
          ? new Response(null, { status: 400 })
          : new Response(null, { headers: { ETag: 'etag' } })
      }

      if (url.endsWith('/init'))
        return Response.json({ uploadId: 'upload', key: 'audio/mix.mp3', chunkSize: 3 })

      if (url.includes('/status?')) return Response.json({ parts: remoteParts })

      if (url.endsWith('/presign-part'))
        return Response.json({
          url: 'https://upload.test/part',
          partNumber: 1,
          expiresInSeconds: 300,
        })

      if (url.endsWith('/complete') && completeFails) return new Response(null, { status: 400 })

      if (url.endsWith('/complete'))
        return Response.json({ url: 'https://cdn.test/mix.mp3', key: 'audio/mix.mp3' })

      return Response.json({ ok: true })
    },
  })

  return {
    checkpoints,
    requests,
    entered,
    release,
    abortEntered,
    abortRelease,
    holdAbort: () => {
      holdAbort = true
    },
    hold: () => {
      hold = true
    },
    fail: (value: boolean) => {
      fail = value
    },
    failClear: (value: boolean) => {
      clearFails = value
    },
    failComplete: (value: boolean) => {
      completeFails = value
    },
    remote: (parts: PersistedResumableUpload['completedParts']) => {
      remoteParts = parts
    },
    layer: CreatorUploadLayer.pipe(Layer.provide(storage), Layer.provide(transport)),
    storage,
    transport,
  }
}

const failureTag = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) return undefined
  const error = Cause.findErrorOption(exit.cause)

  return Option.isSome(error) ? error.value : undefined
}

describe('creator upload ownership through the multipart program', () => {
  it('preserves the existing cancellation and replacement overlap without losing the active controller', async () => {
    const test = fixture()
    test.fail(true)
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(test.layer)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        yield* Effect.exit(upload.start(file()))
        test.holdAbort()
        const cancelling = yield* upload.cancel.pipe(Effect.forkChild)
        yield* Effect.promise(() => test.abortEntered.promise)
        test.fail(false)
        test.hold()
        const replacement = yield* upload.start(file('replacement.mp3')).pipe(Effect.forkChild)
        yield* Effect.promise(() => test.entered.promise)
        test.abortRelease.resolve()
        yield* Fiber.join(cancelling)
        expect(failureTag(yield* Effect.exit(upload.resume))).toHaveProperty(
          '_tag',
          'InvalidResponseError',
        )
        expect(failureTag(yield* Effect.exit(upload.start(file('third.mp3'))))).toHaveProperty(
          '_tag',
          'AlreadyInProgressError',
        )
        test.release.resolve()
        expect(yield* Fiber.join(replacement)).toBe('https://cdn.test/mix.mp3')
      }).pipe(Effect.scoped),
    )
  })

  it('checks the expected size before making any network request', async () => {
    const test = fixture()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(Layer.merge(test.storage, test.transport))

        return yield* uploadProgram(
          { file: file(), fileType: 'audio', maxBytes: 5 },
          {
            signal: new AbortController().signal,
            isPaused: () => false,
            onProgress: () => {},
            onCheckpoint: () => {},
          },
        ).pipe(Effect.provideContext(context), Effect.exit)
      }).pipe(Effect.scoped),
    )

    expect(failureTag(result)).toHaveProperty('_tag', 'FileTooLargeError')
    expect(test.requests).toEqual([])
  })

  it('retains the file and completed checkpoint when finalization or local cleanup fails', async () => {
    for (const failure of ['complete', 'clear']) {
      const test = fixture()

      if (failure === 'complete') test.failComplete(true)
      else test.failClear(true)
      await Effect.runPromise(
        Effect.gen(function* () {
          const context = yield* Layer.build(test.layer)
          const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
          expect(Exit.isFailure(yield* Effect.exit(upload.start(file())))).toBe(true)
          expect(test.checkpoints.get(computeFileFingerprint(file()))?.completedParts).toHaveLength(
            2,
          )
          test.failClear(false)
          test.failComplete(false)
          test.remote([
            { partNumber: 1, etag: 'one', size: 3 },
            { partNumber: 2, etag: 'two', size: 3 },
          ])
          expect(yield* upload.resume).toBe('https://cdn.test/mix.mp3')
          expect(test.requests.filter(({ init }) => init.method === 'PUT')).toHaveLength(2)
        }).pipe(Effect.scoped),
      )
    }
  })

  it('rejects duplicate starts and cancellation until a part finishes, then resumes remote parts', async () => {
    const test = fixture()
    test.hold()
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(test.layer)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        const storageFile = file()
        const running = yield* upload.start(storageFile).pipe(Effect.exit, Effect.forkChild)
        yield* Effect.promise(() => test.entered.promise)
        expect(
          failureTag(yield* Effect.exit(upload.start(file('replacement.mp3')))),
        ).toHaveProperty('_tag', 'AlreadyInProgressError')
        yield* upload.pause
        expect(failureTag(yield* Effect.exit(upload.cancel))).toHaveProperty(
          '_tag',
          'AlreadyInProgressError',
        )
        test.release.resolve()
        expect(failureTag(yield* Fiber.join(running))).toHaveProperty('_tag', 'UploadPaused')
        const checkpoint = test.checkpoints.get(computeFileFingerprint(storageFile))
        expect(checkpoint?.completedParts).toEqual([{ partNumber: 1, etag: 'etag', size: 3 }])
        test.remote([{ partNumber: 1, etag: 'remote-etag', size: 3 }])
        expect(yield* upload.resume).toBe('https://cdn.test/mix.mp3')
        expect(test.requests.filter(({ init }) => init.method === 'PUT')).toHaveLength(2)
        expect(test.checkpoints.size).toBe(0)
        expect(failureTag(yield* Effect.exit(upload.resume))).toHaveProperty(
          '_tag',
          'InvalidResponseError',
        )
        expect(test.requests.find(({ url }) => url.endsWith('/complete'))?.init.body).toContain(
          'remote-etag',
        )
      }).pipe(Effect.scoped),
    )
  })

  it('retains failed files, retries from the checkpoint, permits replacement and clears cancellation', async () => {
    const test = fixture()
    test.fail(true)
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(test.layer)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        expect(failureTag(yield* Effect.exit(upload.start(file())))).toHaveProperty('status', 400)
        expect(test.checkpoints.size).toBe(1)
        test.fail(false)
        expect(yield* upload.resume).toBe('https://cdn.test/mix.mp3')
        test.fail(true)
        yield* Effect.exit(upload.start(file()))
        yield* Effect.exit(upload.start(file('replacement.mp3')))
        expect(test.checkpoints.size).toBe(2)
        yield* upload.cancel
        expect(test.checkpoints.has(computeFileFingerprint(file()))).toBe(true)
        expect(test.checkpoints.has(computeFileFingerprint(file('replacement.mp3')))).toBe(false)
        expect(failureTag(yield* Effect.exit(upload.resume))).toHaveProperty(
          '_tag',
          'InvalidResponseError',
        )
      }).pipe(Effect.scoped),
    )
  })

  it('uses remote status instead of trusting local completed parts', async () => {
    const test = fixture()
    const selected = file()

    const checkpoint = createPersistedUpload({
      file: selected,
      fileFingerprint: computeFileFingerprint(selected),
      init: { uploadId: 'upload', key: 'audio/mix.mp3', chunkSize: 3 },
      now: 1,
    })

    test.checkpoints.set(checkpoint.fileFingerprint, {
      ...checkpoint,
      completedParts: [{ partNumber: 1, etag: 'local', size: 3 }],
    })
    test.remote([{ partNumber: 2, etag: 'remote', size: 3 }])
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(test.layer)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        expect(yield* upload.start(selected)).toBe('https://cdn.test/mix.mp3')
        expect(test.requests.filter(({ init }) => init.method === 'PUT')).toHaveLength(1)
        expect(test.requests.find(({ url }) => url.endsWith('/presign-part'))?.init.body).toContain(
          '"partNumber":1',
        )
        expect(test.requests.some(({ url }) => url.endsWith('/init'))).toBe(false)
      }).pipe(Effect.scoped),
    )
  })

  it('aborts the active signal on owner disposal without deleting its checkpoint', async () => {
    const test = fixture()
    test.hold()
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(test.layer, scope)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        const running = yield* upload.start(file()).pipe(Effect.exit, Effect.forkChild)
        yield* Effect.promise(() => test.entered.promise)
        yield* Scope.close(scope, Exit.void)
        expect(test.requests.find(({ init }) => init.method === 'PUT')?.init.signal?.aborted).toBe(
          true,
        )
        test.release.resolve()
        expect(failureTag(yield* Fiber.join(running))).toHaveProperty('_tag', 'UploadAborted')
        expect(test.checkpoints.size).toBe(1)
      }).pipe(Effect.scoped),
    )
  })
})
