import {
  AudioEngine,
  layerFromAdapter,
  makeAudioPlayback,
  makePlayerCore,
  PlayReporter,
  type QueueTrackType,
} from '@gbfm/player'
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeHtmlAudioEngineLayer, type AudioPort } from './runtime'

class PlatformAudio extends EventTarget implements AudioPort {
  src = ''
  currentTime = 0
  duration = Number.NaN
  paused = true
  ended = false
  readyState = 0
  volume = 1
  muted = false
  rejectPlay = false
  readonly calls: Array<string> = []

  load() {
    this.currentTime = 0
    this.readyState = 0
    this.duration = Number.NaN
    this.paused = true
    this.ended = false
    this.calls.push(`replace:${this.src}`)
  }

  async play() {
    this.calls.push(`play:${this.currentTime}`)

    if (this.rejectPlay) throw new Error('platform refused playback')
    this.paused = false
    this.ended = false
    this.dispatchEvent(new Event('play'))
  }

  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }

  ready(duration = 120) {
    this.readyState = 4
    this.duration = duration
    this.dispatchEvent(new Event('loadedmetadata'))
  }

  finish() {
    this.paused = true
    this.ended = true
    this.currentTime = this.duration
    this.dispatchEvent(new Event('ended'))
  }
}

const track = (id: string): QueueTrackType => ({
  id,
  slug: id,
  title: id,
  url: `https://cdn.example/${id}.mp3`,
  thumbnailUrl: null,
  type: 'mix',
})

const fixture = () => {
  const audio = new PlatformAudio()
  const values = new Map<string, string>()
  const reads: Array<string> = []
  const cleared: Array<string> = []
  const reported: Array<string> = []
  const errors: Array<string> = []
  let completions = 0
  let pending: { key: string; promise: Promise<string | null> } | null = null
  const engine = makeHtmlAudioEngineLayer(audio)

  const storage = layerFromAdapter({
    read: async (key) => {
      reads.push(key)

      return pending?.key === key ? pending.promise : (values.get(key) ?? null)
    },
    write: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      cleared.push(key)
      values.delete(key)
    },
  })

  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      engine,
      storage,
      Layer.succeed(PlayReporter, {
        recordPlay: (id) =>
          Effect.sync(() => {
            reported.push(id)
          }),
      }),
    ),
  )

  const checkpointKey = (id: string) => `gbfm-audio-position-${id}.json`
  const checkpoint = (position: number) => JSON.stringify({ position, updatedAt: 0 })

  return {
    audio,
    runtime,
    reads,
    cleared,
    reported,
    errors,
    get completions() {
      return completions
    },
    checkpointKey,
    checkpoint,
    save: (id: string, position: number) => values.set(checkpointKey(id), checkpoint(position)),
    hold: (id: string, promise: Promise<string | null>) => {
      pending = { key: checkpointKey(id), promise }
    },
    core: () =>
      makePlayerCore({
        onStatus: () => {},
        onTrackFinished: () => {
          completions++
        },
        onError: (message) => {
          errors.push(message)
        },
      }).pipe(Effect.tap(() => Effect.yieldNow)),
  }
}

describe('browser adapter with shared playback orchestration', () => {
  it('ignores completion already queued by the adapter before source replacement', async () => {
    const f = fixture()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
          f.audio.ready(90)
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reported).toEqual(['one'])
          })
          f.audio.finish()
          yield* core.requestPlayOnReady('two')
          yield* core.setSource(track('two'))
          yield* Effect.yieldNow
          expect(f.cleared).toEqual([])
          expect(f.completions).toBe(0)
          expect(yield* core.currentTrackId).toBe('two')
          expect(f.audio.readyState).toBe(0)
          expect(f.audio.duration).toBeNaN()
          expect(f.reported).toEqual(['one'])
          f.audio.ready(150)
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reported).toEqual(['one', 'two'])
          })
          f.audio.finish()
          yield* Effect.promise(async () => {
            await expect
              .poll(() => ({ keys: f.cleared, completions: f.completions }))
              .toEqual({ keys: [f.checkpointKey('two')], completions: 1 })
          })
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('fences a replaced source checkpoint and clears the active source', async () => {
    const f = fixture()
    const gate = Promise.withResolvers<string | null>()
    f.hold('one', gate.promise)
    f.save('two', 24)

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          const old = yield* Effect.forkScoped(core.setSource(track('one')))
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reads).toContain(f.checkpointKey('one'))
          })
          f.audio.ready(90)
          yield* core.requestPlayOnReady('two')
          yield* core.setSource(track('two'))
          gate.resolve(f.checkpoint(67))
          yield* Fiber.join(old)
          expect(f.audio.src).toBe(track('two').url)
          expect(f.audio.readyState).toBe(0)
          expect(f.audio.duration).toBeNaN()
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual([])
          expect(f.audio.currentTime).toBe(0)
          f.audio.ready(150)
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reported).toEqual(['two'])
          })
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual(['play:24'])
          expect(f.audio.currentTime).toBe(24)
          yield* core.setSource(null)
          f.audio.finish()
          yield* Effect.yieldNow
          expect(yield* core.currentTrackId).toBeNull()
          expect(f.audio.src).toBe('')
          expect(f.completions).toBe(0)
        }).pipe(Effect.scoped),
      )
    } finally {
      gate.resolve(null)
      await f.runtime.dispose()
    }
  })

  it('restores a checkpoint without playing when paused before readiness', async () => {
    const f = fixture()
    f.save('one', 23)

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
          yield* core.pause
          f.audio.ready()
          yield* Effect.promise(async () => {
            await expect.poll(() => f.audio.currentTime).toBe(23)
          })
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual([])
          expect(yield* core.isDesiredPlaying).toBe(false)
          expect(f.reported).toEqual([])
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it.each(['checkpoint-first', 'duration-first'])('seeks before play with %s', async (order) => {
    const f = fixture()
    const gate = Promise.withResolvers<string | null>()
    f.hold('one', gate.promise)

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          const loading = yield* Effect.forkScoped(core.setSource(track('one')))
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reads).toContain(f.checkpointKey('one'))
          })
          f.audio.ready(0)
          yield* Effect.yieldNow
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual([])

          if (order === 'checkpoint-first') {
            gate.resolve(f.checkpoint(31))
            yield* Fiber.join(loading)
            expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual([])
            f.audio.ready()
          } else {
            f.audio.ready()
            yield* Effect.yieldNow
            expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual([])
            gate.resolve(f.checkpoint(31))
            yield* Fiber.join(loading)
          }

          yield* Effect.promise(async () => {
            await expect.poll(() => f.reported).toEqual(['one'])
          })
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual(['play:31'])
        }).pipe(Effect.scoped),
      )
    } finally {
      gate.resolve(null)
      await f.runtime.dispose()
    }
  })

  it('does not report or arm completion after platform play rejection', async () => {
    const f = fixture()
    f.audio.rejectPlay = true

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
          f.audio.ready()
          yield* Effect.promise(async () => {
            await expect.poll(() => f.errors).toEqual(['Playback was refused by the platform'])
          })
          f.audio.finish()
          yield* Effect.yieldNow
          expect(yield* core.isDesiredPlaying).toBe(false)
          expect(f.errors).toEqual(['Playback was refused by the platform'])
          expect(f.reported).toEqual([])
          expect(f.cleared).toEqual([])
          expect(f.completions).toBe(0)
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('deduplicates completion and rearms it after explicit replay from zero', async () => {
    const f = fixture()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
          f.audio.ready()
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reported).toEqual(['one'])
          })
          f.audio.finish()
          f.audio.finish()
          yield* Effect.promise(async () => {
            await expect
              .poll(() => ({ keys: f.cleared, completions: f.completions }))
              .toEqual({ keys: [f.checkpointKey('one')], completions: 1 })
          })
          yield* core.play('one')
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual([
            'play:0',
            'play:0',
          ])
          f.audio.finish()
          f.audio.finish()
          yield* Effect.promise(async () => {
            await expect
              .poll(() => ({ keys: f.cleared, completions: f.completions }))
              .toEqual({ keys: [f.checkpointKey('one'), f.checkpointKey('one')], completions: 2 })
          })
          expect(f.cleared.filter((key) => key === f.checkpointKey('one'))).toHaveLength(2)
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it.each([true, false])('uses live queue continuation preference %s', async (continueQueue) => {
    const f = fixture()
    const completed: Array<string | null> = []
    let preferences = { continueQueue: !continueQueue, restorePosition: true }

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const playback = yield* makeAudioPlayback(
            f.runtime,
            {
              onTrackCompleted: ({ trackId }) =>
                Effect.sync(() => {
                  completed.push(trackId)
                }),
            },
            () => preferences,
          )

          yield* Effect.yieldNow
          yield* playback.playAll([track('one'), track('two')])
          f.audio.ready(90)
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reported).toEqual(['one'])
          })
          preferences = { ...preferences, continueQueue }
          f.audio.finish()
          yield* Effect.promise(async () => {
            await expect.poll(() => completed).toEqual(['one'])
          })
          yield* Effect.promise(async () => {
            await expect
              .poll(() => playback.getSnapshot().queue.current?.id)
              .toBe(continueQueue ? 'two' : 'one')
          })

          if (continueQueue) {
            yield* Effect.promise(async () => {
              await expect.poll(() => f.audio.src).toBe(track('two').url)
            })
            expect(f.audio.readyState).toBe(0)
            expect(f.audio.duration).toBeNaN()
            expect(f.reported).toEqual(['one'])
            f.audio.ready(150)
            yield* Effect.promise(async () => {
              await expect.poll(() => f.reported).toEqual(['one', 'two'])
            })
            expect(f.audio.src).toBe(track('two').url)
          } else {
            expect(f.reported).toEqual(['one'])
            yield* playback.playNext
            expect(f.audio.src).toBe(track('two').url)
            expect(f.audio.readyState).toBe(0)
            expect(f.audio.duration).toBeNaN()
            expect(f.reported).toEqual(['one'])
            f.audio.ready(150)
            yield* Effect.promise(async () => {
              await expect.poll(() => f.reported).toEqual(['one', 'two'])
            })
          }
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('cannot recover old-source identity from an unlabelled platform ended event', async () => {
    const f = fixture()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* AudioEngine
          yield* engine.replace(track('one').url, 1)
          yield* engine.replace(track('two').url, 2)
          const event = yield* Effect.forkScoped(Stream.runHead(engine.changes))
          yield* Effect.yieldNow
          f.audio.finish()
          expect(yield* Fiber.join(event)).toMatchObject({
            value: { sourceGeneration: 2, didJustFinish: true },
          })
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })
})
