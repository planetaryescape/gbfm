import {
  AudioEngine,
  layerFromAdapter,
  makeAudioPlayback,
  makePlayerCore,
  PlayReporter,
  type QueueTrackType,
} from '@gbfm/player'
import { Effect, Fiber, Layer, ManagedRuntime, Predicate, Stream } from 'effect'
import type { AudioSample, AudioStatus } from 'expo-audio'
import { describe, expect, it } from 'vitest'

import { ExpoAudioEngineLayer, type ExpoAudioEnginePlayer } from './expoAudioEngine'

class PlatformPlayer implements ExpoAudioEnginePlayer {
  src: string | null = null
  volume = 1
  muted = false
  rejectPlay = false
  readonly calls: Array<string> = []
  readonly listeners = new Set<(status: AudioStatus) => void>()
  currentStatus: AudioStatus = {
    id: 'player',
    isLoaded: false,
    duration: 0,
    currentTime: 0,
    playbackState: '',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    playing: false,
    didJustFinish: false,
    isBuffering: false,
    playbackRate: 1,
    shouldCorrectPitch: true,
    mute: false,
    loop: false,
    isLive: false,
    currentOffsetFromLive: null,
    error: null,
  }

  get currentTime() {
    return this.currentStatus.currentTime
  }

  emit(status: Partial<AudioStatus>) {
    this.currentStatus = { ...this.currentStatus, ...status }

    for (const listener of this.listeners) listener(this.currentStatus)
  }

  replace(source: Parameters<ExpoAudioEnginePlayer['replace']>[0]) {
    this.src = Predicate.isString(source) ? source : null
    this.currentStatus = { ...this.currentStatus, currentTime: 0, didJustFinish: false }
    this.calls.push(`replace:${this.src}`)
  }

  play() {
    this.calls.push(`play:${this.currentTime}`)

    if (this.rejectPlay) throw new Error('platform refused playback')
    this.emit({ playing: true, didJustFinish: false })
  }

  pause() {
    this.emit({ playing: false })
  }

  async seekTo(seconds: number) {
    this.currentStatus = { ...this.currentStatus, currentTime: seconds }
  }

  ready(duration = 120) {
    this.emit({ isLoaded: true, duration })
  }

  finish() {
    this.emit({ playing: false, didJustFinish: true, currentTime: this.currentStatus.duration })
  }

  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: AudioStatus) => void,
  ): { remove: () => void }
  addListener(
    event: 'audioSampleUpdate',
    listener: (sample: AudioSample) => void,
  ): { remove: () => void }
  addListener(
    ...args:
      | [event: 'playbackStatusUpdate', listener: (status: AudioStatus) => void]
      | [event: 'audioSampleUpdate', listener: (sample: AudioSample) => void]
  ) {
    if (args[0] === 'audioSampleUpdate') return { remove: () => {} }
    const listener = args[1]
    this.listeners.add(listener)

    return {
      remove: () => {
        this.listeners.delete(listener)
      },
    }
  }

  clearLockScreenControls() {}
  setActiveForLockScreen() {}
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
  const audio = new PlatformPlayer()
  const values = new Map<string, string>()
  const reads: Array<string> = []
  const cleared: Array<string> = []
  const reported: Array<string> = []
  const errors: Array<string> = []
  let completions = 0
  let pending: { key: string; promise: Promise<string | null> } | null = null

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
      ExpoAudioEngineLayer(audio, 'native'),
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

describe('Expo native adapter with shared playback orchestration', () => {
  it('ignores completion already queued by the adapter before source replacement', async () => {
    const f = fixture()
    f.audio.ready()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
          yield* Effect.yieldNow
          f.audio.finish()
          yield* core.requestPlayOnReady('two')
          yield* core.setSource(track('two'))
          yield* Effect.yieldNow
          expect(f.cleared).toEqual([])
          expect(f.completions).toBe(0)
          expect(yield* core.currentTrackId).toBe('two')
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
    f.audio.ready()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          const old = yield* Effect.forkScoped(core.setSource(track('one')))
          yield* Effect.promise(async () => {
            await expect.poll(() => f.reads).toContain(f.checkpointKey('one'))
          })
          yield* core.requestPlayOnReady('two')
          yield* core.setSource(track('two'))
          gate.resolve(f.checkpoint(67))
          yield* Fiber.join(old)
          expect(f.audio.src).toBe(track('two').url)
          expect(f.audio.calls.filter((call) => call.startsWith('play:'))).toEqual(['play:24'])
          expect(f.audio.currentTime).toBe(24)
          yield* core.setSource(null)
          f.audio.finish()
          yield* Effect.yieldNow
          expect(yield* core.currentTrackId).toBeNull()
          expect(f.audio.src).toBeNull()
          expect(f.completions).toBe(0)
        }).pipe(Effect.scoped),
      )
    } finally {
      gate.resolve(null)
      await f.runtime.dispose()
    }

    expect(f.audio.listeners.size).toBe(0)
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
    f.audio.ready()
    f.audio.rejectPlay = true

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
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
    f.audio.ready()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const core = yield* f.core()
          yield* core.requestPlayOnReady('one')
          yield* core.setSource(track('one'))
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
    f.audio.ready()
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
              await expect.poll(() => f.reported).toEqual(['one', 'two'])
            })
            expect(f.audio.src).toBe(track('two').url)
          } else {
            expect(f.reported).toEqual(['one'])
            yield* playback.playNext
            expect(f.audio.src).toBe(track('two').url)
          }
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('labels an old native status snapshot with the current source generation', async () => {
    const f = fixture()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* AudioEngine
          yield* engine.replace(track('one').url, 1)
          const old = { ...f.audio.currentStatus, didJustFinish: true, duration: 87 }
          yield* engine.replace(track('two').url, 2)
          const event = yield* Effect.forkScoped(Stream.runHead(engine.changes))
          yield* Effect.yieldNow

          for (const listener of f.audio.listeners) listener(old)
          expect(yield* Fiber.join(event)).toMatchObject({
            value: { sourceGeneration: 2, didJustFinish: true, duration: 87 },
          })
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })
})
