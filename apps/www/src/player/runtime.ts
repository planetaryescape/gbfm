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

export type PrivatePlaybackSnapshot = {
  readonly principalId: string | null
  readonly principalKnown: boolean
  readonly revision: number
  readonly authorizedUrls: ReadonlyArray<string>
}

export type PrivatePlaybackAccess = {
  readonly getSnapshot: () => PrivatePlaybackSnapshot
  readonly subscribe: (listener: (snapshot: PrivatePlaybackSnapshot) => void) => () => void
  readonly confirmPrincipal: (principalId: string | null, known: boolean) => Effect.Effect<boolean>
}

const makePrivatePlaybackAccess = () => {
  let snapshot: PrivatePlaybackSnapshot = {
    principalId: null,
    principalKnown: false,
    revision: 0,
    authorizedUrls: [],
  }

  let closed = false
  const listeners = new Set<(snapshot: PrivatePlaybackSnapshot) => void>()
  const waiters = new Set<() => void>()
  const invalidators = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener(snapshot)
  }

  const current = (revision: number) =>
    !closed &&
    snapshot.principalKnown &&
    snapshot.principalId !== null &&
    snapshot.revision === revision

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: PrivatePlaybackSnapshot) => void) => {
      listeners.add(listener)
      listener(snapshot)

      return () => {
        listeners.delete(listener)
      }
    },
    confirmPrincipal: (principalId: string | null, known: boolean) =>
      Effect.sync(() => {
        if (!known || closed || (snapshot.principalKnown && snapshot.principalId === principalId))
          return false
        const changed = snapshot.principalKnown
        snapshot = {
          principalId,
          principalKnown: true,
          revision: snapshot.revision + 1,
          authorizedUrls: [],
        }

        if (changed) for (const invalidate of invalidators) invalidate()
        emit()

        for (const resume of waiters) resume()
        waiters.clear()

        return changed
      }),
    ready: async () => {
      if (!snapshot.principalKnown && !closed)
        await new Promise<void>((resolve) => {
          waiters.add(resolve)
        })

      return current(snapshot.revision) ? snapshot.revision : null
    },
    current,
    grant: (url: string, revision: number) => {
      if (!current(revision) || snapshot.authorizedUrls.includes(url)) return
      snapshot = { ...snapshot, authorizedUrls: [...snapshot.authorizedUrls, url] }
      emit()
    },
    revoke: (url: string) => {
      snapshot = {
        ...snapshot,
        authorizedUrls: snapshot.authorizedUrls.filter((value) => value !== url),
      }
      emit()
    },
    onInvalidate: (invalidate: () => void) => {
      invalidators.add(invalidate)

      return () => {
        invalidators.delete(invalidate)
      }
    },
    dispose: () => {
      closed = true

      for (const invalidate of invalidators) invalidate()

      for (const resume of waiters) resume()
      waiters.clear()
      listeners.clear()
      invalidators.clear()
    },
  }
}

type PrivatePlaybackGuard = ReturnType<typeof makePrivatePlaybackAccess>

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
      readonly url: string
      readonly preview: PreviewSession
    }

const BrowserSource = Data.taggedEnum<BrowserSource>()

export const makeHtmlAudioEngineLayer = (
  createAudio: () => AudioPort,
  createPreview: (url: string, onDenied: () => void) => PreviewSession = browserPreviewSession,
  observer: JourneyObserver = noJourneys,
  privateAccess?: PrivatePlaybackGuard,
  setMediaSessionMetadata?: (metadata: NowPlayingMetadata | null) => void,
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

      let withheldMetadata: {
        readonly generation: number
        readonly metadata: NowPlayingMetadata
      } | null = null

      const journey = playbackJourney(observer)

      const publishMetadata = (metadata: NowPlayingMetadata | null) => {
        if (setMediaSessionMetadata) {
          setMediaSessionMetadata(
            metadata && privateAccess && metadata.artworkUrl && isPrivateMedia(metadata.artworkUrl)
              ? { title: metadata.title, artist: metadata.artist }
              : metadata,
          )

          return
        }

        if (!hasMediaSession()) return
        navigator.mediaSession.metadata =
          metadata === null
            ? null
            : new MediaMetadata({
                title: metadata.title,
                artist: metadata.artist,
                artwork:
                  metadata.artworkUrl && (!privateAccess || !isPrivateMedia(metadata.artworkUrl))
                    ? [{ src: metadata.artworkUrl }]
                    : [],
              })
      }

      const resetSource = () => {
        playRequestedVersion = null
        journey.cancel()
        playVersion++
        const previous = active
        const previousSource = source
        active = null
        source = BrowserSource.Empty({ generation: null })
        withheldMetadata = null

        if (privateAccess) publishMetadata(null)

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
          url: pending.url,
          preview: pending.preview,
        })
        audio.load()
      }

      if (privateAccess) {
        const unsubscribe = privateAccess.onInvalidate(() => {
          if (!('preview' in source)) return
          resetSource()
          publishMetadata(null)
        })

        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
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
                    if (active !== owned) return

                    if (privateAccess) {
                      privateAccess.revoke(url)

                      if ('preview' in source)
                        source = BrowserSource.PrivatePending({
                          generation: owned.generation,
                          url,
                          preview: source.preview,
                        })
                      audio.pause()
                      audio.removeAttribute('src')
                      audio.load()
                      publishMetadata(null)
                    } else audio.pause()
                  }),
                })

                source = pending
                audio.pause()
                const revision = privateAccess ? await privateAccess.ready() : undefined

                if (revision === null || source !== pending) return
                const result = await pending.preview.ensure()

                if (
                  source !== pending ||
                  (privateAccess && revision !== undefined && !privateAccess.current(revision))
                )
                  return

                if (!result.ok) {
                  journey.fail()

                  return
                }

                installPrivateSource(pending)

                if (privateAccess && revision !== undefined) privateAccess.grant(url, revision)

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
          }).pipe(
            Effect.andThen(() =>
              privateAccess && source.generation !== nextGeneration
                ? Effect.interrupt
                : Effect.void,
            ),
          ),
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
              const revision = privateAccess
                ? yield* Effect.promise(() => privateAccess.ready())
                : undefined

              if (revision === null) return yield* new PlaybackRejected({})
              const result = yield* Effect.promise(() => preview.ensure())

              if (
                version !== playVersion ||
                !('preview' in source) ||
                source.preview !== preview ||
                (privateAccess && revision !== undefined && !privateAccess.current(revision))
              )
                return yield* new PlaybackRejected({ reason: 'superseded' })

              if (!result.ok) return yield* new PlaybackRejected({})

              if (BrowserSource.$is('PrivatePending')(source)) installPrivateSource(source)

              if (privateAccess && revision !== undefined && 'url' in source)
                privateAccess.grant(source.url, revision)

              if (privateAccess && withheldMetadata?.generation === source.generation)
                publishMetadata(withheldMetadata.metadata)
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
            if (privateAccess)
              withheldMetadata =
                metadata && source.generation !== null
                  ? { generation: source.generation, metadata }
                  : null

            const withheld =
              privateAccess &&
              (BrowserSource.$is('Empty')(source) ||
                BrowserSource.$is('PrivatePending')(source) ||
                (BrowserSource.$is('PrivateReady')(source) &&
                  !privateAccess.getSnapshot().authorizedUrls.includes(source.url)) ||
                (BrowserSource.$is('Public')(source) &&
                  metadata?.artworkUrl &&
                  isPrivateMedia(metadata.artworkUrl)))

            publishMetadata(withheld ? null : metadata)
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

export type PlayerClientValue = {
  readonly controller: AudioPlaybackController
  readonly privateAccess?: PrivatePlaybackAccess
}

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
  readonly isolatePrivateMedia?: boolean
  readonly createPreview?: (url: string, onDenied: () => void) => PreviewSession
  readonly setMediaSessionMetadata?: (metadata: NowPlayingMetadata | null) => void
}

export const makePlayerClientLayer = (dependencies: BrowserDependencies) =>
  Layer.effect(
    PlayerClient,
    Effect.flatMap(Observability, (observability) =>
      Effect.acquireRelease(
        Effect.promise(async () => {
          const privateAccess = dependencies.isolatePrivateMedia
            ? makePrivatePlaybackAccess()
            : undefined

          const storage = layerFromAdapter(createWebAudioStorageAdapter(dependencies.storage))

          const services = Layer.mergeAll(
            makeHtmlAudioEngineLayer(
              dependencies.createAudio,
              dependencies.createPreview ?? browserPreviewSession,
              journeyObserver(observability),
              privateAccess,
              dependencies.setMediaSessionMetadata,
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

          return { runtime, controller: await controllerPromise, privateAccess }
        }),
        ({ runtime, privateAccess }) =>
          Effect.promise(async () => {
            privateAccess?.dispose()
            await runtime.dispose()
          }),
      ).pipe(Effect.map(({ controller, privateAccess }) => ({ controller, privateAccess }))),
    ),
  )

/** Whole-application browser resource. It is lazy: no browser global is read at module evaluation. */
const browserDependencies: BrowserDependencies = {
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
}

export const playerClientLayer = makePlayerClientLayer(browserDependencies)

export const isolatedPlayerClientLayer = makePlayerClientLayer({
  ...browserDependencies,
  isolatePrivateMedia: true,
})
