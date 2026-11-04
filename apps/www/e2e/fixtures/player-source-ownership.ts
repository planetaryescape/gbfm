import { AudioEngine, type EngineStatus } from '@gbfm/player'
import { Effect, ManagedRuntime, Stream } from 'effect'

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This browser fixture is the composition root owning the runtime and audio factory.
import { makeHtmlAudioEngineLayer } from '../../src/player/runtime'

const instances: Array<HTMLAudioElement> = []

const events: Array<EngineStatus> = []

let continuing = false

let dispose = async () => {}

export const inspect = () => ({
  events: [...events],
  instances: instances.map((audio) => ({
    src: audio.getAttribute('src'),
    playing: !audio.paused,
    position: audio.currentTime,
    volume: audio.volume,
    muted: audio.muted,
  })),
})

export const deliverOldEvents = () => {
  const old = instances[0]
  const current = instances[1]

  if (!old || !current) throw new Error('Missing source instances')
  const after = events.length

  for (const type of ['loadedmetadata', 'timeupdate', 'ended']) old.dispatchEvent(new Event(type))
  current.currentTime = 3.25
  const position = current.currentTime
  current.dispatchEvent(new Event('timeupdate'))

  return { after, position }
}

export const mountPlayerSourceFixture = () => {
  const runtime = ManagedRuntime.make(
    makeHtmlAudioEngineLayer(() => {
      const audio = new Audio()
      instances.push(audio)

      return audio
    }),
  )

  dispose = () => runtime.dispose()
  runtime.runFork(
    Effect.gen(function* () {
      const engine = yield* AudioEngine
      yield* Stream.runForEach(engine.changes, (status) =>
        Effect.gen(function* () {
          events.push(status)

          if (continuing && status.sourceGeneration === 1 && status.didJustFinish) {
            continuing = false
            yield* engine.replace('/fixture-two.wav', 2)
            yield* engine.play
          }
        }),
      )
    }),
  )

  for (const action of ['start', 'replace', 'continue', 'clear', 'dispose']) {
    const button = document.createElement('button')
    button.textContent = action
    button.addEventListener('click', async () => {
      button.dataset.completed = 'false'
      button.dataset.outcome = 'pending'
      delete button.dataset.failed

      try {
        if (action === 'dispose') await dispose()
        else
          await runtime.runPromise(
            Effect.gen(function* () {
              const engine = yield* AudioEngine

              if (action === 'clear') {
                yield* engine.clearSource

                return
              }

              continuing = action === 'continue'
              yield* engine.setVolume(0.35)
              yield* engine.setMuted(false)
              yield* engine.replace(
                action === 'replace' ? '/fixture-two.wav' : '/fixture-one.wav',
                action === 'replace' ? 2 : 1,
              )
              yield* engine.play
            }),
          )
        button.dataset.completed = 'true'
        button.dataset.outcome = 'completed'
      } catch {
        button.dataset.failed = `player-fixture:${action}:failed`
        button.dataset.outcome = 'failed'
      }
    })
    document.body.append(button)
  }
}
