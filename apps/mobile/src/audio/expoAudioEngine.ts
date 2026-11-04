import { noJourneys, type JourneyObserver } from '@gbfm/observability/callbacks'
import { playbackJourney } from '@gbfm/observability/playback'
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
>

const makeExpoAudioEngine = (
  player: ExpoAudioEnginePlayer,
  platform: 'native' | 'web',
  journeys: JourneyObserver,
) =>
  Effect.sync(() => {
    let sourceGeneration: number | null = null
    let playRequestedGeneration: number | null = null
    const journey = playbackJourney(journeys)

    return {
      replace: (url: string, generation: number, intent: 'play' | 'paused' = 'play') =>
        Effect.sync(() => {
          journey.replace(intent)
          sourceGeneration = generation
          playRequestedGeneration = null

          try {
            player.replace(url)
          } catch (error) {
            journey.fail()
            throw error
          }
        }),
      clearSource: Effect.sync(() => {
        journey.cancel()
        sourceGeneration = null
        playRequestedGeneration = null
        player.replace(null)
      }),
      play: Effect.try({
        try: () => {
          playRequestedGeneration = sourceGeneration
          journey.play()
          player.play()
        },
        catch: (cause: unknown) => {
          journey.fail()

          return new PlaybackRejected({ cause })
        },
      }),
      pause: Effect.sync(() => {
        journey.cancel()
        playRequestedGeneration = null
        player.pause()
      }),
      setVolume: (volume: number) =>
        Effect.sync(() => {
          player.volume = Math.max(0, Math.min(1, volume))
        }),
      setMuted: (muted: boolean) =>
        Effect.sync(() => {
          player.muted = muted
        }),
      seekTo: (seconds: number) => Effect.promise(() => player.seekTo(seconds)),
      currentStatus: Effect.sync(() => toEngineStatus(player.currentStatus, sourceGeneration)),

      changes: Stream.callback<EngineStatus>((queue) =>
        Effect.gen(function* () {
          const subscription = subscribeToPlaybackStatus(player, platform, (status) => {
            const current = player.currentStatus

            if (status.error && current.error === status.error) journey.fail()
            else if (
              status.playing &&
              current.playing &&
              current.isLoaded &&
              playRequestedGeneration === sourceGeneration
            )
              journey.status({ playing: true, error: null })
            Queue.offerUnsafe(queue, toEngineStatus(status, sourceGeneration))
          })

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              journey.cancel()
              subscription.remove()
            }),
          )
        }),
      ),

      setNowPlaying: (metadata: NowPlayingMetadata | null) =>
        Effect.sync(() => {
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
  player: ExpoAudioEnginePlayer,
  platform: 'native' | 'web',
  journeys: JourneyObserver = noJourneys,
) => Layer.effect(AudioEngine, makeExpoAudioEngine(player, platform, journeys))
