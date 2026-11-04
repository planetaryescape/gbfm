import { Observability, observeJourney } from '@gbfm/observability'
import { journeyObserver } from '@gbfm/observability/callbacks'
import { AudioEngine } from '@gbfm/player'
import { Effect, Exit, ManagedRuntime, Stream } from 'effect'

import { webObservabilityLayer } from '../src/observability/sentry'
import { makeHtmlAudioEngineLayer } from '../src/player/runtime'

document.getElementById('run')?.addEventListener('click', async () => {
  const result = document.getElementById('result')
  const runtime = ManagedRuntime.make(webObservabilityLayer)

  try {
    const outcomes = await runtime.runPromise(
      Effect.gen(function* () {
        const value = yield* observeJourney('navigation', Effect.succeed('content-ready'))

        const failure = yield* observeJourney(
          'navigation',
          Effect.fail('synthetic-secret-do-not-export'),
        ).pipe(Effect.exit)

        return { value, failed: Exit.isFailure(failure) }
      }),
    )

    await runtime.dispose()

    if (result) result.textContent = JSON.stringify(outcomes)
  } catch {
    await runtime.dispose()

    if (result) result.textContent = 'Fixture failed'
  }
})

document.getElementById('reader')?.addEventListener('click', async () => {
  const root = document.getElementById('root')
  const result = document.getElementById('result')

  if (!root || !result) return

  const commit = async (request: number, status: string) => {
    root.dataset.readerActive = 'true'
    root.dataset.readerRequest = String(request)
    root.dataset.readerStatus = status
    await Promise.resolve()
  }

  await commit(1, 'loading')
  const runtime = ManagedRuntime.make(webObservabilityLayer)

  try {
    await runtime.runPromise(Observability)
    await commit(1, 'ready')
    await commit(2, 'loading')
    await commit(3, 'loading')
    await commit(3, 'empty')
    await commit(4, 'loading')
    await commit(4, 'error')
    await commit(5, 'loading')
    await runtime.dispose()
    result.textContent = 'Reader outcomes delivered'
  } catch {
    await runtime.dispose()
    result.textContent = 'Reader fixture failed'
  }
})

const silentWave = () => {
  const bytes = new Uint8Array(16_044)
  const data = new DataView(bytes.buffer)

  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      bytes[offset + index] = value.charCodeAt(index)
  }

  text(0, 'RIFF')
  data.setUint32(4, bytes.length - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, 1, true)
  data.setUint32(24, 8000, true)
  data.setUint32(28, 16000, true)
  data.setUint16(32, 2, true)
  data.setUint16(34, 16, true)
  text(36, 'data')
  data.setUint32(40, 16000, true)

  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}

document.getElementById('playback')?.addEventListener('click', async () => {
  const result = document.getElementById('result')

  if (!result) return
  const signals = ManagedRuntime.make(webObservabilityLayer)
  const service = await signals.runPromise(Observability)
  const playing = Promise.withResolvers<void>()
  const source = silentWave()

  const runtime = ManagedRuntime.make(
    makeHtmlAudioEngineLayer(
      () => {
        const audio = new Audio()
        audio.muted = true
        audio.addEventListener('playing', () => playing.resolve(), { once: true })

        return audio
      },
      undefined,
      journeyObserver(service),
    ),
  )

  try {
    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* AudioEngine
          yield* engine.changes.pipe(Stream.runDrain, Effect.forkScoped)
          yield* Effect.yieldNow
          yield* engine.replace(source, 1)
          yield* engine.play
          yield* Effect.promise(() => playing.promise)
          yield* engine.replace(source, 2)
          yield* engine.pause
          yield* engine.replace('data:audio/wav;base64,bm90LWF1ZGlv', 3)
          yield* engine.play.pipe(Effect.exit)
        }),
      ),
    )
    await runtime.dispose()
    await signals.dispose()
    result.textContent = 'Playback outcomes delivered'
  } catch {
    await runtime.dispose()
    await signals.dispose()
    result.textContent = 'Playback fixture failed'
  } finally {
    URL.revokeObjectURL(source)
  }
})

for (const id of ['run', 'reader', 'playback']) {
  const button = document.getElementById(id)

  if (button instanceof HTMLButtonElement) button.disabled = false
}
