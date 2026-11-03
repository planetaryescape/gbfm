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
import { Context, Data, Effect, Layer, ManagedRuntime, Queue, Stream } from 'effect'

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
  audio: AudioPort,
  createPreview: (url: string, onDenied: () => void) => PreviewSession = browserPreviewSession,
) =>
  Layer.effect(
    AudioEngine,
    Effect.gen(function* () {
      let finished = false
      let source: BrowserSource = BrowserSource.Empty({ generation: null })
      let playVersion = 0

      const resetSource = () => {
        playVersion++

        if ('preview' in source) source.preview.dispose()
        source = BrowserSource.Empty({ generation: null })
      }

      const installPrivateSource = (
        pending: Extract<BrowserSource, { readonly _tag: 'PrivatePending' }>,
      ) => {
        audio.crossOrigin = 'use-credentials'
        audio.src = pending.url
        source = BrowserSource.PrivateReady({
          generation: pending.generation,
          preview: pending.preview,
        })
        audio.load()
      }

      yield* Effect.addFinalizer(() => Effect.sync(resetSource))

      const changes = Stream.callback<EngineStatus>((queue) =>
        Effect.gen(function* () {
          const emit = () => Queue.offerUnsafe(queue, status(audio, finished, source.generation))

          const ended = () => {
            finished = true
            emit()
            finished = false
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

          for (const event of events) audio.addEventListener(event, emit)
          audio.addEventListener('ended', ended)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              for (const event of events) audio.removeEventListener(event, emit)
              audio.removeEventListener('ended', ended)
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
        replace: (url: string, nextGeneration: number) =>
          Effect.promise(async () => {
            resetSource()
            finished = false

            if (isPrivateMedia(url)) {
              const active = BrowserSource.PrivatePending({
                generation: nextGeneration,
                url,
                preview: createPreview(url, () => audio.pause()),
              })

              source = active
              audio.pause()
              const result = await active.preview.ensure()

              if (source !== active || !result.ok) return
              installPrivateSource(active)

              return
            }

            source = BrowserSource.Public({ generation: nextGeneration })

            if (audio.crossOrigin === 'use-credentials') audio.crossOrigin = null
            audio.src = url
            audio.load()
          }),
        clearSource: Effect.sync(() => {
          resetSource()
          finished = false
          audio.src = ''
          audio.load()
        }),
        play: Effect.gen(function* () {
          const version = playVersion
          const active = 'preview' in source ? source.preview : undefined

          if (active) {
            const result = yield* Effect.promise(() => active.ensure())

            if (version !== playVersion || !('preview' in source) || source.preview !== active)
              return yield* new PlaybackRejected({ reason: 'superseded' })

            if (!result.ok) return yield* new PlaybackRejected({})

            if (BrowserSource.$is('PrivatePending')(source)) installPrivateSource(source)
          }

          yield* Effect.tryPromise({
            try: () => audio.play(),
            catch: (cause) =>
              new PlaybackRejected(version !== playVersion ? { reason: 'superseded' } : { cause }),
          })

          if (version !== playVersion) return yield* new PlaybackRejected({ reason: 'superseded' })

          return undefined
        }),
        pause: Effect.sync(() => {
          playVersion++
          audio.pause()
        }),
        seekTo: (seconds: number) =>
          Effect.sync(() => {
            audio.currentTime = Math.max(0, seconds)
          }),
        setVolume: (volume: number) =>
          Effect.sync(() => {
            audio.volume = Math.max(0, Math.min(1, volume))
          }),
        setMuted: (muted: boolean) =>
          Effect.sync(() => {
            audio.muted = muted
          }),
        currentStatus: Effect.sync(() => status(audio, finished, source.generation)),
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
    Effect.acquireRelease(
      Effect.promise(async () => {
        const audio = dependencies.createAudio()
        const storage = layerFromAdapter(createWebAudioStorageAdapter(dependencies.storage))

        const services = Layer.mergeAll(
          makeHtmlAudioEngineLayer(audio),
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

        return { audio, runtime, controller: await controllerPromise }
      }),
      ({ audio, runtime }) =>
        Effect.promise(async () => {
          audio.pause()
          await runtime.dispose()
        }),
    ).pipe(Effect.map(({ controller }) => ({ controller }))),
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
