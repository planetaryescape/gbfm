import { noJourneys, type JourneyObserver } from '@gbfm/observability/callbacks'
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
import { playbackJourney } from './playbackJourney'

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
    const journey = playbackJourney(journeys)

    return {
      replace: (url: string, generation: number) =>
        Effect.sync(() => {
          journey.replace()
          sourceGeneration = generation

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
        player.replace(null)
      }),
      play: Effect.try({
        try: () => player.play(),
        catch: (cause: unknown) => {
          journey.fail()

          return new PlaybackRejected({ cause })
        },
      }),
      pause: Effect.sync(() => {
        journey.cancel()
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
            journey.status(status)
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
