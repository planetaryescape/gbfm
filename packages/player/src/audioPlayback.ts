import { Cause, Data, Effect, Exit, Fiber, Option } from 'effect'
import type { ManagedRuntime } from 'effect'
import type { Scope } from 'effect/Scope'

import type { VolumeRecordType } from './audioStorage'
import { AudioEngine, type EngineStatus } from './engine'
import {
  hasCompleteCreators,
  type AudioStorageError,
  type PersistedQueueType,
  type QueueTrackType,
} from './persistedQueue'
import { playerCore } from './playerCore'
import { PlayerStorage } from './playerStorage'
import type { PlayReporter } from './playReporter'
import { defaultPlayerPreferences, type PlayerPreferences } from './preferences'
import {
  initialQueueState,
  mergeHydratedQueue,
  QueueAction,
  reduceQueue,
  type QueueAction as QueueActionType,
} from './queueState'

export const selectQueueView = (state: typeof initialQueueState) => ({
  tracks: state.tracks,
  currentIndex: state.currentIndex,
  current: state.currentIndex >= 0 ? (state.tracks[state.currentIndex] ?? null) : null,
})

export type QueueView = ReturnType<typeof selectQueueView>

export type PlaybackTransportSnapshot = {
  readonly isInitialized: boolean
  readonly isLoaded: boolean
  readonly isPlaying: boolean
  readonly isBuffering: boolean
  readonly currentTime: number
  readonly duration: number
}

export type PlaybackSnapshot = {
  readonly queue: QueueView
  readonly transport: PlaybackTransportSnapshot
  readonly volume: VolumeRecordType
}

export type AudioPlaybackReporter = {
  readonly onTrackPlayed?: (track: QueueTrackType) => Effect.Effect<void>
  readonly onTrackPaused?: (input: {
    readonly trackId: string | null
    readonly title: string
    readonly currentTime: number
    readonly duration: number
  }) => Effect.Effect<void>
  readonly onTrackCompleted?: (input: {
    readonly trackId: string | null
    readonly title: string
    readonly duration: number
  }) => Effect.Effect<void>
  readonly onTrackSeek?: (input: {
    readonly trackId: string | null
    readonly fromTime: number
    readonly toTime: number
    readonly method: 'scrub' | 'keyboard' | 'mediasession'
  }) => Effect.Effect<void>
  readonly onQueueAction?: (input: {
    readonly action: 'add' | 'remove' | 'reorder' | 'clear' | 'play_from'
    readonly trackId?: string
    readonly queueLength: number
  }) => Effect.Effect<void>
  readonly onError?: (message: string, error: Error) => Effect.Effect<void>
}

export type AudioPlaybackCallbacks = AudioPlaybackReporter

type PlaybackRuntime = Pick<
  ManagedRuntime.ManagedRuntime<AudioEngine | PlayerStorage | PlayReporter, never>,
  'runFork' | 'runPromise'
>

type SnapshotListener = (snapshot: PlaybackSnapshot) => void

const initialTransport: PlaybackTransportSnapshot = {
  isInitialized: false,
  isLoaded: false,
  isPlaying: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
}

const defaultVolume: VolumeRecordType = { volume: 100, isMuted: false }

type QueueHydration =
  | { readonly _tag: 'Hydrating'; readonly pending: Array<QueueActionType> }
  | { readonly _tag: 'Hydrated' }

const QueueHydration = Data.taggedEnum<QueueHydration>()

type VolumeHydration =
  | { readonly _tag: 'Hydrating'; pending: VolumeRecordType | null }
  | { readonly _tag: 'Hydrated' }

const VolumeHydration = Data.taggedEnum<VolumeHydration>()

const noopReporter: Required<AudioPlaybackReporter> = {
  onTrackPlayed: () => Effect.void,
  onTrackPaused: () => Effect.void,
  onTrackCompleted: () => Effect.void,
  onTrackSeek: () => Effect.void,
  onQueueAction: () => Effect.void,
  onError: () => Effect.void,
}

const buildSnapshot = (
  queue: typeof initialQueueState,
  transport: PlaybackTransportSnapshot,
  volume: VolumeRecordType,
): PlaybackSnapshot => ({
  queue: selectQueueView(queue),
  transport,
  volume,
})

const queueLength = (state: typeof initialQueueState) => state.tracks.length

const queueTrackInfo = (track: QueueTrackType | null) => ({
  trackId: track?.id ?? null,
  title: track?.title ?? 'unknown',
})

const playAllUnique = (tracks: ReadonlyArray<QueueTrackType>) => {
  const ids = new Set<string>()

  return tracks.filter((track) => {
    if (ids.has(track.id)) return false
    ids.add(track.id)

    return true
  })
}

const trackFromQueueIndex = (state: typeof initialQueueState, index: number) =>
  state.tracks[index] ?? null

const currentTrack = (state: typeof initialQueueState) => selectQueueView(state).current

export interface AudioPlaybackController {
  readonly repairCreators: (
    original: QueueTrackType,
    creators: NonNullable<QueueTrackType['creators']>,
  ) => Effect.Effect<void>
  readonly getSnapshot: () => PlaybackSnapshot
  readonly subscribeSnapshot: (listener: SnapshotListener) => () => void
  readonly play: Effect.Effect<void>
  readonly pause: Effect.Effect<void>
  readonly togglePlayPause: Effect.Effect<void>
  readonly seekTo: (seconds: number) => Effect.Effect<void>
  readonly seekByPercentage: (percentage: number) => Effect.Effect<void>
  readonly jumpForward: (seconds?: number) => Effect.Effect<void>
  readonly jumpBackward: (seconds?: number) => Effect.Effect<void>
  readonly setVolume: (volume: number) => Effect.Effect<void>
  readonly toggleMute: Effect.Effect<void>
  readonly playTrack: (track: QueueTrackType) => Effect.Effect<void>
  readonly playAll: (tracks: ReadonlyArray<QueueTrackType>) => Effect.Effect<void>
  readonly enqueue: (track: QueueTrackType) => Effect.Effect<void>
  readonly enqueueAll: (tracks: ReadonlyArray<QueueTrackType>) => Effect.Effect<void>
  readonly removeFromQueue: (index: number) => Effect.Effect<void>
  readonly reorderQueue: (from: number, to: number) => Effect.Effect<void>
  readonly clearQueue: Effect.Effect<void>
  readonly playFromQueue: (index: number) => Effect.Effect<void>
  readonly playNext: Effect.Effect<void>
  readonly playPrevious: Effect.Effect<void>
}

export const makeAudioPlayback = (
  runtime: PlaybackRuntime,
  reporter: AudioPlaybackReporter = noopReporter,
  readPreferences: () => PlayerPreferences = () => defaultPlayerPreferences,
): Effect.Effect<
  AudioPlaybackController,
  never,
  AudioEngine | PlayerStorage | PlayReporter | Scope
> =>
  Effect.gen(function* () {
    const engine = yield* AudioEngine
    const storage = yield* PlayerStorage

    const onError =
      reporter.onError ?? ((message: string, error: Error) => Effect.logError(message, error))

    const reportError = (message: string, error: Error) => onError(message, error)

    let queueState = initialQueueState
    let transportState = initialTransport
    let volumeState = defaultVolume
    let queueHydration: QueueHydration = QueueHydration.Hydrating({ pending: [] })
    let volumeHydration: VolumeHydration = VolumeHydration.Hydrating({ pending: null })

    let queueWriteTail: Promise<void> = Promise.resolve()
    let volumeWriteTail: Promise<void> = Promise.resolve()
    const listeners = new Set<SnapshotListener>()
    let currentSnapshot = buildSnapshot(queueState, transportState, volumeState)

    const emitSnapshot = () => {
      currentSnapshot = buildSnapshot(queueState, transportState, volumeState)

      for (const listener of listeners) listener(currentSnapshot)
    }

    const persistQueue = (state: typeof initialQueueState) => {
      queueWriteTail = queueWriteTail
        .catch(() => undefined)
        .then(() => runtime.runPromise(storage.saveQueue(state)))
        .catch((cause) => {
          void runtime
            .runPromise(
              reportError(
                'Unable to persist audio queue',
                new Error('Unable to persist audio queue', { cause }),
              ),
            )
            .catch(() => undefined)
        })
    }

    const persistVolume = (state: VolumeRecordType) => {
      volumeWriteTail = volumeWriteTail
        .catch(() => undefined)
        .then(() => runtime.runPromise(storage.saveVolume(state)))
        .catch((cause) => {
          void runtime
            .runPromise(
              reportError(
                'Unable to persist audio volume',
                new Error('Unable to persist audio volume', { cause }),
              ),
            )
            .catch(() => undefined)
        })
    }

    const updateTransport = (next: PlaybackTransportSnapshot) => {
      transportState = next
      emitSnapshot()
    }

    const updateQueue = (next: typeof initialQueueState) => {
      queueState = next
      emitSnapshot()
    }

    const updateVolume = (next: VolumeRecordType) => {
      volumeState = next
      emitSnapshot()
    }

    const applyVolumeToEngine = (next: VolumeRecordType) =>
      Effect.gen(function* () {
        yield* engine.setVolume(next.volume / 100)
        yield* engine.setMuted(next.isMuted)
      })

    const syncCurrentTrack = (autoplay: boolean) =>
      Effect.gen(function* () {
        const current = currentTrack(queueState)

        if (!current) {
          yield* core.detachCurrentSource
          yield* core.setSource(null)

          return
        }

        if (autoplay) {
          yield* core.requestPlayOnReady(current.id)
        }

        yield* core.detachCurrentSource
        yield* core.setSource(current)
      })

    const playCurrent = Effect.gen(function* () {
      const current = currentTrack(queueState)

      if (!current) return
      const currentId = yield* core.currentTrackId

      if (currentId !== current.id) {
        yield* syncCurrentTrack(true)

        return
      }

      yield* core.play(current.id)
    })

    const pauseCurrent = Effect.gen(function* () {
      const current = currentTrack(queueState)

      if (!current) return
      yield* (
        reporter.onTrackPaused?.({
          ...queueTrackInfo(current),
          currentTime: currentSnapshot.transport.currentTime,
          duration: currentSnapshot.transport.duration,
        }) ?? Effect.void
      )
      yield* core.pause
    })

    const seekCurrent = (seconds: number, method: 'scrub' | 'keyboard' | 'mediasession') =>
      Effect.gen(function* () {
        const current = currentTrack(queueState)
        const fromTime = currentSnapshot.transport.currentTime

        if (current) {
          yield* (
            reporter.onTrackSeek?.({
              trackId: current.id,
              fromTime,
              toTime: seconds,
              method,
            }) ?? Effect.void
          )
        }

        yield* core.seekTo(seconds)
      }).pipe(
        Effect.catchCause((cause) =>
          reportError('Unable to seek audio', new Error('Unable to seek audio', { cause })),
        ),
      )

    const playFromQueue = (index: number, autoplay = true) =>
      Effect.gen(function* () {
        const target = trackFromQueueIndex(queueState, index)

        if (!target) return
        const currentId = yield* core.currentTrackId

        if (currentTrack(queueState)?.id === target.id) {
          if (currentId !== target.id) {
            yield* syncCurrentTrack(autoplay)

            return
          }

          if (autoplay) {
            yield* core.play(target.id)
          }

          return
        }

        yield* core.requestPlayOnReady(target.id)
        yield* core.detachCurrentSource
        const action = QueueAction.playIndex({ index })
        const next = reduceQueue(queueState, action)
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* core.setSource(target)
      })

    const togglePlayPause = Effect.gen(function* () {
      const desired = yield* core.isDesiredPlaying

      if (desired) {
        yield* pauseCurrent
      } else {
        yield* playCurrent
      }
    })

    const playNext = Effect.gen(function* () {
      const currentIndex = queueState.currentIndex

      if (currentIndex < 0) return
      const next = currentIndex + 1

      if (next >= queueState.tracks.length) return
      yield* playFromQueue(next, true)
    })

    const playPrevious = Effect.gen(function* () {
      if (queueState.currentIndex < 0 || queueState.tracks.length === 0) return
      const currentIndex = queueState.currentIndex
      const previous = currentIndex <= 0 ? queueState.tracks.length - 1 : currentIndex - 1
      yield* playFromQueue(previous, true)
    })

    const forkDetached = <A, E>(
      effect: Effect.Effect<A, E, AudioEngine | PlayReporter | PlayerStorage>,
    ) => {
      void runtime.runFork(effect.pipe(Effect.catchCause(() => Effect.void)))
    }

    const handleTrackFinished = () => {
      const current = currentTrack(queueState)

      if (!current) return
      const nextIndex = queueState.currentIndex + 1
      const next = trackFromQueueIndex(queueState, nextIndex)
      forkDetached(
        reporter.onTrackCompleted?.({
          ...queueTrackInfo(current),
          duration: currentSnapshot.transport.duration,
        }) ?? Effect.void,
      )

      if (next && readPreferences().continueQueue) {
        forkDetached(playFromQueue(nextIndex, true))
      }
    }

    const handleStatus = (status: EngineStatus) => {
      updateTransport({
        isInitialized: true,
        isLoaded: status.isLoaded,
        isPlaying: status.playing,
        isBuffering: status.isBuffering,
        currentTime: status.currentTime,
        duration: status.duration,
      })
      forkDetached(engine.setPositionState(status.duration, status.currentTime))
    }

    const core = yield* playerCore({
      onStatus: handleStatus,
      restorePosition: () => readPreferences().restorePosition,
      onTrackStarted: (track) => {
        forkDetached(reporter.onTrackPlayed?.(track) ?? Effect.void)
      },
      onTrackFinished: handleTrackFinished,
      onError: (message, error) => {
        forkDetached(reportError(message, error))
      },
    })

    updateTransport({ ...transportState, isInitialized: true })

    const readHydration = <A>(read: Effect.Effect<A, AudioStorageError>, message: string) =>
      read.pipe(
        Effect.exit,
        Effect.tap((result) =>
          Exit.isFailure(result) && !Cause.hasInterrupts(result.cause)
            ? reportError(message, new Error(message, { cause: result.cause }))
            : Effect.void,
        ),
      )

    const queueRead = yield* Effect.forkScoped(
      readHydration(storage.loadQueue, 'Unable to hydrate audio queue'),
    )

    const volumeRead = yield* Effect.forkScoped(
      readHydration(storage.loadVolume, 'Unable to hydrate audio volume'),
    )

    const mergeQueue = (persisted: PersistedQueueType | null) => {
      if (!QueueHydration.$is('Hydrating')(queueHydration)) return null
      const next = mergeHydratedQueue(persisted ?? initialQueueState, queueHydration.pending)
      queueHydration = QueueHydration.Hydrated()
      updateQueue(next)

      if (next !== persisted) persistQueue(next)

      return next
    }

    const loadQueue = Effect.gen(function* () {
      const result = yield* Fiber.join(queueRead)

      if (Exit.isFailure(result)) return
      const next = mergeQueue(result.value)

      if (!next) return
      const currentId = yield* core.currentTrackId
      const nextCurrent = selectQueueView(next).current

      if (nextCurrent?.id !== currentId) {
        yield* core.setSource(nextCurrent)
      }
    })

    const loadVolume = Effect.gen(function* () {
      const result = yield* Fiber.join(volumeRead)

      if (!VolumeHydration.$is('Hydrating')(volumeHydration)) return

      if (Exit.isFailure(result) && volumeHydration.pending === null) {
        volumeHydration = VolumeHydration.Hydrated()

        return
      }

      const persisted = Exit.isSuccess(result) ? result.value : null
      const next = volumeHydration.pending ?? persisted ?? defaultVolume
      volumeHydration = VolumeHydration.Hydrated()
      updateVolume(next)

      if (next !== persisted) persistVolume(next)
      yield* applyVolumeToEngine(next)
    })

    const queueApplication = yield* Effect.forkScoped(loadQueue)
    const volumeApplication = yield* Effect.forkScoped(loadVolume)

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Fiber.interruptAll([queueApplication, volumeApplication])

        if (QueueHydration.$is('Hydrating')(queueHydration) && queueHydration.pending.length > 0) {
          const result = yield* Fiber.join(queueRead).pipe(
            Effect.interruptible,
            Effect.timeoutOption('1 second'),
          )

          if (Option.isSome(result) && Exit.isSuccess(result.value)) mergeQueue(result.value.value)
        }

        if (VolumeHydration.$is('Hydrating')(volumeHydration) && volumeHydration.pending) {
          persistVolume(volumeHydration.pending)
          volumeHydration = VolumeHydration.Hydrated()
        }

        yield* Fiber.interruptAll([queueRead, volumeRead])
        yield* Effect.promise(() =>
          Promise.allSettled([queueWriteTail, volumeWriteTail]).then(() => undefined),
        )
      }),
    )

    yield* engine.setCommandHandlers({
      onPlay: () => {
        forkDetached(playCurrent)
      },
      onPause: () => {
        forkDetached(pauseCurrent)
      },
      onSeekBackward: (offset) => {
        forkDetached(
          seekCurrent(Math.max(0, currentSnapshot.transport.currentTime - offset), 'mediasession'),
        )
      },
      onSeekForward: (offset) => {
        forkDetached(seekCurrent(currentSnapshot.transport.currentTime + offset, 'mediasession'))
      },
      onPreviousTrack: () => {
        forkDetached(playPrevious)
      },
      onNextTrack: () => {
        forkDetached(playNext)
      },
      onSeekTo: (time) => {
        forkDetached(seekCurrent(time, 'mediasession'))
      },
    })

    yield* Effect.addFinalizer(() => engine.setCommandHandlers(null))

    const setVolume = (volume: number) =>
      Effect.gen(function* () {
        const next = { volume: Math.max(0, Math.min(100, volume)), isMuted: volumeState.isMuted }
        updateVolume(next)
        yield* applyVolumeToEngine(next)

        if (VolumeHydration.$is('Hydrating')(volumeHydration)) {
          volumeHydration.pending = next

          return
        }

        persistVolume(next)
      })

    const toggleMute = Effect.gen(function* () {
      const next = { ...volumeState, isMuted: !volumeState.isMuted }
      updateVolume(next)
      yield* applyVolumeToEngine(next)

      if (VolumeHydration.$is('Hydrating')(volumeHydration)) {
        volumeHydration.pending = next

        return
      }

      persistVolume(next)
    })

    const playTrack = (track: QueueTrackType) =>
      Effect.gen(function* () {
        const current = currentTrack(queueState)
        const currentId = yield* core.currentTrackId

        if (current?.id === track.id) {
          if (currentId === track.id) {
            yield* core.play(track.id)

            return
          }

          yield* syncCurrentTrack(true)

          return
        }

        const action = QueueAction.playNow({ track })
        const next = reduceQueue(queueState, action)
        yield* core.requestPlayOnReady(track.id)
        yield* core.detachCurrentSource
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* core.setSource(track)
      })

    const playAll = (tracks: ReadonlyArray<QueueTrackType>) =>
      Effect.gen(function* () {
        const uniqueTracks = playAllUnique(tracks)
        const [first] = uniqueTracks

        if (!first) return
        const action = QueueAction.playAll({ tracks: uniqueTracks })
        const next = reduceQueue(queueState, action)
        yield* core.requestPlayOnReady(first.id)
        yield* core.detachCurrentSource
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* core.setSource(first)
      })

    const enqueue = (track: QueueTrackType) =>
      Effect.gen(function* () {
        const action = QueueAction.enqueue({ track })
        const next = reduceQueue(queueState, action)

        if (next === queueState) return
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* (
          reporter.onQueueAction?.({
            action: 'add',
            trackId: track.id,
            queueLength: queueLength(next),
          }) ?? Effect.void
        )
      })

    const enqueueAll = (tracks: ReadonlyArray<QueueTrackType>) =>
      Effect.gen(function* () {
        const action = QueueAction.enqueueAll({ tracks })
        const next = reduceQueue(queueState, action)

        if (next === queueState) return
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* (
          reporter.onQueueAction?.({ action: 'add', queueLength: queueLength(next) }) ?? Effect.void
        )
      })

    const reorderQueue = (from: number, to: number) =>
      Effect.gen(function* () {
        const action = QueueAction.reorder({ from, to })
        const next = reduceQueue(queueState, action)

        if (next === queueState) return
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* (
          reporter.onQueueAction?.({ action: 'reorder', queueLength: queueLength(next) }) ??
            Effect.void
        )
      })

    const removeFromQueue = (index: number) =>
      Effect.gen(function* () {
        if (index < 0 || index >= queueState.tracks.length) return
        const previousCurrentId = currentTrack(queueState)?.id ?? null
        const removed = queueState.tracks[index]

        if (!removed) return

        const action = QueueAction.remove({ index })
        const next = reduceQueue(queueState, action)
        const nextCurrent = selectQueueView(next).current
        const nextCurrentId = nextCurrent?.id ?? null
        const shouldAutoplay = previousCurrentId === removed?.id && (yield* core.isDesiredPlaying)
        updateQueue(next)

        if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
        else persistQueue(next)
        yield* (
          reporter.onQueueAction?.({
            action: 'remove',
            trackId: removed.id,
            queueLength: queueLength(next),
          }) ?? Effect.void
        )

        if (previousCurrentId === nextCurrentId) return

        if (nextCurrent) {
          if (shouldAutoplay) {
            yield* core.requestPlayOnReady(nextCurrent.id)
          }

          yield* core.detachCurrentSource
          yield* core.setSource(nextCurrent)

          return
        }

        yield* core.detachCurrentSource
        yield* core.setSource(null)
      })

    const clearQueue = Effect.gen(function* () {
      updateQueue(initialQueueState)

      if (QueueHydration.$is('Hydrating')(queueHydration))
        queueHydration.pending.push(QueueAction.clear())
      else persistQueue(initialQueueState)
      yield* reporter.onQueueAction?.({ action: 'clear', queueLength: 0 }) ?? Effect.void
      yield* core.detachCurrentSource
      yield* core.setSource(null)
    })

    const playFromQueueIntent = (index: number) =>
      Effect.gen(function* () {
        const target = queueState.tracks[index]

        if (!target) return
        yield* (
          reporter.onQueueAction?.({
            action: 'play_from',
            trackId: target.id,
            queueLength: queueLength(queueState),
          }) ?? Effect.void
        )
        yield* playFromQueue(index, true)
      })

    const subscribeSnapshot = (listener: SnapshotListener) => {
      listeners.add(listener)
      listener(currentSnapshot)

      return () => listeners.delete(listener)
    }

    return {
      repairCreators: (original, creators) =>
        Effect.gen(function* () {
          if (hasCompleteCreators(original) || !hasCompleteCreators({ ...original, creators }))
            return
          const action = QueueAction.repairCreators({ track: original, creators })
          const next = reduceQueue(queueState, action)

          if (next === queueState) return
          const repaired = next.tracks.find((track) => track.id === original.id)
          updateQueue(next)

          if (QueueHydration.$is('Hydrating')(queueHydration)) queueHydration.pending.push(action)
          else persistQueue(next)

          if (repaired && currentTrack(queueState) === repaired)
            yield* core.repairCreators(original, repaired)
        }),
      getSnapshot: () => currentSnapshot,
      subscribeSnapshot,
      play: playCurrent,
      pause: pauseCurrent,
      togglePlayPause,
      seekTo: (seconds) => seekCurrent(seconds, 'scrub'),
      seekByPercentage: (percentage) =>
        Effect.gen(function* () {
          if (
            currentSnapshot.transport.duration <= 0 ||
            !Number.isFinite(currentSnapshot.transport.duration)
          )
            return
          const clamped = Math.max(0, Math.min(100, percentage))
          yield* seekCurrent((clamped / 100) * currentSnapshot.transport.duration, 'scrub')
        }),
      jumpForward: (seconds = 30) =>
        seekCurrent(currentSnapshot.transport.currentTime + seconds, 'keyboard'),
      jumpBackward: (seconds = 15) =>
        seekCurrent(Math.max(0, currentSnapshot.transport.currentTime - seconds), 'keyboard'),
      setVolume,
      toggleMute,
      playTrack,
      playAll,
      enqueue,
      enqueueAll,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      playFromQueue: playFromQueueIntent,
      playNext,
      playPrevious,
    }
  })
