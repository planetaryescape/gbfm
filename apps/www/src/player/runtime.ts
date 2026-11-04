import { Observability } from '@gbfm/observability'
import { journeyObserver, noJourneys, type JourneyObserver } from '@gbfm/observability/callbacks'
import { playbackJourney } from '@gbfm/observability/playback'
import {
  AudioEngine,
  createWebAudioStorageAdapter,
  layerFromAdapter,
  makeAudioPlayback,
  makePlayReporterLayer,
  PlaybackRejected,
  type AudioPlaybackReporter,
  type AudioPlaybackController,
  type EngineStatus,
  type NowPlayingMetadata,
  type PlaybackCommandHandlers,
} from '@gbfm/player'
import { Cause, Context, Data, Effect, Exit, Layer, ManagedRuntime, Queue, Stream } from 'effect'

import {
  browserPreviewSession,
  isPrivateMedia,
  type PreviewSession,
} from '../media-preview/session'
import { reportPlayerTelemetry } from '../telemetry/browser'
import { createCreatorLookup } from './creator-lookup'
import { recoverPlayerCreators, type CreatorLookup } from './creator-recovery'
import { readPlayerPreferences } from './preferences'

export type AudioPort = {
  src: string
  crossOrigin?: string | null
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly ended: boolean
  readonly readyState: number
  volume: number
  muted: boolean
  load(): void
  play(): Promise<void>
  pause(): void
  removeAttribute(name: string): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void
}

const status = (audio: AudioPort, finished: boolean, generation: number | null): EngineStatus => ({
  sourceGeneration: generation,
  isLoaded: audio.readyState >= 1,
  playing: !audio.paused && !audio.ended,
  didJustFinish: finished,
  currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
  duration: Number.isFinite(audio.duration) ? audio.duration : 0,
  isBuffering: audio.readyState < 3 && !audio.paused,
})

const hasMediaSession = () => 'navigator' in globalThis && 'mediaSession' in navigator

type BrowserSource =
  | { readonly _tag: 'Empty'; readonly generation: null }
  | { readonly _tag: 'Public'; readonly generation: number }
  | {
      readonly _tag: 'PrivatePending'
      readonly generation: number
      readonly url: string
      readonly preview: PreviewSession
    }
  | {
      readonly _tag: 'PrivateReady'
      readonly generation: number
      readonly preview: PreviewSession
    }

const BrowserSource = Data.taggedEnum<BrowserSource>()

export const makeHtmlAudioEngineLayer = (
  createAudio: () => AudioPort,
  createPreview: (url: string, onDenied: () => void) => PreviewSession = browserPreviewSession,
  observer: JourneyObserver = noJourneys,
) =>
  Layer.effect(
    AudioEngine,
    Effect.gen(function* () {
      let active: {
        readonly audio: AudioPort
        readonly generation: number
        readonly dispose: () => void
      } | null = null

      let volume = 1
      let muted = false
      let disposed = false
      const listeners = new Set<(status: EngineStatus) => void>()
      let source: BrowserSource = BrowserSource.Empty({ generation: null })
      let playVersion = 0
      let playRequestedVersion: number | null = null
      const journey = playbackJourney(observer)

      const resetSource = () => {
        playRequestedVersion = null
        journey.cancel()
        playVersion++
        const previous = active
        const previousSource = source
        active = null
        source = BrowserSource.Empty({ generation: null })

        if ('preview' in previousSource) previousSource.preview.dispose()
        previous?.dispose()
      }

      const installPrivateSource = (
        pending: Extract<BrowserSource, { readonly _tag: 'PrivatePending' }>,
      ) => {
        const audio = active?.audio

        if (!audio) return
        audio.crossOrigin = 'use-credentials'
        audio.src = pending.url
        source = BrowserSource.PrivateReady({
          generation: pending.generation,
          preview: pending.preview,
        })
        audio.load()
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          disposed = true
          resetSource()
        }),
      )

      const createSource = (generation: number) => {
        const audio = createAudio()
        audio.volume = volume
        audio.muted = muted

        const emit = (finished = false) => {
          if (active !== owned) return
          const value = status(audio, finished, generation)

          for (const listener of listeners) listener(value)
        }

        const changed = () => emit()
        const ended = () => emit(true)

        const playing = () => {
          if (active !== owned) return

          if (!audio.paused && audio.readyState >= 3 && playRequestedVersion === playVersion)
            journey.status({ playing: true, error: null })
          emit()
        }

        const failed = () => {
          if (active !== owned) return
          journey.fail()
          emit()
        }

        const events = [
          'timeupdate',
          'loadedmetadata',
          'durationchange',
          'canplay',
          'waiting',
          'play',
          'pause',
        ]

        const owned = {
          audio,
          generation,
          dispose: () => {
            for (const event of events) audio.removeEventListener(event, changed)
            audio.removeEventListener('ended', ended)
            audio.removeEventListener('playing', playing)
            audio.removeEventListener('error', failed)
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
          },
        }

        active = owned

        for (const event of events) audio.addEventListener(event, changed)
        audio.addEventListener('ended', ended)
        audio.addEventListener('playing', playing)
        audio.addEventListener('error', failed)

        return owned
      }

      const changes = Stream.callback<EngineStatus>((queue) =>
        Effect.gen(function* () {
          const emit = (value: EngineStatus) => {
            Queue.offerUnsafe(queue, value)
          }

          listeners.add(emit)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              listeners.delete(emit)

              if (listeners.size === 0) journey.cancel()
            }),
          )
        }),
      )

      const setHandlers = (handlers: PlaybackCommandHandlers | null) =>
        Effect.sync(() => {
          if (!hasMediaSession()) return

          const actions: ReadonlyArray<MediaSessionAction> = [
            'play',
            'pause',
            'seekbackward',
            'seekforward',
            'previoustrack',
            'nexttrack',
            'seekto',
          ]

          const entries: ReadonlyArray<
            readonly [MediaSessionAction, MediaSessionActionHandler | null]
          > = handlers
            ? [
                ['play', handlers.onPlay],
                ['pause', handlers.onPause],
                ['seekbackward', (details) => handlers.onSeekBackward(details.seekOffset ?? 15)],
                ['seekforward', (details) => handlers.onSeekForward(details.seekOffset ?? 30)],
                ['previoustrack', handlers.onPreviousTrack],
                ['nexttrack', handlers.onNextTrack],
                [
                  'seekto',
                  (details) =>
                    details.seekTime !== undefined && handlers.onSeekTo(details.seekTime),
                ],
              ]
            : actions.map((action): readonly [MediaSessionAction, null] => [action, null])

          for (const [action, handler] of entries) {
            try {
              navigator.mediaSession.setActionHandler(action, handler)
            } catch {
              /* unsupported action */
            }
          }
        })

      return {
        replace: (url: string, nextGeneration: number, intent: 'play' | 'paused' = 'play') =>
          Effect.promise(async () => {
            resetSource()

            if (disposed) return
            journey.replace(intent)
            const version = playVersion

            try {
              const owned = createSource(nextGeneration)
              const audio = owned.audio

              if (isPrivateMedia(url)) {
                const pending = BrowserSource.PrivatePending({
                  generation: nextGeneration,
                  url,
                  preview: createPreview(url, () => {
                    if (active === owned) audio.pause()
                  }),
                })

                source = pending
                audio.pause()
                const result = await pending.preview.ensure()

                if (source !== pending) return

                if (!result.ok) {
                  journey.fail()

                  return
                }

                installPrivateSource(pending)

                return
              }

              source = BrowserSource.Public({ generation: nextGeneration })

              if (audio.crossOrigin === 'use-credentials') audio.crossOrigin = null
              audio.src = url
              audio.load()
            } catch (error) {
              if (version === playVersion) journey.fail()
              throw error
            }
          }),
        clearSource: Effect.sync(() => {
          resetSource()
        }),
        play: Effect.gen(function* () {
          const version = playVersion
          journey.play()
          playRequestedVersion = version

          return yield* Effect.gen(function* () {
            const owned = active

            if (!owned) return yield* new PlaybackRejected({})
            const audio = owned.audio
            const preview = 'preview' in source ? source.preview : undefined

            if (preview) {
              const result = yield* Effect.promise(() => preview.ensure())

              if (version !== playVersion || !('preview' in source) || source.preview !== preview)
                return yield* new PlaybackRejected({ reason: 'superseded' })

              if (!result.ok) return yield* new PlaybackRejected({})

              if (BrowserSource.$is('PrivatePending')(source)) installPrivateSource(source)
            }

            yield* Effect.tryPromise({
              try: () => audio.play(),
              catch: (cause) =>
                new PlaybackRejected(
                  version !== playVersion ? { reason: 'superseded' } : { cause },
                ),
            })

            if (version !== playVersion)
              return yield* new PlaybackRejected({ reason: 'superseded' })

            return undefined
          }).pipe(
            Effect.onExit((exit) => {
              if (version !== playVersion || Exit.isSuccess(exit)) return Effect.void

              return Effect.sync(() =>
                Cause.hasInterruptsOnly(exit.cause) ? journey.cancel() : journey.fail(),
              )
            }),
          )
        }),
        pause: Effect.sync(() => {
          journey.cancel()
          playRequestedVersion = null
          playVersion++
          active?.audio.pause()
        }),
        seekTo: (seconds: number) =>
          Effect.sync(() => {
            if (active) active.audio.currentTime = Math.max(0, seconds)
          }),
        setVolume: (value: number) =>
          Effect.sync(() => {
            volume = Math.max(0, Math.min(1, value))

            if (active) active.audio.volume = volume
          }),
        setMuted: (value: boolean) =>
          Effect.sync(() => {
            muted = value

            if (active) active.audio.muted = muted
          }),
        currentStatus: Effect.sync(() =>
          active
            ? status(active.audio, false, active.generation)
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
        changes,
        setNowPlaying: (metadata: NowPlayingMetadata | null) =>
          Effect.sync(() => {
            if (!hasMediaSession()) return
            navigator.mediaSession.metadata =
              metadata === null
                ? null
                : new MediaMetadata({
                    title: metadata.title,
                    artist: metadata.artist,
                    artwork: metadata.artworkUrl ? [{ src: metadata.artworkUrl }] : [],
                  })
          }),
        setPositionState: (duration: number, position: number) =>
          Effect.sync(() => {
            if (!hasMediaSession() || duration <= 0 || !Number.isFinite(duration)) return

            try {
              navigator.mediaSession.setPositionState({
                duration,
                position: Math.min(Math.max(0, position), duration),
                playbackRate: 1,
              })
            } catch {
              /* invalid transient position */
            }
          }),
        setCommandHandlers: setHandlers,
      }
    }),
  )

export type PlayerClientValue = { readonly controller: AudioPlaybackController }

export class PlayerClient extends Context.Service<PlayerClient, PlayerClientValue>()(
  '@gbfm/www/PlayerClient',
) {}

class PlayDeliveryFailed extends Data.TaggedError('PlayDeliveryFailed')<{
  readonly reason: 'unavailable' | 'rejected'
}> {}

export type BrowserDependencies = {
  readonly createAudio: () => AudioPort
  readonly storage: () => Storage | undefined
  readonly deliverPlay: (trackId: string) => Effect.Effect<void, PlayDeliveryFailed>
  readonly reporter: AudioPlaybackReporter
  readonly lookupCreators?: CreatorLookup
}

export const makePlayerClientLayer = (dependencies: BrowserDependencies) =>
  Layer.effect(
    PlayerClient,
    Effect.flatMap(Observability, (observability) =>
      Effect.acquireRelease(
        Effect.promise(async () => {
          const storage = layerFromAdapter(createWebAudioStorageAdapter(dependencies.storage))

          const services = Layer.mergeAll(
            makeHtmlAudioEngineLayer(
              dependencies.createAudio,
              browserPreviewSession,
              journeyObserver(observability),
            ),
            storage,
            makePlayReporterLayer(dependencies.deliverPlay).pipe(Layer.provide(storage)),
          )

          const runtime = ManagedRuntime.make(services)
          let resolveController: (controller: AudioPlaybackController) => void = () => undefined

          const controllerPromise = new Promise<AudioPlaybackController>((resolve) => {
            resolveController = resolve
          })

          runtime.runFork(
            Effect.scoped(
              makeAudioPlayback(runtime, dependencies.reporter, () =>
                readPlayerPreferences(dependencies.storage),
              ).pipe(
                Effect.tap((controller) =>
                  Effect.gen(function* () {
                    resolveController(controller)

                    if (dependencies.lookupCreators)
                      yield* recoverPlayerCreators(controller, dependencies.lookupCreators)
                  }),
                ),
                Effect.andThen(Effect.never),
              ),
            ),
          )

          return { runtime, controller: await controllerPromise }
        }),
        ({ runtime }) =>
          Effect.promise(async () => {
            await runtime.dispose()
          }),
      ).pipe(Effect.map(({ controller }) => ({ controller }))),
    ),
  )

/** Whole-application browser resource. It is lazy: no browser global is read at module evaluation. */
export const playerClientLayer = makePlayerClientLayer({
  createAudio: () => new Audio(),
  storage: () => ('window' in globalThis ? window.localStorage : undefined),
  deliverPlay: (trackId) =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(`/api/content/audio/${encodeURIComponent(trackId)}/play`, {
          method: 'POST',
          credentials: 'same-origin',
          signal,
        }),
      catch: () => new PlayDeliveryFailed({ reason: 'unavailable' }),
    }).pipe(
      Effect.flatMap((response) =>
        response.ok ? Effect.void : Effect.fail(new PlayDeliveryFailed({ reason: 'rejected' })),
      ),
    ),
  reporter: {
    onTrackPlayed: () => Effect.sync(() => reportPlayerTelemetry('play')),
    onTrackPaused: () => Effect.sync(() => reportPlayerTelemetry('pause')),
    onError: () => Effect.sync(() => reportPlayerTelemetry('error')),
  },
  lookupCreators: createCreatorLookup((...args) => fetch(...args)),
})
