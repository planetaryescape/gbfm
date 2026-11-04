import { useAtomValue } from '@effect/atom-react'
import type { AudioResponse } from '@gbfm/api/audio'
import {
  type AudioEngine,
  makeAudioPlayback,
  type PlayReporter,
  type PlayerStorage,
  type AudioPlaybackController,
  type PlaybackSnapshot,
  type QueueTrackType,
} from '@gbfm/player'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { createAudioPlayer } from 'expo-audio'
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Platform } from 'react-native'

import { ExpoAudioEngineLayer } from '@/audio/expoAudioEngine'
import { PlayReporterLive } from '@/audio/playTracker'
import { PlayerStorageLive } from '@/audio/queueStorage'
import { audioModeAtom } from '@/store/atoms/audio-mode'

type Track = typeof AudioResponse.Type

type QueueNotice = {
  readonly id: number
  readonly message: string
}

type NowPlayingContextValue = {
  readonly track: QueueTrackType | null
  readonly isPlaying: boolean
  readonly isLoaded: boolean
  readonly isBuffering: boolean
  readonly currentTime: number
  readonly duration: number
  readonly queue: PlaybackSnapshot['queue']
  readonly queueNotice: QueueNotice | null
  readonly loadAndPlay: (track: Track) => void
  readonly enqueue: (track: Track) => void
  readonly enqueueAll: (tracks: ReadonlyArray<Track>) => void
  readonly playAll: (tracks: ReadonlyArray<Track>) => void
  readonly removeFromQueue: (index: number) => void
  readonly reorderQueue: (from: number, to: number) => void
  readonly skipTo: (index: number) => void
  readonly skipNext: () => void
  readonly skipPrevious: () => void
  readonly togglePlayback: () => void
  readonly seekTo: (seconds: number) => void
  readonly clearQueue: () => void
}

const NowPlayingContext = createContext<NowPlayingContextValue | null>(null)

const toQueueTrack = (track: Track): QueueTrackType => ({
  id: track.id,
  title: track.title,
  slug: track.slug,
  url: track.url,
  thumbnailUrl: track.thumbnailUrl,
  type: track.type,
  creators: track.artists?.length ? track.artists : track.creators,
})

const initialSnapshot: PlaybackSnapshot = {
  queue: { tracks: [], currentIndex: -1, current: null },
  transport: {
    isInitialized: false,
    isLoaded: false,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
  },
  volume: { volume: 100, isMuted: false },
}

export function NowPlayingProvider({ children }: PropsWithChildren) {
  useAtomValue(audioModeAtom)

  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(initialSnapshot)
  const [queueNotice, setQueueNotice] = useState<QueueNotice | null>(null)

  const runtimeRef = useRef<ManagedRuntime.ManagedRuntime<
    AudioEngine | PlayerStorage | PlayReporter,
    never
  > | null>(null)

  const playbackRef = useRef<AudioPlaybackController | null>(null)

  const runPlayback = useCallback(
    (operation: (playback: AudioPlaybackController) => Effect.Effect<void>) => {
      const playback = playbackRef.current
      const runtime = runtimeRef.current

      if (!playback || !runtime) return
      runtime.runFork(operation(playback))
    },
    [],
  )

  useEffect(() => {
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        ExpoAudioEngineLayer(
          () => createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true }),
          Platform.OS === 'web' ? 'web' : 'native',
        ),
        PlayReporterLive,
      ).pipe(Layer.provideMerge(PlayerStorageLive)),
    )

    runtimeRef.current = runtime

    runtime.runFork(
      Effect.gen(function* () {
        const playback = yield* makeAudioPlayback(runtime)
        playbackRef.current = playback
        const unsubscribe = playback.subscribeSnapshot(setSnapshot)
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))

        return yield* Effect.never
      }).pipe(Effect.scoped),
    )

    return () => {
      playbackRef.current = null
      runtimeRef.current = null
      void runtime.dispose()
    }
  }, [])

  const loadAndPlay = useCallback(
    (nextTrack: Track) => {
      runPlayback((playback) => playback.playTrack(toQueueTrack(nextTrack)))
    },
    [runPlayback],
  )

  const enqueue = useCallback(
    (track: Track) => {
      runPlayback((playback) => playback.enqueue(toQueueTrack(track)))
      setQueueNotice({ id: Date.now(), message: `Queued: ${track.title}` })
    },
    [runPlayback],
  )

  const enqueueAll = useCallback(
    (tracks: ReadonlyArray<Track>) => {
      if (tracks.length === 0) return
      runPlayback((playback) => playback.enqueueAll(tracks.map(toQueueTrack)))
      const [first] = tracks

      const message =
        tracks.length === 1 && first ? `Queued: ${first.title}` : `Queued ${tracks.length} tracks`

      setQueueNotice({ id: Date.now(), message })
    },
    [runPlayback],
  )

  const playAll = useCallback(
    (tracks: ReadonlyArray<Track>) => {
      if (tracks.length === 0) return
      runPlayback((playback) => playback.playAll(tracks.map(toQueueTrack)))
    },
    [runPlayback],
  )

  const removeFromQueue = useCallback(
    (index: number) => {
      runPlayback((playback) => playback.removeFromQueue(index))
    },
    [runPlayback],
  )

  const reorderQueue = useCallback(
    (from: number, to: number) => {
      runPlayback((playback) => playback.reorderQueue(from, to))
    },
    [runPlayback],
  )

  const skipTo = useCallback(
    (index: number) => {
      runPlayback((playback) => playback.playFromQueue(index))
    },
    [runPlayback],
  )

  const skipNext = useCallback(() => {
    runPlayback((playback) => playback.playNext)
  }, [runPlayback])

  const skipPrevious = useCallback(() => {
    if (snapshot.queue.currentIndex === 0) {
      runPlayback((playback) => playback.seekTo(0))

      return
    }

    runPlayback((playback) => playback.playPrevious)
  }, [runPlayback, snapshot.queue.currentIndex])

  const togglePlayback = useCallback(() => {
    runPlayback((playback) => playback.togglePlayPause)
  }, [runPlayback])

  const seekTo = useCallback(
    (seconds: number) => {
      runPlayback((playback) => playback.seekTo(seconds))
    },
    [runPlayback],
  )

  const clearQueue = useCallback(() => {
    runPlayback((playback) => playback.clearQueue)
  }, [runPlayback])

  const value = useMemo<NowPlayingContextValue>(
    () => ({
      track: snapshot.queue.current,
      isPlaying: snapshot.transport.isPlaying,
      isLoaded: snapshot.transport.isLoaded,
      isBuffering: snapshot.transport.isBuffering,
      currentTime: snapshot.transport.currentTime,
      duration: snapshot.transport.duration,
      queue: snapshot.queue,
      queueNotice,
      loadAndPlay,
      enqueue,
      enqueueAll,
      playAll,
      removeFromQueue,
      reorderQueue,
      skipTo,
      skipNext,
      skipPrevious,
      togglePlayback,
      seekTo,
      clearQueue,
    }),
    [
      snapshot,
      queueNotice,
      loadAndPlay,
      enqueue,
      enqueueAll,
      playAll,
      removeFromQueue,
      reorderQueue,
      skipTo,
      skipNext,
      skipPrevious,
      togglePlayback,
      seekTo,
      clearQueue,
    ],
  )

  return <NowPlayingContext value={value}>{children}</NowPlayingContext>
}

export function useNowPlaying() {
  const context = useContext(NowPlayingContext)

  if (!context) throw new Error('useNowPlaying must be used within a NowPlayingProvider')

  return context
}
