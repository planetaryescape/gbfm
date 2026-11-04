import { Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, PubSub, Scope, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import {
  makeAudioPlayback,
  type AudioPlaybackReporter,
  type PlaybackSnapshot,
} from './audioPlayback'
import type { VolumeRecordType } from './audioStorage'
import {
  AudioEngine,
  PlaybackRejected,
  type AudioEngineContract,
  type EngineStatus,
  type PlaybackCommandHandlers,
  type NowPlayingMetadata,
} from './engine'
import { AudioStorageError, type QueueTrackType, type PersistedQueueType } from './persistedQueue'
import { PlayerStorage, type PositionRecord } from './playerStorage'
import { PlayReporter } from './playReporter'

const track = (id: string): QueueTrackType => ({
  id,
  title: id,
  slug: id,
  url: `https://cdn.example/${id}.mp3`,
  thumbnailUrl: null,
  type: 'mix',
})

const idleStatus: EngineStatus = {
  sourceGeneration: null,
  isLoaded: false,
  playing: false,
  didJustFinish: false,
  currentTime: 0,
  duration: 0,
  isBuffering: false,
}

const makeRecordingEngine = (options: { readonly rejectPlay?: boolean } = {}) =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<EngineStatus>()
    const calls: Array<string> = []
    const metadata: Array<NowPlayingMetadata | null> = []
    const positionStates: Array<{ readonly duration: number; readonly position: number }> = []

    const volumeStates: Array<
      | { readonly kind: 'volume'; readonly value: number }
      | { readonly kind: 'muted'; readonly value: boolean }
    > = []

    let status = idleStatus
    let handlers: PlaybackCommandHandlers | null = null

    const engine: AudioEngineContract = {
      replace: (url, sourceGeneration) =>
        Effect.sync(() => {
          status = { ...status, sourceGeneration }
          calls.push(`replace:${url}`)
        }),
      clearSource: Effect.sync(() => {
        status = { ...idleStatus, sourceGeneration: null }
        calls.push('clearSource')
      }),
      play: options.rejectPlay
        ? Effect.suspend(() =>
            Effect.fail(new PlaybackRejected({ cause: new Error('play rejected in test engine') })),
          )
        : Effect.sync(() => {
            calls.push('play')
          }),
      pause: Effect.sync(() => {
        calls.push('pause')
      }),
      setVolume: (volume) =>
        Effect.sync(() => {
          volumeStates.push({ kind: 'volume', value: volume })
          calls.push(`volume:${volume}`)
        }),
      setMuted: (muted) =>
        Effect.sync(() => {
          volumeStates.push({ kind: 'muted', value: muted })
          calls.push(`muted:${muted}`)
        }),
      seekTo: (seconds) =>
        Effect.sync(() => {
          calls.push(`seek:${seconds}`)
        }),
      currentStatus: Effect.sync(() => status),
      changes: Stream.fromPubSub(pubsub),
      setNowPlaying: (metadataValue) =>
        Effect.sync(() => {
          metadata.push(metadataValue)
          calls.push(`nowPlaying:${metadataValue ? metadataValue.title : 'null'}`)
        }),
      setPositionState: (duration, position) =>
        Effect.sync(() => {
          positionStates.push({ duration, position })
        }),
      setCommandHandlers: (next) =>
        Effect.sync(() => {
          handlers = next
          calls.push(next ? 'handlers:set' : 'handlers:clear')
        }),
    }

    const emit = (next: Partial<EngineStatus>) =>
      Effect.suspend(() => {
        status = { ...status, ...next }

        return PubSub.publish(pubsub, status)
      })

    const setStatus = (next: Partial<EngineStatus>) =>
      Effect.sync(() => {
        status = { ...status, ...next }
      })

    return {
      engine,
      calls,
      metadata,
      positionStates,
      volumeStates,
      emit,
      setStatus,
      getHandlers: () => handlers,
    }
  })

const makeRecordingStorage = (
  options: {
    readonly loadQueue?: Effect.Effect<PersistedQueueType | null, AudioStorageError>
    readonly loadVolume?: Effect.Effect<VolumeRecordType | null, AudioStorageError>
    readonly saveQueue?: (queue: PersistedQueueType) => Effect.Effect<void, AudioStorageError>
    readonly saveVolume?: (volume: VolumeRecordType) => Effect.Effect<void, AudioStorageError>
    readonly positions?: ReadonlyMap<string, PositionRecord>
    readonly loadPosition?: (
      trackId: string,
    ) => Effect.Effect<PositionRecord | null, AudioStorageError>
  } = {},
) => {
  const savedQueues: Array<PersistedQueueType> = []
  const savedVolumes: Array<VolumeRecordType> = []
  const savedPositions: Array<{ readonly id: string; readonly position: number }> = []
  const clearedPositions: Array<string> = []
  const loadQueue = options.loadQueue ?? Effect.succeed(null)
  const loadVolume = options.loadVolume ?? Effect.succeed(null)
  const positions = options.positions ?? new Map<string, PositionRecord>()

  const layer = Layer.succeed(PlayerStorage, {
    loadQueue,
    saveQueue: (queue) =>
      Effect.gen(function* () {
        savedQueues.push(queue)

        if (options.saveQueue) {
          yield* options.saveQueue(queue)
        }
      }),
    loadVolume,
    saveVolume: (volume) =>
      Effect.gen(function* () {
        savedVolumes.push(volume)

        if (options.saveVolume) {
          yield* options.saveVolume(volume)
        }
      }),
    loadPosition:
      options.loadPosition ?? ((trackId) => Effect.sync(() => positions.get(trackId) ?? null)),
    savePosition: (trackId, position) =>
      Effect.sync(() => {
        savedPositions.push({ id: trackId, position })
      }),
    clearPosition: (trackId) =>
      Effect.sync(() => {
        clearedPositions.push(trackId)
      }),
    recordPlay: () => Effect.void,
    isWithinDedupWindow: () => Effect.succeed(false),
  })

  return { layer, savedQueues, savedVolumes, savedPositions, clearedPositions }
}

const makeRecordingPlayReporter = () => {
  const reported: Array<string> = []

  const layer = Layer.succeed(PlayReporter, {
    recordPlay: (trackId: string) =>
      Effect.sync(() => {
        reported.push(trackId)
      }),
  })

  return { layer, reported }
}

const makeRuntime = (
  engine: AudioEngineContract,
  storage: ReturnType<typeof makeRecordingStorage>,
  playReporter: ReturnType<typeof makeRecordingPlayReporter>,
  clock?: Layer.Layer<TestClock.TestClock>,
) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(AudioEngine, engine),
      storage.layer,
      playReporter.layer,
      clock ?? Layer.empty,
    ),
  )

const makeReporter = () => {
  const played: Array<string> = []

  const paused: Array<{
    readonly trackId: string | null
    readonly currentTime: number
    readonly duration: number
  }> = []

  const completed: Array<{ readonly trackId: string | null; readonly duration: number }> = []

  const seeks: Array<{
    readonly trackId: string | null
    readonly fromTime: number
    readonly toTime: number
    readonly method: 'scrub' | 'keyboard' | 'mediasession'
  }> = []

  const queueActions: Array<{
    readonly action: 'add' | 'remove' | 'reorder' | 'clear' | 'play_from'
    readonly trackId?: string
    readonly queueLength: number
  }> = []

  const errors: Array<{ readonly message: string; readonly error: unknown }> = []

  const reporter: AudioPlaybackReporter = {
    onTrackPlayed: (next) =>
      Effect.sync(() => {
        played.push(next.id)
      }),
    onTrackPaused: (input) =>
      Effect.sync(() => {
        paused.push(input)
      }),
    onTrackCompleted: (input) =>
      Effect.sync(() => {
        completed.push(input)
      }),
    onTrackSeek: (input) =>
      Effect.sync(() => {
        seeks.push(input)
      }),
    onQueueAction: (input) =>
      Effect.sync(() => {
        queueActions.push(input)
      }),
    onError: (message, error) =>
      Effect.sync(() => {
        errors.push({ message, error })
      }),
  }

  return { reporter, played, paused, completed, seeks, queueActions, errors }
}

describe('makeAudioPlayback', () => {
  it('keeps the latest user volume and mute changes ahead of delayed hydration', async () => {
    const hydration = Deferred.makeUnsafe<VolumeRecordType | null>()
    const storage = makeRecordingStorage({ loadVolume: Deferred.await(hydration) })
    const recording = await Effect.runPromise(makeRecordingEngine())
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime)
          yield* playback.setVolume(35)
          yield* playback.toggleMute
          expect(storage.savedVolumes).toEqual([])
          yield* Deferred.succeed(hydration, { volume: 80, isMuted: false })
          yield* Effect.yieldNow
          expect(playback.getSnapshot().volume).toEqual({ volume: 35, isMuted: true })
          expect(recording.volumeStates.slice(-2)).toEqual([
            { kind: 'volume', value: 0.35 },
            { kind: 'muted', value: true },
          ])
        }).pipe(Effect.scoped),
      )
      expect(storage.savedVolumes).toEqual([{ volume: 35, isMuted: true }])
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps unread saved queue untouched, saves explicit volume and reports failed reads', async () => {
    const queue = Deferred.makeUnsafe<PersistedQueueType | null, AudioStorageError>()
    const volume = Deferred.makeUnsafe<VolumeRecordType | null, AudioStorageError>()

    const storage = makeRecordingStorage({
      loadQueue: Deferred.await(queue),
      loadVolume: Deferred.await(volume),
    })

    const recording = await Effect.runPromise(makeRecordingEngine())
    const reporting = makeReporter()
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporting.reporter)
          yield* playback.enqueue(track('early'))
          yield* playback.setVolume(25)
          yield* Deferred.fail(queue, new AudioStorageError('read'))
          yield* Deferred.fail(volume, new AudioStorageError('read'))
          yield* Effect.yieldNow
          expect(playback.getSnapshot().queue.tracks.map(({ id }) => id)).toEqual(['early'])
          expect(playback.getSnapshot().volume).toEqual({ volume: 25, isMuted: false })
        }).pipe(Effect.scoped),
      )
      expect(storage.savedQueues).toEqual([])
      expect(storage.savedVolumes.at(-1)).toEqual({ volume: 25, isMuted: false })
      expect(reporting.errors.map(({ message }) => message).sort()).toEqual([
        'Unable to hydrate audio queue',
        'Unable to hydrate audio volume',
      ])
    } finally {
      await runtime.dispose()
    }
  })

  it('serializes each persistence stream, continues after failed writes and drains both on close', async () => {
    const queueStarted = Deferred.makeUnsafe<void>()
    const volumeStarted = Deferred.makeUnsafe<void>()
    const releaseQueue = Deferred.makeUnsafe<void>()
    const releaseVolume = Deferred.makeUnsafe<void>()
    let queueWrites = 0
    let volumeWrites = 0

    const storage = makeRecordingStorage({
      loadQueue: Effect.succeed({ tracks: [], currentIndex: -1 }),
      loadVolume: Effect.succeed({ volume: 100, isMuted: false }),
      saveQueue: () =>
        Effect.gen(function* () {
          queueWrites += 1

          if (queueWrites !== 1) return yield* Effect.void
          yield* Deferred.succeed(queueStarted, undefined)
          yield* Deferred.await(releaseQueue)

          return yield* Effect.fail(new AudioStorageError('write'))
        }),
      saveVolume: () =>
        Effect.gen(function* () {
          volumeWrites += 1

          if (volumeWrites !== 1) return yield* Effect.void
          yield* Deferred.succeed(volumeStarted, undefined)
          yield* Deferred.await(releaseVolume)

          return yield* Effect.fail(new AudioStorageError('write'))
        }),
    })

    const recording = await Effect.runPromise(makeRecordingEngine())
    const reporting = makeReporter()
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporting.reporter)
          yield* Effect.yieldNow
          yield* playback.enqueue(track('one'))
          yield* playback.enqueue(track('two'))
          yield* playback.setVolume(30)
          yield* playback.setVolume(60)
          yield* Deferred.await(queueStarted)
          yield* Deferred.await(volumeStarted)
          expect(queueWrites).toBe(1)
          expect(volumeWrites).toBe(1)
          yield* Deferred.succeed(releaseQueue, undefined)
          yield* Deferred.succeed(releaseVolume, undefined)
        }).pipe(Effect.scoped),
      )
      expect(storage.savedQueues.map(({ tracks }) => tracks.map(({ id }) => id))).toEqual([
        ['one'],
        ['one', 'two'],
      ])
      expect(storage.savedVolumes).toEqual([
        { volume: 30, isMuted: false },
        { volume: 60, isMuted: false },
      ])
      expect(queueWrites).toBe(2)
      expect(volumeWrites).toBe(2)
      expect(reporting.errors.map(({ message }) => message).sort()).toEqual([
        'Unable to persist audio queue',
        'Unable to persist audio volume',
      ])
      expect(recording.getHandlers()).toBeNull()
    } finally {
      await runtime.dispose()
    }
  })

  it('bounds shutdown queue hydration to one second and saves explicit pending volume', async () => {
    const queueStarted = Deferred.makeUnsafe<void>()
    const volumeStarted = Deferred.makeUnsafe<void>()
    const interrupted: Array<string> = []

    const pendingRead = (name: string, started: Deferred.Deferred<void>) =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted.push(name)
          }),
        ),
      )

    const storage = makeRecordingStorage({
      loadQueue: pendingRead('queue', queueStarted),
      loadVolume: pendingRead('volume', volumeStarted),
    })

    const recording = await Effect.runPromise(makeRecordingEngine())

    const runtime = makeRuntime(
      recording.engine,
      storage,
      makeRecordingPlayReporter(),
      TestClock.layer(),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()

          const playback = yield* makeAudioPlayback(runtime).pipe(
            Effect.provideService(Scope.Scope, scope),
          )

          yield* Deferred.await(queueStarted)
          yield* Deferred.await(volumeStarted)
          yield* playback.enqueue(track('buffered'))
          yield* playback.setVolume(20)
          const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
          yield* TestClock.adjust('999 millis')
          expect(closing.pollUnsafe()).toBeUndefined()
          expect(storage.savedQueues).toEqual([])
          yield* TestClock.adjust('1 millis')
          yield* Fiber.join(closing)
        }),
      )
      expect(interrupted.sort()).toEqual(['queue', 'volume'])
      expect(storage.savedQueues).toEqual([])
      expect(storage.savedVolumes).toEqual([{ volume: 20, isMuted: false }])
      expect(recording.getHandlers()).toBeNull()
    } finally {
      await runtime.dispose()
    }
  })

  it('merges a queue read completed within the shutdown deadline exactly once without restoring a source', async () => {
    const queueStarted = Deferred.makeUnsafe<void>()
    const queue = Deferred.makeUnsafe<PersistedQueueType | null>()
    const volume = Deferred.makeUnsafe<VolumeRecordType | null>()

    const storage = makeRecordingStorage({
      loadQueue: Deferred.succeed(queueStarted, undefined).pipe(
        Effect.andThen(Deferred.await(queue)),
      ),
      loadVolume: Deferred.await(volume),
    })

    const recording = await Effect.runPromise(makeRecordingEngine())

    const runtime = makeRuntime(
      recording.engine,
      storage,
      makeRecordingPlayReporter(),
      TestClock.layer(),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()

          const playback = yield* makeAudioPlayback(runtime).pipe(
            Effect.provideService(Scope.Scope, scope),
          )

          yield* Deferred.await(queueStarted)
          yield* playback.enqueue(track('new'))
          yield* playback.setVolume(35)
          yield* playback.toggleMute
          const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
          yield* TestClock.adjust('900 millis')
          expect(closing.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(queue, { tracks: [track('saved')], currentIndex: 0 })
          yield* Fiber.join(closing)
          expect(storage.savedQueues.map(({ tracks }) => tracks.map(({ id }) => id))).toEqual([
            ['saved', 'new'],
          ])
          expect(storage.savedVolumes).toEqual([{ volume: 35, isMuted: true }])
          expect(recording.calls.filter((call) => call.startsWith('replace:'))).toEqual([])
          const callsAtClose = [...recording.calls]
          yield* Deferred.succeed(volume, { volume: 80, isMuted: false })
          yield* Effect.yieldNow
          expect(recording.calls).toEqual(callsAtClose)
          expect(storage.savedVolumes).toHaveLength(1)
        }),
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('preserves the hydration grace period when the owning playback fiber is interrupted', async () => {
    const ready = Deferred.makeUnsafe<void>()
    const queue = Deferred.makeUnsafe<PersistedQueueType | null>()

    const storage = makeRecordingStorage({
      loadQueue: Deferred.await(queue),
      loadVolume: Effect.never,
    })

    const recording = await Effect.runPromise(makeRecordingEngine())

    const runtime = makeRuntime(
      recording.engine,
      storage,
      makeRecordingPlayReporter(),
      TestClock.layer(),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const owner = yield* Effect.gen(function* () {
            const playback = yield* makeAudioPlayback(runtime)
            yield* playback.enqueue(track('new'))
            yield* playback.setVolume(30)
            yield* Deferred.succeed(ready, undefined)
            yield* Effect.never
          }).pipe(Effect.scoped, Effect.forkChild)

          yield* Deferred.await(ready)
          const closing = yield* Fiber.interrupt(owner).pipe(Effect.forkChild)
          yield* TestClock.adjust('900 millis')
          expect(closing.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(queue, { tracks: [track('saved')], currentIndex: 0 })
          yield* Fiber.join(closing)
          expect(storage.savedQueues.map(({ tracks }) => tracks.map(({ id }) => id))).toEqual([
            ['saved', 'new'],
          ])
          expect(storage.savedVolumes).toEqual([{ volume: 30, isMuted: false }])
          expect(recording.calls.filter((call) => call.startsWith('replace:'))).toEqual([])
        }),
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('does not apply or persist a queue promise resolving after the shutdown deadline', async () => {
    const queueStarted = Deferred.makeUnsafe<void>()
    const queue = Promise.withResolvers<PersistedQueueType | null>()

    const storage = makeRecordingStorage({
      loadQueue: Deferred.succeed(queueStarted, undefined).pipe(
        Effect.andThen(Effect.promise(() => queue.promise)),
      ),
      loadVolume: Effect.never,
    })

    const recording = await Effect.runPromise(makeRecordingEngine())
    const reporting = makeReporter()

    const runtime = makeRuntime(
      recording.engine,
      storage,
      makeRecordingPlayReporter(),
      TestClock.layer(),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()

          const playback = yield* makeAudioPlayback(runtime, reporting.reporter).pipe(
            Effect.provideService(Scope.Scope, scope),
          )

          yield* Deferred.await(queueStarted)
          yield* playback.enqueue(track('new'))
          yield* playback.setVolume(42)
          const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
          yield* TestClock.adjust('1 second')
          yield* Fiber.join(closing)
          const callsAtClose = [...recording.calls]
          const snapshotAtClose = playback.getSnapshot()
          queue.resolve({ tracks: [track('saved')], currentIndex: 0 })
          yield* Effect.promise(() => queue.promise)
          yield* Effect.yieldNow
          expect(playback.getSnapshot()).toBe(snapshotAtClose)
          expect(recording.calls).toEqual(callsAtClose)
          expect(storage.savedQueues).toEqual([])
          expect(storage.savedVolumes).toEqual([{ volume: 42, isMuted: false }])
          expect(reporting.errors).toEqual([])
        }),
      )
    } finally {
      queue.resolve(null)
      await runtime.dispose()
    }
  })

  it.each([null, 23])(
    'does not wait for an unread queue without queue edits, pending volume: %s',
    async (volume) => {
      const queueStarted = Deferred.makeUnsafe<void>()
      const volumeStarted = Deferred.makeUnsafe<void>()

      const storage = makeRecordingStorage({
        loadQueue: Deferred.succeed(queueStarted, undefined).pipe(Effect.andThen(Effect.never)),
        loadVolume: Deferred.succeed(volumeStarted, undefined).pipe(Effect.andThen(Effect.never)),
      })

      const recording = await Effect.runPromise(makeRecordingEngine())

      const runtime = makeRuntime(
        recording.engine,
        storage,
        makeRecordingPlayReporter(),
        TestClock.layer(),
      )

      try {
        await runtime.runPromise(
          Effect.gen(function* () {
            const playback = yield* makeAudioPlayback(runtime)
            yield* Deferred.await(queueStarted)
            yield* Deferred.await(volumeStarted)

            if (volume !== null) yield* playback.setVolume(volume)
          }).pipe(Effect.scoped),
        )
        expect(storage.savedQueues).toEqual([])
        expect(storage.savedVolumes).toEqual(volume === null ? [] : [{ volume, isMuted: false }])
        expect(recording.getHandlers()).toBeNull()
      } finally {
        await runtime.dispose()
      }
    },
  )

  it('reports a queue failure during shutdown once without replacing unread saved data', async () => {
    const queueStarted = Deferred.makeUnsafe<void>()
    const queue = Deferred.makeUnsafe<PersistedQueueType | null, AudioStorageError>()

    const storage = makeRecordingStorage({
      loadQueue: Deferred.succeed(queueStarted, undefined).pipe(
        Effect.andThen(Deferred.await(queue)),
      ),
      loadVolume: Effect.never,
    })

    const recording = await Effect.runPromise(makeRecordingEngine())
    const reporting = makeReporter()

    const runtime = makeRuntime(
      recording.engine,
      storage,
      makeRecordingPlayReporter(),
      TestClock.layer(),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()

          const playback = yield* makeAudioPlayback(runtime, reporting.reporter).pipe(
            Effect.provideService(Scope.Scope, scope),
          )

          yield* Deferred.await(queueStarted)
          yield* playback.enqueue(track('new'))
          const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
          yield* TestClock.adjust('500 millis')
          yield* Deferred.fail(queue, new AudioStorageError('read'))
          yield* Fiber.join(closing)
          expect(storage.savedQueues).toEqual([])
          expect(reporting.errors.map(({ message }) => message)).toEqual([
            'Unable to hydrate audio queue',
          ])
          expect(recording.calls.filter((call) => call.startsWith('replace:'))).toEqual([])
        }),
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('owns merged persistence before source restoration finishes and cancels late engine continuation', async () => {
    const queue = Deferred.makeUnsafe<PersistedQueueType | null>()
    const statusStarted = Deferred.makeUnsafe<void>()
    const status = Promise.withResolvers<EngineStatus>()

    const storage = makeRecordingStorage({
      loadQueue: Deferred.await(queue),
      loadVolume: Effect.never,
    })

    const recording = await Effect.runPromise(makeRecordingEngine())

    const engine: AudioEngineContract = {
      ...recording.engine,
      currentStatus: Deferred.succeed(statusStarted, undefined).pipe(
        Effect.andThen(Effect.promise(() => status.promise)),
      ),
    }

    const runtime = makeRuntime(engine, storage, makeRecordingPlayReporter(), TestClock.layer())

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()

          const playback = yield* makeAudioPlayback(runtime).pipe(
            Effect.provideService(Scope.Scope, scope),
          )

          yield* playback.enqueue(track('new'))
          yield* Deferred.succeed(queue, { tracks: [track('saved')], currentIndex: 0 })
          yield* Deferred.await(statusStarted)
          yield* Scope.close(scope, Exit.void)
          const callsAtClose = [...recording.calls]
          status.resolve(idleStatus)
          yield* Effect.promise(() => status.promise)
          yield* Effect.yieldNow
          expect(recording.calls).toEqual(callsAtClose)
          expect(storage.savedQueues.map(({ tracks }) => tracks.map(({ id }) => id))).toEqual([
            ['saved', 'new'],
          ])
        }),
      )
    } finally {
      status.resolve(idleStatus)
      await runtime.dispose()
    }
  })

  it('repairs a queued track without overwriting the newly selected media metadata', async () => {
    const storage = makeRecordingStorage()
    const recording = await Effect.runPromise(makeRecordingEngine())
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime)
          yield* Effect.yieldNow
          const original = track('one')
          yield* playback.playAll([original, track('two')])
          yield* playback.playNext
          const before = [...recording.calls]
          yield* playback.repairCreators(original, [
            { id: 'creator', name: 'Creator', username: null },
          ])
          expect(playback.getSnapshot().queue.tracks[0]?.creators?.[0]?.name).toBe('Creator')
          expect(recording.calls).toEqual(before)
          expect(recording.metadata.at(-1)?.title).toBe('two')
        }).pipe(Effect.scoped),
      )
    } finally {
      await runtime.dispose()
    }
  })
  it('preserves source preparation when creators are repaired during checkpoint loading', async () => {
    const started = Deferred.makeUnsafe<void>()
    const checkpoint = Deferred.makeUnsafe<PositionRecord | null>()

    const storage = makeRecordingStorage({
      loadPosition: () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(checkpoint))),
    })

    const recording = await Effect.runPromise(makeRecordingEngine())
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime)
          yield* Effect.yieldNow
          yield* recording.setStatus({ isLoaded: true, duration: 300 })
          const original = track('one')
          const playing = yield* playback.playTrack(original).pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          yield* playback.repairCreators(original, [
            { id: 'creator', name: 'Creator', username: null },
          ])
          yield* Deferred.succeed(checkpoint, { position: 42, updatedAt: 0 })
          yield* Fiber.join(playing)
          expect(recording.calls.filter((call) => call === 'play')).toHaveLength(1)
          expect(recording.calls).toContain('seek:42')
          expect(recording.calls.filter((call) => call.startsWith('replace:'))).toHaveLength(1)
        }).pipe(Effect.scoped),
      )
    } finally {
      await runtime.dispose()
    }
  })
  it('replays an early creator repair through delayed queue hydration', async () => {
    let finishHydration: (queue: PersistedQueueType | null) => void = () => undefined

    const hydration = new Promise<PersistedQueueType | null>((resolve) => {
      finishHydration = resolve
    })

    const storage = makeRecordingStorage({ loadQueue: Effect.promise(() => hydration) })
    const recording = await Effect.runPromise(makeRecordingEngine())
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())
    const creators = [{ id: 'creator', name: 'Creator', username: null }]

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime)
          const original = track('early')
          yield* playback.playTrack(original)
          yield* playback.repairCreators(original, creators)
          finishHydration({ tracks: [track('stored')], currentIndex: 0 })
          yield* Effect.promise(() => hydration)
          yield* Effect.yieldNow
          expect(playback.getSnapshot().queue.current?.creators).toEqual(creators)
        }).pipe(Effect.scoped),
      )
      expect(storage.savedQueues.at(-1)?.tracks[0]?.creators).toEqual(creators)
    } finally {
      await runtime.dispose()
    }
  })
  it('repairs creators, persists the queue and updates media metadata without reloading audio', async () => {
    const storage = makeRecordingStorage()
    const recording = await Effect.runPromise(makeRecordingEngine())
    const runtime = makeRuntime(recording.engine, storage, makeRecordingPlayReporter())
    const creators = [{ id: 'creator', name: 'Fixture Creator', username: 'fixture' }]

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime)
          yield* Effect.yieldNow
          const original = track('one')
          yield* playback.playTrack(original)
          const before = [...recording.calls]
          yield* playback.repairCreators(original, creators)
          expect(playback.getSnapshot().queue.current?.creators).toEqual(creators)
          expect(recording.calls.slice(before.length)).toEqual(['nowPlaying:one'])
          expect(recording.metadata.at(-1)?.artist).toBe('Fixture Creator')
        }).pipe(Effect.scoped),
      )
      expect(storage.savedQueues.at(-1)?.tracks[0]?.creators).toEqual(creators)
    } finally {
      await runtime.dispose()
    }
  })
  it.each([true, false])(
    'honors live preferences for restore and automatic advance: %s',
    async (enabled) => {
      const storage = makeRecordingStorage({
        positions: new Map([['one', { position: 42, updatedAt: 0 }]]),
      })

      const { reporter } = makeReporter()
      const { engine, calls, setStatus, emit } = await Effect.runPromise(makeRecordingEngine())
      const playReporter = makeRecordingPlayReporter()
      const runtime = makeRuntime(engine, storage, playReporter)
      let preferences = { continueQueue: !enabled, restorePosition: !enabled }

      try {
        await runtime.runPromise(
          Effect.gen(function* () {
            const playback = yield* makeAudioPlayback(runtime, reporter, () => preferences)
            yield* Effect.yieldNow
            preferences = { continueQueue: enabled, restorePosition: enabled }
            yield* setStatus({ isLoaded: true, duration: 300 })
            yield* playback.playAll([track('one'), track('two')])
            yield* Effect.yieldNow
            expect(calls.includes('seek:42')).toBe(enabled)
            yield* emit({ didJustFinish: true, playing: false, currentTime: 300 })
            yield* Effect.yieldNow
            expect(playback.getSnapshot().queue.current?.id).toBe(enabled ? 'two' : 'one')

            if (!enabled) {
              yield* playback.playNext
              expect(playback.getSnapshot().queue.current?.id).toBe('two')
            }
          }).pipe(Effect.scoped),
        )
      } finally {
        await runtime.dispose()
      }
    },
  )

  it('replays early queue changes after hydration without losing them', async () => {
    let resolveQueue!: (queue: PersistedQueueType | null) => void

    const queuePromise = new Promise<PersistedQueueType | null>((resolve) => {
      resolveQueue = resolve
    })

    const storage = makeRecordingStorage({ loadQueue: Effect.promise(() => queuePromise) })
    const { reporter } = makeReporter()
    const { engine } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          const snapshots: Array<PlaybackSnapshot> = []
          const unsubscribe = playback.subscribeSnapshot((snapshot) => snapshots.push(snapshot))
          yield* playback.enqueue(track('early'))
          yield* Effect.yieldNow
          resolveQueue({ tracks: [track('stored')], currentIndex: 0 })
          yield* Effect.promise(() => Promise.resolve())
          yield* Effect.promise(() => Promise.resolve())
          unsubscribe()

          return { snapshots, current: playback.getSnapshot() }
        }).pipe(Effect.scoped),
      )

      expect(result.snapshots.at(-1)?.queue.tracks.map(({ id }) => id)).toEqual(['stored', 'early'])
      expect(result.current.queue.tracks.map(({ id }) => id)).toEqual(['stored', 'early'])
      expect(storage.savedQueues.at(-1)?.tracks.map(({ id }) => id)).toEqual(['stored', 'early'])
    } finally {
      await runtime.dispose()
    }
  })

  it('restores a stored position before starting playback', async () => {
    const storage = makeRecordingStorage({
      positions: new Map([[track('mix-1').id, { position: 42, updatedAt: 0 }]]),
    })

    const { reporter, played } = makeReporter()

    const { engine, calls, positionStates, setStatus } =
      await Effect.runPromise(makeRecordingEngine())

    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          const snapshots: Array<PlaybackSnapshot> = []
          const unsubscribe = playback.subscribeSnapshot((snapshot) => snapshots.push(snapshot))
          yield* setStatus({ isLoaded: true, duration: 300 })
          yield* playback.playTrack(track('mix-1'))
          yield* Effect.yieldNow
          yield* Effect.yieldNow
          unsubscribe()

          return { playback, snapshots }
        }).pipe(Effect.scoped),
      )

      expect(calls).toContain('seek:42')
      expect(calls.indexOf('seek:42')).toBeLessThan(calls.indexOf('play'))
      expect(played).toEqual(['mix-1'])
      expect(playReporter.reported).toEqual(['mix-1'])
      expect(positionStates.length).toBeGreaterThan(0)
      expect(result.playback.getSnapshot().queue.current?.id).toBe('mix-1')
      expect(result.snapshots.at(-1)?.queue.current?.id).toBe('mix-1')
    } finally {
      await runtime.dispose()
    }
  })

  it('applies volume and mute to the engine', async () => {
    const storage = makeRecordingStorage()
    const { reporter } = makeReporter()
    const { engine, volumeStates } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* Effect.yieldNow
          yield* Effect.yieldNow
          yield* playback.setVolume(40)
          yield* playback.toggleMute
        }).pipe(Effect.scoped),
      )

      expect(volumeStates.some((entry) => entry.kind === 'volume' && entry.value === 0.4)).toBe(
        true,
      )
      expect(volumeStates.at(-1)).toEqual({ kind: 'muted', value: true })
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps played analytics successful-only when playback is rejected', async () => {
    const storage = makeRecordingStorage()
    const { reporter, played, errors } = makeReporter()
    const { engine, setStatus } = await Effect.runPromise(makeRecordingEngine({ rejectPlay: true }))
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* Effect.yieldNow
          yield* setStatus({ isLoaded: true, duration: 300 })
          yield* playback.playTrack(track('one'))
          yield* Effect.yieldNow
          yield* Effect.yieldNow
        }).pipe(Effect.scoped),
      )

      expect(played).toEqual([])
      expect(playReporter.reported).toEqual([])
      expect(errors.some((entry) => entry.message === 'Playback was refused by the platform')).toBe(
        true,
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('no-ops playPrevious when no queue item is selected', async () => {
    const storage = makeRecordingStorage({
      loadQueue: Effect.succeed({ tracks: [track('one'), track('two')], currentIndex: -1 }),
    })

    const { reporter } = makeReporter()
    const { engine, calls } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* Effect.yieldNow
          yield* Effect.yieldNow
          const before = calls.length
          yield* playback.playPrevious
          yield* Effect.yieldNow

          return { before, after: calls.length }
        }).pipe(Effect.scoped),
      )

      expect(result.after).toBe(result.before)
    } finally {
      await runtime.dispose()
    }
  })

  it('flushes queued queue and volume saves before teardown finishes', async () => {
    let resolveQueue!: () => void
    let resolveVolume!: () => void

    const queueTail = new Promise<void>((resolve) => {
      resolveQueue = resolve
    })

    const volumeTail = new Promise<void>((resolve) => {
      resolveVolume = resolve
    })

    const storage = makeRecordingStorage({
      saveQueue: () => Effect.promise(() => queueTail),
      saveVolume: () => Effect.promise(() => volumeTail),
    })

    const { reporter } = makeReporter()
    const { engine } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      let settled = false

      const program = runtime
        .runPromise(
          Effect.gen(function* () {
            const playback = yield* makeAudioPlayback(runtime, reporter)
            yield* Effect.yieldNow
            yield* Effect.yieldNow
            yield* playback.enqueue(track('one'))
            yield* playback.setVolume(55)
          }).pipe(Effect.scoped),
        )
        .then(() => {
          settled = true
        })

      await Promise.resolve()
      await Promise.resolve()
      expect(settled).toBe(false)

      resolveQueue()
      resolveVolume()
      await program

      expect(storage.savedQueues.at(-1)?.tracks.map(({ id }) => id)).toEqual(['one'])
      expect(storage.savedVolumes.at(-1)).toEqual({ volume: 55, isMuted: false })
    } finally {
      await runtime.dispose()
    }
  })

  it('reports pause and seek intents through the shared reporter', async () => {
    const storage = makeRecordingStorage()
    const { reporter, paused, seeks } = makeReporter()
    const { engine, calls, setStatus } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* setStatus({ isLoaded: true, duration: 300 })
          yield* playback.playTrack(track('one'))

          for (let i = 0; i < 5 && playReporter.reported.length === 0; i += 1) {
            yield* Effect.promise(() => Promise.resolve())
          }

          yield* playback.seekTo(12)
          yield* Effect.yieldNow
          yield* playback.pause
          yield* Effect.yieldNow
        }).pipe(Effect.scoped),
      )

      expect(calls).toContain('seek:12')
      expect(calls).toContain('pause')
      expect(seeks).toEqual([{ trackId: 'one', fromTime: 0, toTime: 12, method: 'scrub' }])
      expect(paused).toEqual([{ trackId: 'one', title: 'one', currentTime: 0, duration: 300 }])
      expect(playReporter.reported).toEqual(['one'])
    } finally {
      await runtime.dispose()
    }
  })

  it('routes media session next-track commands through the same queue path as UI actions', async () => {
    const storage = makeRecordingStorage()
    const { reporter } = makeReporter()
    const { engine, setStatus, getHandlers } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* setStatus({ isLoaded: true, duration: 300 })
          yield* playback.playAll([track('one'), track('two')])
          yield* Effect.yieldNow
          const handlers = getHandlers()
          expect(handlers).not.toBeNull()
          handlers?.onNextTrack()
          yield* Effect.yieldNow

          return playback.getSnapshot()
        }).pipe(Effect.scoped),
      )

      expect(result.queue.current?.id).toBe('two')
      expect(playReporter.reported).toEqual(['one', 'two'])
    } finally {
      await runtime.dispose()
    }
  })

  it('advances playback when the currently playing queue item is removed', async () => {
    const storage = makeRecordingStorage()
    const { reporter } = makeReporter()
    const { engine, setStatus } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* setStatus({ isLoaded: true, duration: 300 })
          yield* playback.playAll([track('one'), track('two')])
          yield* Effect.yieldNow
          yield* playback.removeFromQueue(0)
          yield* Effect.yieldNow

          return playback.getSnapshot()
        }).pipe(Effect.scoped),
      )

      expect(result.queue.current?.id).toBe('two')
      expect(result.queue.tracks.map(({ id }) => id)).toEqual(['two'])
      expect(playReporter.reported).toEqual(['one', 'two'])
    } finally {
      await runtime.dispose()
    }
  })

  it('does not restart the active source when queue hydration catches up', async () => {
    let resolveQueue!: (queue: PersistedQueueType | null) => void

    const queuePromise = new Promise<PersistedQueueType | null>((resolve) => {
      resolveQueue = resolve
    })

    const storage = makeRecordingStorage({ loadQueue: Effect.promise(() => queuePromise) })
    const { reporter } = makeReporter()
    const { engine, calls, setStatus } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* setStatus({ isLoaded: true, duration: 300 })
          yield* playback.playTrack(track('early'))
          yield* Effect.yieldNow
          resolveQueue({ tracks: [track('stored')], currentIndex: 0 })
          yield* Effect.promise(() => Promise.resolve())
          yield* Effect.promise(() => Promise.resolve())
        }).pipe(Effect.scoped),
      )

      expect(calls.filter((call) => call === 'replace:https://cdn.example/early.mp3')).toHaveLength(
        1,
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps queue boundaries and invalid-duration percentage seeks as no-ops', async () => {
    const storage = makeRecordingStorage()
    const { reporter } = makeReporter()
    const { engine, calls } = await Effect.runPromise(makeRecordingEngine())
    const playReporter = makeRecordingPlayReporter()
    const runtime = makeRuntime(engine, storage, playReporter)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(runtime, reporter)
          yield* playback.playAll([track('one')])
          yield* Effect.yieldNow
          const before = calls.length
          yield* playback.playNext
          yield* playback.seekByPercentage(50)
          expect(calls).toHaveLength(before)
        }).pipe(Effect.scoped),
      )
    } finally {
      await runtime.dispose()
    }
  })
})
