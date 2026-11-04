import { Cause, Effect, Exit, Fiber, Layer, Option, Schema, Scope } from 'effect'
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

const Identity = Schema.Struct({ uploadId: Schema.String, key: Schema.String })

const PartRequest = Schema.Struct({ ...Identity.fields, partNumber: Schema.Number })

const CompleteRequest = Schema.Struct({
  ...Identity.fields,
  parts: Schema.Array(Schema.Struct({ partNumber: Schema.Number, etag: Schema.String })),
})

const readIdentity = Schema.decodeUnknownSync(Schema.fromJsonString(Identity))

const readPart = Schema.decodeUnknownSync(Schema.fromJsonString(PartRequest))

const readComplete = Schema.decodeUnknownSync(Schema.fromJsonString(CompleteRequest))

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

  const sessions = new Map<
    string,
    { key: string; parts: PersistedResumableUpload['completedParts']; aborted: boolean }
  >()

  let nextUpload = 0
  const presigned = new Set<string>()

  const sessionFor = (identity: typeof Identity.Type) => {
    const session = sessions.get(identity.uploadId)
    expect(session?.key).toBe(identity.key)

    if (!session) throw new Error('Unknown multipart upload')

    expect(session.aborted).toBe(false)

    return session
  }

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

      if (url.endsWith('/abort')) {
        const session = sessionFor(readIdentity(init.body))

        if (holdAbort) {
          abortEntered.resolve()
          await abortRelease.promise
        }

        session.aborted = true

        return Response.json({ ok: true })
      }

      if (url.startsWith('https://upload.test/')) {
        expect(presigned.has(url)).toBe(true)
        const target = new URL(url)
        const [, uploadId, part] = target.pathname.split('/')
        const partNumber = Number(part)
        const session = sessions.get(uploadId ?? '')
        expect(session).toBeDefined()
        expect(session?.aborted).toBe(false)
        expect(init.method).toBe('PUT')
        expect(init.body).toBeInstanceOf(Blob)

        if (!(init.body instanceof Blob) || !session) throw new Error('Invalid part upload')

        expect(await init.body.text()).toBe(partNumber === 1 ? 'abc' : 'def')
        expect([1, 2]).toContain(partNumber)

        if (hold) {
          entered.resolve()
          await release.promise
        }

        if (fail) return new Response(null, { status: 400 })

        const etag = `etag-${partNumber}`
        session.parts = [
          ...session.parts.filter((part) => part.partNumber !== partNumber),
          { partNumber, etag, size: init.body.size },
        ]

        return new Response(null, { headers: { ETag: etag } })
      }

      if (url.endsWith('/init')) {
        const uploadId = `upload-${++nextUpload}`
        const key = `audio/${uploadId}.mp3`
        sessions.set(uploadId, { key, parts: [], aborted: false })

        return Response.json({ uploadId, key, chunkSize: 3 })
      }

      if (url.includes('/status?')) {
        const query = new URL(url, 'https://api.test').searchParams

        const identity = Schema.decodeUnknownSync(Identity)({
          uploadId: query.get('uploadId'),
          key: query.get('key'),
        })

        return Response.json({ parts: sessionFor(identity).parts })
      }

      if (url.endsWith('/presign-part')) {
        const part = readPart(init.body)
        sessionFor(part)
        expect([1, 2]).toContain(part.partNumber)
        const signedUrl = `https://upload.test/${part.uploadId}/${part.partNumber}`
        presigned.add(signedUrl)

        return Response.json({
          url: signedUrl,
          partNumber: part.partNumber,
          expiresInSeconds: 300,
        })
      }

      if (url.endsWith('/complete')) {
        const complete = readComplete(init.body)
        const session = sessionFor(complete)
        expect(complete.parts).toEqual(
          session.parts
            .toSorted((a, b) => a.partNumber - b.partNumber)
            .map(({ partNumber, etag }) => ({ partNumber, etag })),
        )
        expect(complete.parts.map(({ partNumber }) => partNumber)).toEqual([1, 2])

        if (completeFails) return new Response(null, { status: 400 })

        return Response.json({ url: 'https://cdn.test/mix.mp3', key: complete.key })
      }

      throw new Error(`Unexpected upload request: ${url}`)
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
      const session = sessions.get(`upload-${nextUpload}`)

      if (!session) throw new Error('Expected an initialized upload')

      session.parts = parts
    },
    seed: (checkpoint: PersistedResumableUpload) => {
      sessions.set(checkpoint.uploadId, {
        key: checkpoint.key,
        parts: [],
        aborted: false,
      })
      checkpoints.set(checkpoint.fileFingerprint, checkpoint)
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
  it('keeps the replacement file resumable when an older cancellation finishes during upload', async () => {
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
        expect(
          test.requests
            .filter(({ url }) => url.endsWith('/abort'))
            .map(({ init }) => readIdentity(init.body)),
        ).toEqual([{ uploadId: 'upload-1', key: 'audio/upload-1.mp3' }])
        expect(test.checkpoints.get(computeFileFingerprint(file('replacement.mp3')))).toMatchObject(
          {
            uploadId: 'upload-2',
            key: 'audio/upload-2.mp3',
          },
        )
        expect(
          test.requests.find(({ url }) => url === 'https://upload.test/upload-2/1')?.init.signal
            ?.aborted,
        ).toBe(false)
        expect(failureTag(yield* Effect.exit(upload.resume))).toHaveProperty(
          '_tag',
          'AlreadyInProgressError',
        )
        expect(failureTag(yield* Effect.exit(upload.start(file('third.mp3'))))).toHaveProperty(
          '_tag',
          'AlreadyInProgressError',
        )
        yield* upload.pause
        test.release.resolve()
        expect(failureTag(yield* Fiber.await(replacement))).toHaveProperty('_tag', 'UploadPaused')
        expect(yield* upload.resume).toBe('https://cdn.test/mix.mp3')
      }).pipe(Effect.scoped),
    )
  })

  it('keeps a failed replacement resumable when an older cancellation finishes afterward', async () => {
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
        expect(
          failureTag(yield* Effect.exit(upload.start(file('replacement.mp3')))),
        ).toHaveProperty('status', 400)
        test.abortRelease.resolve()
        yield* Fiber.join(cancelling)
        test.fail(false)
        expect(yield* upload.resume).toBe('https://cdn.test/mix.mp3')
        expect(test.requests.filter(({ url }) => url.endsWith('/init'))).toHaveLength(2)
        expect(test.checkpoints.size).toBe(0)
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

  it('retains the file and completed checkpoint when remote finalization fails', async () => {
    const test = fixture()
    test.failComplete(true)
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(test.layer)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        expect(Exit.isFailure(yield* Effect.exit(upload.start(file())))).toBe(true)
        expect(test.checkpoints.get(computeFileFingerprint(file()))?.completedParts).toHaveLength(2)
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
  })

  it('returns confirmed success without retaining a resumable file when checkpoint cleanup fails', async () => {
    const test = fixture()
    test.failClear(true)
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(test.layer)
        const upload = yield* CreatorUpload.pipe(Effect.provideContext(context))
        expect(yield* upload.start(file())).toBe('https://cdn.test/mix.mp3')
        expect(test.checkpoints.get(computeFileFingerprint(file()))?.completedParts).toHaveLength(2)
        expect(failureTag(yield* Effect.exit(upload.resume))).toHaveProperty(
          '_tag',
          'InvalidResponseError',
        )
        yield* upload.cancel
        expect(test.requests.filter(({ url }) => url.endsWith('/complete'))).toHaveLength(1)
        expect(test.requests.filter(({ url }) => url.endsWith('/abort'))).toHaveLength(0)
      }).pipe(Effect.scoped),
    )
  })

  it('emits completed progress after confirmed remote completion even if cleanup fails', async () => {
    const test = fixture()
    test.failClear(true)
    const phases: Array<string> = []

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(Layer.merge(test.storage, test.transport))

        return yield* uploadProgram(
          { file: file(), fileType: 'audio' },
          {
            signal: new AbortController().signal,
            isPaused: () => false,
            onProgress: ({ phase }) => phases.push(phase),
            onCheckpoint: () => {},
          },
        ).pipe(Effect.provideContext(context))
      }).pipe(Effect.scoped),
    )

    expect(result.url).toBe('https://cdn.test/mix.mp3')
    expect(phases.at(-1)).toBe('completed')
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
        expect(checkpoint?.completedParts).toEqual([{ partNumber: 1, etag: 'etag-1', size: 3 }])
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
      init: { uploadId: 'upload-0', key: 'audio/mix.mp3', chunkSize: 3 },
      now: 1,
    })

    test.seed({
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
