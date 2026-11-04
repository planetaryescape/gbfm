import {
  AudioEngine,
  PlaybackRejected,
  type EngineStatus,
  type NowPlayingMetadata,
  type PlaybackCommandHandlers,
} from '@gbfm/player'
import { Effect, Layer, Queue, Stream } from 'effect'
import type { AudioMetadata, AudioPlayer, AudioStatus } from 'expo-audio'

import { subscribeToPlaybackStatus } from './audioPlayerAdapter'

const toEngineStatus = (status: AudioStatus, sourceGeneration: number | null): EngineStatus => ({
  sourceGeneration,
  isLoaded: status.isLoaded,
  playing: status.playing,
  didJustFinish: status.didJustFinish,
  currentTime: status.currentTime,
  duration: status.duration,
  isBuffering: status.isBuffering,
})

export type ExpoAudioEnginePlayer = Pick<
  AudioPlayer,
  | 'replace'
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'currentStatus'
  | 'volume'
  | 'muted'
  | 'addListener'
  | 'clearLockScreenControls'
  | 'setActiveForLockScreen'
  | 'remove'
>

const makeExpoAudioEngine = (
  createPlayer: () => ExpoAudioEnginePlayer,
  platform: 'native' | 'web',
) =>
  Effect.gen(function* () {
    let active: {
      readonly player: ExpoAudioEnginePlayer
      readonly generation: number
      readonly remove: () => void
    } | null = null

    let volume = 1
    let muted = false
    let disposed = false
    const listeners = new Set<(status: EngineStatus) => void>()

    const clear = () => {
      const previous = active
      active = null
      previous?.remove()
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposed = true
        clear()
      }),
    )

    return {
      replace: (url: string, generation: number) =>
        Effect.sync(() => {
          clear()

          if (disposed) return
          const player = createPlayer()
          player.volume = volume
          player.muted = muted

          const owned = {
            player,
            generation,
            remove: () => {
              subscription.remove()
              player.pause()
              player.clearLockScreenControls()
              player.remove()
            },
          }

          active = owned

          const subscription = subscribeToPlaybackStatus(player, platform, (status) => {
            if (active !== owned) return
            const value = toEngineStatus(status, generation)

            for (const listener of listeners) listener(value)
          })

          player.replace(url)
        }),
      clearSource: Effect.sync(clear),
      play: Effect.try({
        try: () => active?.player.play(),
        catch: (cause: unknown) => new PlaybackRejected({ cause }),
      }),
      pause: Effect.sync(() => active?.player.pause()),
      setVolume: (value: number) =>
        Effect.sync(() => {
          volume = Math.max(0, Math.min(1, value))

          if (active) active.player.volume = volume
        }),
      setMuted: (value: boolean) =>
        Effect.sync(() => {
          muted = value

          if (active) active.player.muted = muted
        }),
      seekTo: (seconds: number) =>
        Effect.promise(async () => {
          await active?.player.seekTo(seconds)
        }),
      currentStatus: Effect.sync(() =>
        active
          ? toEngineStatus(active.player.currentStatus, active.generation)
          : {
              sourceGeneration: null,
              isLoaded: false,
              playing: false,
              didJustFinish: false,
              currentTime: 0,
              duration: 0,
              isBuffering: false,
            },
      ),

      changes: Stream.callback<EngineStatus>((queue) =>
        Effect.gen(function* () {
          const listener = (status: EngineStatus) => {
            Queue.offerUnsafe(queue, status)
          }

          listeners.add(listener)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              listeners.delete(listener)
            }),
          )
        }),
      ),

      setNowPlaying: (metadata: NowPlayingMetadata | null) =>
        Effect.sync(() => {
          const player = active?.player

          if (!player) return

          if (!metadata) {
            player.clearLockScreenControls()

            return
          }

          const lockScreenMetadata: AudioMetadata = { title: metadata.title }

          if (metadata.artist !== undefined) lockScreenMetadata.artist = metadata.artist

          if (metadata.artworkUrl !== undefined) lockScreenMetadata.artworkUrl = metadata.artworkUrl

          player.setActiveForLockScreen(true, lockScreenMetadata, {
            showSeekForward: true,
            showSeekBackward: true,
          })
        }),

      setPositionState: () => Effect.void,

      // expo-audio exposes lock-screen activation/metadata but no JS remote
      // next/previous callback surface, so we keep this seam a no-op here.
      setCommandHandlers: (_handlers: PlaybackCommandHandlers | null) => Effect.void,
    }
  })

export const ExpoAudioEngineLayer = (
  createPlayer: () => ExpoAudioEnginePlayer,
  platform: 'native' | 'web',
) => Layer.effect(AudioEngine, makeExpoAudioEngine(createPlayer, platform))
