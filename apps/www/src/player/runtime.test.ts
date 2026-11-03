import {
  AudioEngine,
  makePlayerCore,
  PlayerStorageInMemory,
  PlayReporterNoop,
  type QueueTrackType,
} from '@gbfm/player'
import { Context, Effect, Fiber, Layer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPreviewSession } from '../media-preview/session'
import { makeHtmlAudioEngineLayer, type AudioPort } from './runtime'

class TestAudio extends EventTarget implements AudioPort {
  private source = ''
  sourceWrites: Array<{ url: string; crossOrigin: string | null }> = []
  get src() {
    return this.source
  }
  set src(url: string) {
    this.sourceWrites.push({ url, crossOrigin: this.crossOrigin })
    this.source = url
  }
  crossOrigin: string | null = null
  currentTime = 0
  duration = 120
  paused = true
  ended = false
  readyState = 4
  volume = 1
  muted = false
  load() {}
  async play() {
    this.paused = false
    this.dispatchEvent(new Event('play'))
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

afterEach(() => vi.useRealTimers())

describe('HTML audio engine', () => {
  it('controls and observes the supplied runtime-lived audio element', async () => {
    const audio = new TestAudio()

    const program = Effect.gen(function* () {
      const context = yield* Layer.build(makeHtmlAudioEngineLayer(audio))
      const engine = Context.get(context, AudioEngine)
      yield* engine.replace('/mix.mp3', 7)
      yield* engine.setVolume(0.4)
      yield* engine.play
      const status = yield* engine.currentStatus

      return { status, source: audio.src, volume: audio.volume }
    })

    const result = await Effect.runPromise(program.pipe(Effect.scoped))

    expect(result.source).toBe('/mix.mp3')
    expect(result.volume).toBe(0.4)
    expect(result.status).toMatchObject({ sourceGeneration: 7, playing: true })
  })

  it('does not require browser globals to construct the layer', () => {
    expect(Layer.isLayer(makeHtmlAudioEngineLayer(new TestAudio()))).toBe(true)
  })

  it('authorizes before setting a private source and leaves that source untouched on replay', async () => {
    vi.useFakeTimers()
    const audio = new TestAudio()
    const url = 'https://cdn.goosebumps.fm/user-content/private/owner/id/song.mp3'
    const requests: Array<string> = []
    const sourcesAtRequest: Array<string> = []

    const layer = makeHtmlAudioEngineLayer(audio, (source, onDenied) =>
      createPreviewSession(source, {
        now: Date.now,
        onDenied,
        fetch: async (input) => {
          const path =
            input instanceof Request ? input.url : input instanceof URL ? input.href : input

          requests.push(path)
          sourcesAtRequest.push(audio.src)

          return path.startsWith('/api/')
            ? Response.json({
                sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
                grant: 'test',
                expiresAt: Date.now() + 300_000,
              })
            : new Response(null, { status: 204 })
        },
      }),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = Context.get(yield* Layer.build(layer), AudioEngine)
        yield* engine.replace(url, 1)
        expect(audio.src).toBe(url)
        expect(audio.crossOrigin).toBe('use-credentials')
        yield* engine.play
        yield* engine.pause
        audio.currentTime = 42
        yield* engine.play
        expect(audio.currentTime).toBe(42)
        expect(audio.src).toBe(url)
        expect(requests).toHaveLength(2)
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(120_000))
        expect(requests).toHaveLength(4)
        expect(sourcesAtRequest).toEqual(['', '', url, url])
        expect(audio.currentTime).toBe(42)
        expect(audio.sourceWrites).toEqual([{ url, crossOrigin: 'use-credentials' }])
        yield* engine.replace('/public.mp3', 2)
        expect(audio.crossOrigin).toBe(null)
        expect(audio.src).toBe('/public.mp3')
      }).pipe(Effect.scoped),
    )
  })

  it.each(['pause', 'clear', 'replace', 'play-again'] as const)(
    'does not let a pending renewal override a newer %s command',
    async (command) => {
      const audio = new TestAudio()
      const url = 'https://cdn.goosebumps.fm/user-content/private/owner/id/song.mp3'
      const window = new EventTarget()
      let now = 0
      let apiRequests = 0
      let release = () => {}

      let started = () => {}

      const waiting = new Promise<void>((resolve) => {
        started = resolve
      })

      const gate = new Promise<void>((resolve) => {
        release = resolve
      })

      const errors: Array<string> = []

      const layer = makeHtmlAudioEngineLayer(audio, (source, onDenied) =>
        createPreviewSession(source, {
          now: () => now,
          onDenied,
          window,
          fetch: async (input) => {
            const path =
              input instanceof Request ? input.url : input instanceof URL ? input.href : input

            if (path.startsWith('/api/')) {
              if (++apiRequests === 2) {
                started()
                await gate
              }

              return Response.json({
                sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
                grant: 'disposable-test',
                expiresAt: now + 300_000,
              })
            }

            return new Response(null, { status: 204 })
          },
        }),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const core = yield* makePlayerCore({
            onStatus: () => {},
            onTrackFinished: () => {},
            onError: (message) => {
              errors.push(message)
            },
          })

          const track: QueueTrackType = {
            id: 'private',
            slug: 'private',
            title: 'Private',
            url,
            thumbnailUrl: null,
            type: 'mix',
          }

          yield* core.setSource(track)
          now += 6_000
          window.dispatchEvent(new Event('online'))
          yield* Effect.promise(() => waiting)
          const pending = yield* Effect.forkScoped(core.play(track.id))
          yield* Effect.yieldNow

          if (command === 'clear') yield* core.setSource(null)
          else if (command === 'replace')
            yield* core.setSource({ ...track, id: 'public', url: '/public.mp3' })
          else yield* core.pause

          const newer =
            command === 'play-again' ? yield* Effect.forkScoped(core.play(track.id)) : null

          yield* Effect.yieldNow
          release()
          yield* Fiber.join(pending)

          if (newer) yield* Fiber.join(newer)
          expect(audio.paused).toBe(command !== 'play-again')
          expect(yield* core.isDesiredPlaying).toBe(command === 'play-again')
          expect(audio.src).toBe(
            { pause: url, clear: '', replace: '/public.mp3', 'play-again': url }[command],
          )
          expect(errors).toEqual([])
        }).pipe(
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This scoped runPromise is the test application's entry point.
          Effect.provide(Layer.mergeAll(layer, PlayerStorageInMemory, PlayReporterNoop)),
          Effect.scoped,
        ),
      )
    },
  )

  it('does not load or play private media after permission is denied', async () => {
    const audio = new TestAudio()
    let denied = 0

    const layer = makeHtmlAudioEngineLayer(audio, (url) =>
      createPreviewSession(url, {
        now: Date.now,
        onDenied: () => {
          denied++
        },
        fetch: async () => new Response(null, { status: 403 }),
      }),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = Context.get(yield* Layer.build(layer), AudioEngine)
        yield* engine.replace('https://cdn.goosebumps.fm/user-content/private/owner/id/song.mp3', 1)
        const result = yield* Effect.result(engine.play)
        expect(result._tag).toBe('Failure')
        expect(audio.src).toBe('')
        expect(audio.paused).toBe(true)
        expect(denied).toBe(1)
      }).pipe(Effect.scoped),
    )
  })

  it.each(['replace', 'clear'])(
    'does not install a private source after a newer %s while its first grant is pending',
    async (command) => {
      const audio = new TestAudio()
      const grant = Promise.withResolvers<Response>()
      const requested = Promise.withResolvers<void>()
      let requests = 0

      const layer = makeHtmlAudioEngineLayer(audio, (source, onDenied) =>
        createPreviewSession(source, {
          now: Date.now,
          onDenied,
          fetch: async () => {
            requests++
            requested.resolve()

            return requests === 1 ? grant.promise : new Response(null, { status: 204 })
          },
        }),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const engine = Context.get(yield* Layer.build(layer), AudioEngine)

          const pending = yield* Effect.forkScoped(
            engine.replace('https://cdn.goosebumps.fm/user-content/private/owner/id/song.mp3', 1),
          )

          yield* Effect.promise(() => requested.promise)

          if (command === 'replace') yield* engine.replace('/public.mp3', 2)
          else yield* engine.clearSource

          grant.resolve(
            Response.json({
              sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
              grant: 'disposable',
              expiresAt: Date.now() + 300_000,
            }),
          )
          yield* Fiber.join(pending)

          const expected = command === 'replace' ? '/public.mp3' : ''
          expect(audio.src).toBe(expected)
          expect(audio.sourceWrites).toEqual([{ url: expected, crossOrigin: null }])
          expect(requests).toBe(1)
          expect(yield* engine.currentStatus).toMatchObject({
            sourceGeneration: command === 'replace' ? 2 : null,
            playing: false,
          })
        }).pipe(Effect.scoped),
      )
    },
  )

  it('installs a previously denied private source once when a later play is authorized', async () => {
    const audio = new TestAudio()
    const url = 'https://cdn.goosebumps.fm/user-content/private/owner/id/song.mp3'
    let now = 0
    let requests = 0

    const layer = makeHtmlAudioEngineLayer(audio, (source, onDenied) =>
      createPreviewSession(source, {
        now: () => now,
        onDenied,
        fetch: async () => {
          requests++

          if (requests === 1) return new Response(null, { status: 403 })

          return requests === 2
            ? Response.json({
                sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
                grant: 'disposable',
                expiresAt: now + 300_000,
              })
            : new Response(null, { status: 204 })
        },
      }),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = Context.get(yield* Layer.build(layer), AudioEngine)
        yield* engine.replace(url, 1)
        expect(audio.sourceWrites).toEqual([])
        now = 5_000
        yield* engine.play
        yield* engine.pause
        audio.currentTime = 42
        yield* engine.play

        expect(audio.sourceWrites).toEqual([{ url, crossOrigin: 'use-credentials' }])
        expect(audio.currentTime).toBe(42)
        expect(requests).toBe(3)
      }).pipe(Effect.scoped),
    )
  })
})
