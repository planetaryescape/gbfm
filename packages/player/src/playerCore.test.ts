/* oxlint-disable effecttsgo/strict-effect-provide -- Each test invokes Effect.runPromise, making it an Effect application entry point. */
import { Deferred, Effect, Fiber, Layer, PubSub, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  AudioEngine,
  PlaybackRejected,
  type AudioEngineContract,
  type EngineStatus,
} from './engine'
import type { QueueTrackType } from './persistedQueue'
import { makePlayerCore } from './playerCore'
import { PlayerStorage, type PositionRecord } from './playerStorage'
import { PlayReporter } from './playReporter'

const track: QueueTrackType = {
  id: 'track-1',
  title: 'Test Mix',
  slug: 'test-mix',
  url: 'https://cdn.example/test.mp3',
  thumbnailUrl: null,
  type: 'mix',
  creators: [{ id: 'c1', name: 'Tester', username: 'tester' }],
}

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
    let status = idleStatus

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
        ? Effect.suspend(() => {
            calls.push('play:rejected')

            return Effect.fail(new PlaybackRejected({}))
          })
        : Effect.sync(() => {
            calls.push('play')
          }),
      pause: Effect.sync(() => {
        calls.push('pause')
      }),
      setVolume: (volume) =>
        Effect.sync(() => {
          calls.push(`volume:${volume}`)
        }),
      setMuted: (muted) =>
        Effect.sync(() => {
          calls.push(`muted:${muted}`)
        }),
      seekTo: (seconds) =>
        Effect.sync(() => {
          calls.push(`seek:${seconds}`)
        }),
      currentStatus: Effect.sync(() => status),
      changes: Stream.fromPubSub(pubsub),
      setNowPlaying: (metadata) =>
        Effect.sync(() => {
          calls.push(`nowPlaying:${metadata ? metadata.title : 'null'}`)
        }),
      setPositionState: () => Effect.void,
      setCommandHandlers: () => Effect.void,
    }

    const emit = (next: Partial<EngineStatus>) =>
      Effect.suspend(() => {
        status = { ...status, ...next }

        return PubSub.publish(pubsub, status)
      })

    /** Updates what the engine reports without publishing, modelling a source
     *  that became ready before the core read its status. */
    const setStatus = (next: Partial<EngineStatus>) =>
      Effect.sync(() => {
        status = { ...status, ...next }
      })

    return { engine, calls, emit, setStatus }
  })

const makeRecordingStorage = (
  stored: PositionRecord | null = null,
  loadPosition = (_id: string): Effect.Effect<PositionRecord | null> => Effect.succeed(stored),
) => {
  const saved: Array<{ readonly id: string; readonly position: number }> = []
  const cleared: Array<string> = []

  const layer = Layer.succeed(PlayerStorage, {
    loadQueue: Effect.succeed(null),
    saveQueue: () => Effect.void,
    loadVolume: Effect.succeed(null),
    saveVolume: () => Effect.void,
    loadPosition,
    savePosition: (id: string, position: number) =>
      Effect.sync(() => {
        saved.push({ id, position })
      }),
    clearPosition: (id: string) =>
      Effect.sync(() => {
        cleared.push(id)
      }),
    recordPlay: () => Effect.void,
    isWithinDedupWindow: () => Effect.succeed(false),
  })

  return { layer, saved, cleared }
}

const makeRecordingReporter = () => {
  const reported: Array<string> = []

  const layer = Layer.succeed(PlayReporter, {
    recordPlay: (trackId: string) =>
      Effect.sync(() => {
        reported.push(trackId)
      }),
  })

  return { layer, reported }
}

describe('makePlayerCore', () => {
  it('keeps pause intent when a source becomes ready after the pause', async () => {
    await Effect.gen(function* () {
      const recording = yield* makeRecordingEngine()
      const storage = makeRecordingStorage({ position: 42, updatedAt: 0 })
      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({ onStatus: () => {}, onTrackFinished: () => {} }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AudioEngine, recording.engine),
            storage.layer,
            reporter.layer,
          ),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* core.setSource(track)
      yield* core.pause
      yield* Effect.yieldNow
      yield* recording.emit({ isLoaded: true, duration: 300 })
      yield* Effect.yieldNow
      expect(recording.calls).toContain('seek:42')
      expect(recording.calls).not.toContain('play')
      expect(yield* core.isDesiredPlaying).toBe(false)
      expect(reporter.reported).toEqual([])
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  it('ignores a replaced session checkpoint even when its read finishes last', async () => {
    await Effect.gen(function* () {
      const checkpoint = yield* Deferred.make<PositionRecord | null>()
      const reading = yield* Deferred.make<void>()
      const recording = yield* makeRecordingEngine()

      const storage = makeRecordingStorage(null, (id) =>
        id === track.id
          ? Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(checkpoint)))
          : Effect.succeed({ position: 17, updatedAt: 0 }),
      )

      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({ onStatus: () => {}, onTrackFinished: () => {} }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AudioEngine, recording.engine),
            storage.layer,
            reporter.layer,
          ),
        ),
      )

      yield* recording.setStatus({ isLoaded: true, duration: 300 })
      yield* core.requestPlayOnReady(track.id)
      const first = yield* core.setSource(track).pipe(Effect.forkScoped)
      yield* Deferred.await(reading)

      const replacement = {
        ...track,
        id: 'replacement',
        url: 'https://cdn.example/replacement.mp3',
      }

      yield* core.requestPlayOnReady(replacement.id)
      yield* core.setSource(replacement)
      yield* Deferred.succeed(checkpoint, { position: 42, updatedAt: 0 })
      yield* Fiber.join(first)
      yield* Effect.yieldNow
      expect(yield* core.currentTrackId).toBe(replacement.id)
      expect(recording.calls).toContain('seek:17')
      expect(recording.calls).not.toContain('seek:42')
      expect(recording.calls.filter((call) => call === 'play')).toHaveLength(1)
      expect(reporter.reported).toEqual([replacement.id])
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  it('handles completion once per playback, re-arms on status, and restarts explicit replay', async () => {
    await Effect.gen(function* () {
      const recording = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()
      let finished = 0

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {
          finished += 1
        },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AudioEngine, recording.engine),
            storage.layer,
            reporter.layer,
          ),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      // Unloaded statuses are ignored; the refused-playback test covers the started gate.
      yield* recording.setStatus({ isLoaded: false, duration: 0, didJustFinish: true })
      yield* core.setSource(track)
      yield* Effect.yieldNow
      expect(finished).toBe(0)
      expect(storage.cleared).toEqual([])

      yield* recording.emit({ isLoaded: true, duration: 300, didJustFinish: false })
      yield* Effect.yieldNow
      expect(finished).toBe(0)
      expect(recording.calls.filter((call) => call === 'play')).toHaveLength(1)

      yield* recording.emit({ didJustFinish: true, playing: false })
      yield* Effect.yieldNow
      expect(finished).toBe(1)
      expect(storage.cleared).toEqual([track.id])
      expect(yield* core.isDesiredPlaying).toBe(false)
      yield* recording.emit({ didJustFinish: true, playing: false })
      yield* Effect.yieldNow
      expect(finished).toBe(1)
      expect(storage.cleared).toEqual([track.id])

      // A platform-originated replay re-arms completion without a UI play command.
      yield* recording.emit({ didJustFinish: false, playing: true })
      yield* Effect.yieldNow
      yield* recording.emit({ didJustFinish: true, playing: false })
      yield* Effect.yieldNow
      expect(finished).toBe(2)
      expect(storage.cleared).toEqual([track.id, track.id])

      yield* core.play(track.id)
      yield* recording.emit({ didJustFinish: false, playing: true })
      yield* Effect.yieldNow
      yield* recording.emit({ didJustFinish: true, playing: false })
      yield* recording.emit({ didJustFinish: true, playing: false })
      yield* Effect.yieldNow
      expect(recording.calls).toContain('seek:0')
      expect(recording.calls.filter((call) => call === 'play')).toHaveLength(2)
      expect(finished).toBe(3)
      expect(storage.cleared).toEqual([track.id, track.id, track.id])
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  it('restores the position when a cached source reports loaded before its duration', async () => {
    const program = Effect.gen(function* () {
      const { engine, calls, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage({ position: 42, updatedAt: 0 })
      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {},
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      // Safari serves a cached source as readyState >= 1 with duration NaN,
      // which the engine reports as 0 until durationchange lands.
      yield* setStatus({ isLoaded: true, duration: 0 })
      yield* core.setSource(track)
      yield* Effect.yieldNow

      const beforeDuration = [...calls]

      yield* emit({ isLoaded: true, duration: 300 })
      yield* Effect.yieldNow

      return { beforeDuration, calls }
    }).pipe(Effect.scoped)

    const { beforeDuration, calls } = await Effect.runPromise(program)

    expect(beforeDuration).not.toContain('play')
    expect(calls).toContain('seek:42')
    expect(calls.indexOf('seek:42')).toBeLessThan(calls.indexOf('play'))
  })

  it('waits for a cold source to become usable before starting playback', async () => {
    const program = Effect.gen(function* () {
      const { engine, calls, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {},
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* setStatus({ isLoaded: false, duration: 0 })
      yield* core.setSource(track)
      yield* Effect.yieldNow

      const beforeLoad = [...calls]
      expect(storage.saved).toEqual([])

      yield* emit({ isLoaded: true, duration: 300 })
      yield* emit({ isLoaded: true, duration: 300 })
      yield* Effect.yieldNow

      return { beforeLoad, calls }
    }).pipe(Effect.scoped)

    const { beforeLoad, calls } = await Effect.runPromise(program)

    expect(beforeLoad).not.toContain('play')
    expect(calls.filter((call) => call === 'play')).toHaveLength(1)
  })

  it('keeps rapid pause commands ahead of delayed play status', async () => {
    const program = Effect.gen(function* () {
      const { engine, calls, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {},
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* setStatus({ isLoaded: true, duration: 300 })
      yield* core.setSource(track)
      yield* Effect.yieldNow
      yield* core.pause
      yield* emit({ playing: true, currentTime: 1 })
      yield* Effect.yieldNow

      return { calls, desired: yield* core.isDesiredPlaying }
    }).pipe(Effect.scoped)

    const { calls, desired } = await Effect.runPromise(program)

    expect(calls.filter((call) => call === 'play')).toHaveLength(1)
    expect(calls).toContain('pause')
    expect(desired).toBe(false)
  })

  it('does not re-arm or finish a detached source after completion', async () => {
    const program = Effect.gen(function* () {
      const { engine, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()
      let finished = 0

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {
          finished += 1
        },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* setStatus({ isLoaded: true, duration: 300 })
      yield* core.setSource(track)
      yield* Effect.yieldNow
      yield* emit({ didJustFinish: true, playing: false })
      yield* Effect.yieldNow

      const afterFirstFinish = { finished, cleared: [...storage.cleared] }
      yield* core.detachCurrentSource
      yield* emit({ playing: true, didJustFinish: false })
      yield* Effect.yieldNow
      yield* emit({ playing: false, didJustFinish: true })
      yield* Effect.yieldNow

      return { afterFirstFinish, finished, cleared: storage.cleared }
    }).pipe(Effect.scoped)

    const { afterFirstFinish, finished, cleared } = await Effect.runPromise(program)

    expect(afterFirstFinish).toEqual({ finished: 1, cleared: [track.id] })
    expect(finished).toBe(1)
    expect(cleared).toEqual([track.id])
  })

  it('persists forward progress and backward seeks while suppressing sub-second jitter', async () => {
    const program = Effect.gen(function* () {
      const { engine, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {},
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* setStatus({ isLoaded: true, duration: 300, currentTime: 120 })
      yield* core.setSource(track)
      yield* Effect.yieldNow
      yield* emit({ playing: true, currentTime: 150 })
      yield* Effect.yieldNow
      yield* emit({ currentTime: 30 })
      yield* Effect.yieldNow
      yield* emit({ currentTime: 30.5 })
      yield* Effect.yieldNow

      return storage.saved
    }).pipe(Effect.scoped)

    const saved = await Effect.runPromise(program)

    expect(saved).toEqual([
      { id: track.id, position: 120 },
      { id: track.id, position: 150 },
      { id: track.id, position: 30 },
    ])
  })

  it('does not seek when the stored position is near the end', async () => {
    const program = Effect.gen(function* () {
      const { engine, calls, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage({ position: 298, updatedAt: 0 })
      const reporter = makeRecordingReporter()

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {},
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* setStatus({ isLoaded: true, duration: 300 })
      yield* core.setSource(track)
      yield* Effect.yieldNow

      return calls
    }).pipe(Effect.scoped)

    const calls = await Effect.runPromise(program)
    expect(calls.some((call) => call.startsWith('seek:'))).toBe(false)
    expect(calls).toContain('play')
  })

  it('does not arm completion or report a play when the platform refuses playback', async () => {
    const program = Effect.gen(function* () {
      const { engine, emit, setStatus } = yield* makeRecordingEngine({ rejectPlay: true })
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()
      const errors: Array<string> = []
      let finished = 0

      const core = yield* makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {
          finished += 1
        },
        onError: (message) => errors.push(message),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* core.requestPlayOnReady(track.id)
      yield* setStatus({ isLoaded: true, duration: 300 })
      yield* core.setSource(track)
      yield* Effect.yieldNow
      yield* emit({ didJustFinish: true, playing: false })
      yield* Effect.yieldNow

      return {
        reported: reporter.reported,
        desired: yield* core.isDesiredPlaying,
        errors,
        finished,
      }
    }).pipe(Effect.scoped)

    const { reported, desired, errors, finished } = await Effect.runPromise(program)

    expect(reported).toEqual([])
    expect(desired).toBe(false)
    expect(finished).toBe(0)
    expect(errors).toContain('Playback was refused by the platform')
  })

  it('ignores delayed statuses from the previous source', async () => {
    const nextTrack: QueueTrackType = {
      ...track,
      id: 'track-2',
      url: 'https://cdn.example/next.mp3',
    }

    const program = Effect.gen(function* () {
      const { engine, calls, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()
      const observed: Array<EngineStatus> = []
      let finished = 0

      const core = yield* makePlayerCore({
        onStatus: (status) => observed.push(status),
        onTrackFinished: () => {
          finished += 1
        },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* setStatus({ isLoaded: true, duration: 300 })
      yield* core.setSource(track)
      yield* setStatus({ isLoaded: false, duration: 0 })
      yield* core.requestPlayOnReady(nextTrack.id)
      yield* core.setSource(nextTrack)
      const callsBeforeStaleStatus = calls.length

      yield* emit({
        sourceGeneration: 1,
        isLoaded: true,
        duration: 300,
        playing: false,
        didJustFinish: true,
      })
      yield* Effect.yieldNow

      const callsAfterStaleStatus = calls.length
      yield* emit({
        sourceGeneration: 2,
        isLoaded: true,
        duration: 300,
        didJustFinish: false,
      })
      yield* Effect.yieldNow

      return {
        calls,
        callsBeforeStaleStatus,
        callsAfterStaleStatus,
        finished,
        observed,
        trackId: yield* core.currentTrackId,
      }
    }).pipe(Effect.scoped)

    const result = await Effect.runPromise(program)

    expect(result.callsAfterStaleStatus).toBe(result.callsBeforeStaleStatus)
    expect(
      result.observed.some((status) => status.sourceGeneration === 1 && status.didJustFinish),
    ).toBe(false)
    expect(result.calls).toContain('play')
    expect(result.finished).toBe(0)
    expect(result.trackId).toBe(nextTrack.id)
  })

  it('clears the source in order and ignores its late non-null statuses', async () => {
    const program = Effect.gen(function* () {
      const { engine, calls, emit, setStatus } = yield* makeRecordingEngine()
      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()
      const observed: Array<EngineStatus> = []
      let finished = 0

      const core = yield* makePlayerCore({
        onStatus: (status) => observed.push(status),
        onTrackFinished: () => {
          finished += 1
        },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* setStatus({ isLoaded: true, duration: 300 })
      yield* core.setSource(track)
      yield* Effect.yieldNow
      const beforeClear = calls.length
      yield* core.setSource(null)
      yield* Effect.yieldNow
      expect(yield* core.currentTrackId).toBeNull()
      expect(calls.slice(beforeClear)).toEqual(['pause', 'clearSource', 'nowPlaying:null'])
      const beforeLateStatus = observed.length

      yield* emit({
        sourceGeneration: 1,
        isLoaded: true,
        duration: 300,
        playing: false,
        didJustFinish: true,
      })
      yield* Effect.yieldNow

      return {
        observed,
        beforeLateStatus,
        afterLateStatus: observed.length,
        finished,
        trackId: yield* core.currentTrackId,
      }
    }).pipe(Effect.scoped)

    const result = await Effect.runPromise(program)

    expect(result.trackId).toBeNull()
    expect(result.afterLateStatus).toBe(result.beforeLateStatus)
    expect(
      result.observed
        .slice(result.beforeLateStatus)
        .some((status) => status.sourceGeneration === 1),
    ).toBe(false)
    expect(result.finished).toBe(0)
  })

  it('interrupts the status fiber when the enclosing scope closes', async () => {
    let finalized = false
    let callbacksAfterDispose = 0

    const program = Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<EngineStatus>()
      let status = idleStatus

      const engine: AudioEngineContract = {
        replace: (_url, sourceGeneration) =>
          Effect.sync(() => {
            status = { ...status, sourceGeneration }
          }),
        clearSource: Effect.sync(() => {
          status = { ...idleStatus, sourceGeneration: null }
        }),
        play: Effect.void,
        pause: Effect.void,
        setVolume: () => Effect.void,
        setMuted: () => Effect.void,
        seekTo: () => Effect.void,
        currentStatus: Effect.sync(() => status),
        changes: Stream.fromPubSub(pubsub).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              finalized = true
            }),
          ),
        ),
        setNowPlaying: () => Effect.void,
        setPositionState: () => Effect.void,
        setCommandHandlers: () => Effect.void,
      }

      const storage = makeRecordingStorage()
      const reporter = makeRecordingReporter()

      yield* makePlayerCore({
        onStatus: () => {
          callbacksAfterDispose += 1
        },
        onTrackFinished: () => {},
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(AudioEngine, engine), storage.layer, reporter.layer),
        ),
      )

      yield* PubSub.publish(pubsub, {
        ...idleStatus,
        sourceGeneration: 1,
        isLoaded: true,
        duration: 300,
      })
      yield* Effect.yieldNow

      return pubsub
    }).pipe(Effect.scoped)

    const pubsub = await Effect.runPromise(program)

    expect(finalized).toBe(true)

    const before = callbacksAfterDispose
    await Effect.runPromise(PubSub.publish(pubsub, { ...idleStatus, isLoaded: true, duration: 1 }))
    await Effect.runPromise(Effect.yieldNow)
    expect(callbacksAfterDispose).toBe(before)
  })
})
