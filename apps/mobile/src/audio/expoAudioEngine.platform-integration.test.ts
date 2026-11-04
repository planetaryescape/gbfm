import {
  AudioEngine,
  layerFromAdapter,
  makeAudioPlayback,
  makePlayerCore,
  PlayReporter,
  type QueueTrackType,
  type EngineStatus,
} from '@gbfm/player'
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Predicate, Scope, Stream } from 'effect'
import type { AudioSample, AudioStatus } from 'expo-audio'
import { describe, expect, it, vi } from 'vitest'

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
    this.calls.push('pause')
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

  clearLockScreenControls() {
    this.calls.push('clearLockScreen')
  }
  setActiveForLockScreen() {
    this.calls.push('lockScreen')
  }
  remove() {
    this.src = null
    this.calls.push('remove')
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
  let audio = new PlatformPlayer()
  const initial = audio
  const instances: Array<PlatformPlayer> = []
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
      ExpoAudioEngineLayer(() => {
        const next = new PlatformPlayer()
        next.currentStatus = {
          ...initial.currentStatus,
          playing: false,
          currentTime: 0,
          didJustFinish: false,
        }
        next.rejectPlay = initial.rejectPlay
        audio = next
        instances.push(next)

        return next
      }, 'native'),
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
    get audio() {
      return audio
    },
    instances,
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
  it('releases Expo web completion polling along with each owned instance', async () => {
    vi.useFakeTimers()
    const players: Array<PlatformPlayer> = []

    const runtime = ManagedRuntime.make(
      ExpoAudioEngineLayer(() => {
        const player = new PlatformPlayer()
        players.push(player)

        return player
      }, 'web'),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* AudioEngine
          yield* engine.replace(track('one').url, 1)
          expect(vi.getTimerCount()).toBe(1)
          yield* engine.replace(track('two').url, 2)
          expect(vi.getTimerCount()).toBe(1)
          expect(players[0]?.listeners.size).toBe(0)
          yield* engine.clearSource
          expect(vi.getTimerCount()).toBe(0)
          yield* engine.replace(track('three').url, 3)
          expect(vi.getTimerCount()).toBe(1)
        }),
      )
      await runtime.dispose()
      expect(vi.getTimerCount()).toBe(0)
      expect(players.every((player) => player.listeners.size === 0)).toBe(true)
    } finally {
      await runtime.dispose()
      vi.useRealTimers()
    }
  })

  it.each(['replace', 'clear', 'dispose'] as const)(
    'ignores retained native callbacks after %s and releases only the old player',
    async (action) => {
      const instances: Array<PlatformPlayer> = []
      const seen: Array<EngineStatus> = []
      await Effect.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()

          const context = yield* Layer.buildWithScope(
            ExpoAudioEngineLayer(() => {
              const audio = new PlatformPlayer()
              instances.push(audio)

              return audio
            }, 'native'),
            scope,
          )

          const engine = yield* AudioEngine.pipe(Effect.provideContext(context))
          yield* Stream.runForEach(engine.changes, (value) =>
            Effect.sync(() => {
              seen.push(value)
            }),
          ).pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          yield* engine.setVolume(0.25)
          yield* engine.setMuted(true)
          yield* engine.replace(track('one').url, 1)
          const old = instances[0]

          if (!old) throw new Error('Expected player')
          const retained = [...old.listeners]
          yield* engine.setNowPlaying({ title: 'One' })

          if (action === 'replace') {
            yield* engine.replace(track('two').url, 2)
            yield* engine.setNowPlaying({ title: 'Two' })
            yield* engine.play
          } else if (action === 'clear') yield* engine.clearSource
          else yield* Scope.close(scope, Exit.void)
          yield* Effect.yieldNow
          seen.length = 0

          for (const listener of retained) {
            listener({ ...old.currentStatus, isLoaded: true, duration: 999, playing: true })
            listener({ ...old.currentStatus, didJustFinish: true, currentTime: 999 })
          }

          yield* Effect.yieldNow
          expect(seen).toEqual([])
          expect(old.listeners.size).toBe(0)
          expect(old.calls.filter((value) => value === 'remove')).toHaveLength(1)
          expect(old.calls).toContain('clearLockScreen')
          const current = instances.at(-1)

          if (action === 'replace' && current) {
            expect(current).not.toBe(old)
            expect(current.volume).toBe(0.25)
            expect(current.muted).toBe(true)
            expect(current.calls).not.toContain('pause')
            expect(current.calls).not.toContain('remove')
            expect(current.calls).not.toContain('clearLockScreen')
            current.ready(120)
            yield* Effect.yieldNow
            expect(seen).toEqual([
              expect.objectContaining({
                sourceGeneration: 2,
                isLoaded: true,
                duration: 120,
                didJustFinish: false,
              }),
            ])
          } else
            expect(yield* engine.currentStatus).toMatchObject({
              sourceGeneration: null,
              isLoaded: false,
            })
          yield* Scope.close(scope, Exit.void)

          for (const player of instances) {
            expect(player.listeners.size).toBe(0)
            expect(player.calls.filter((value) => value === 'remove')).toHaveLength(1)
          }
        }).pipe(Effect.scoped),
      )
    },
  )

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

  it('drops an old native instance status rather than stamping current source generation', async () => {
    const f = fixture()

    try {
      await f.runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* AudioEngine
          yield* engine.replace(track('one').url, 1)
          const previous = f.audio
          const old = [...previous.listeners]
          yield* engine.replace(track('two').url, 2)
          const event = yield* Effect.forkScoped(Stream.runHead(engine.changes))
          yield* Effect.yieldNow

          for (const listener of old)
            listener({
              ...previous.currentStatus,
              isLoaded: true,
              didJustFinish: true,
              duration: 87,
            })
          f.audio.ready(120)
          expect(yield* Fiber.join(event)).toMatchObject({
            value: { sourceGeneration: 2, didJustFinish: false, duration: 120 },
          })
        }).pipe(Effect.scoped),
      )
    } finally {
      await f.runtime.dispose()
    }
  })
})
