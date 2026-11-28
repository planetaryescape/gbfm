import {
  AudioEngine,
  makeAudioPlayback,
  PlayerStorageInMemory,
  PlayReporterNoop,
  type AudioPlaybackController,
} from '@gbfm/player'
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect'

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This fixture composition root owns the real audio factory and the gated engine Layer.
import { makeHtmlAudioEngineLayer } from '../../src/player/runtime'

export type ScalarRecord = {
  readonly kind: string
  readonly position?: number
  readonly seconds?: number
  readonly requested?: number
  readonly order?: number
  readonly at?: number
  readonly seq?: number
  readonly time?: number
  readonly modelTime?: number | null
  readonly referenceSeconds?: number
  readonly pointerRatio?: number
  readonly fine?: boolean
  readonly incomingPosition?: number
  readonly hillTarget?: boolean
  readonly inputValue?: number
  readonly audioTime?: number | null
  readonly x?: number | null
  readonly left?: number
  readonly width?: number
}

export const makeHomeTouchRuntime = async (record: (value: ScalarRecord) => void) => {
  let audio: HTMLAudioElement | undefined
  let gateArmed = false
  let waiting = false
  const home = Deferred.makeUnsafe<void>()
  const seeks: Array<number> = []

  const realEngine = makeHtmlAudioEngineLayer(() => {
    const created = new Audio()
    audio = created

    for (const type of ['seeking', 'seeked', 'timeupdate', 'pause'])
      created.addEventListener(type, () =>
        record({ kind: `audio:${type}`, position: created.currentTime }),
      )

    return created
  })

  const gatedEngine = Layer.effect(
    AudioEngine,
    Effect.gen(function* () {
      const engine = yield* AudioEngine

      return {
        ...engine,
        changes: engine.changes.pipe(
          Stream.tap((status) =>
            Effect.sync(() => record({ kind: 'engine-status', position: status.currentTime })),
          ),
        ),
        seekTo: (seconds: number) =>
          Effect.gen(function* () {
            seeks.push(seconds)
            record({ kind: 'engine-seek-entered', requested: seconds })

            if (gateArmed && seconds === 0) {
              waiting = true
              record({ kind: 'home-gated', requested: seconds })
              yield* Deferred.await(home)
              waiting = false
            }

            yield* engine.seekTo(seconds)
            record({ kind: 'engine-seek-completed', requested: seconds })
          }),
      }
    }),
  ).pipe(Layer.provide(realEngine))

  const services = Layer.mergeAll(gatedEngine, PlayerStorageInMemory, PlayReporterNoop)
  const runtime = ManagedRuntime.make(services)
  const release = () => runtime.runPromise(Deferred.succeed(home, undefined).pipe(Effect.asVoid))
  const ready = Promise.withResolvers<AudioPlaybackController>()

  const fiber = runtime.runFork(
    Effect.scoped(
      makeAudioPlayback(runtime).pipe(
        Effect.tap((controller) => Effect.sync(() => ready.resolve(controller))),
        Effect.andThen(Effect.never),
      ),
    ),
  )

  const controller = await ready.promise

  const stop = controller.subscribeSnapshot((snapshot) =>
    record({ kind: 'controller-snapshot', position: snapshot.transport.currentTime }),
  )

  const requireAudio = () => {
    if (!audio) throw new Error('Synthetic audio has not been acquired')

    return audio
  }

  return {
    controller,
    inspect: () => ({
      audioTime: audio?.currentTime ?? null,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : null,
      paused: audio?.paused ?? null,
      controllerTime: controller.getSnapshot().transport.currentTime,
      loaded: controller.getSnapshot().transport.isLoaded,
      waiting,
      seeks: [...seeks],
    }),
    start: () =>
      runtime.runPromise(
        controller.playTrack({
          id: 'synthetic-home-touch',
          title: 'Synthetic home touch',
          slug: 'synthetic-home-touch',
          type: 'mix',
          url: new URL('/audio.wav', location.href).href,
          thumbnailUrl: null,
        }),
      ),
    pause: () => runtime.runPromise(controller.pause),
    seed: () => runtime.runPromise(controller.seekTo(0.75)),
    arm: async () => {
      gateArmed = true
    },
    emitCurrent: async () => {
      requireAudio().dispatchEvent(new Event('timeupdate'))
    },
    release: () => release(),
    dispose: async () => {
      await release()
      stop()
      await Effect.runPromise(Fiber.interrupt(fiber))
      await runtime.dispose()
    },
  }
}
