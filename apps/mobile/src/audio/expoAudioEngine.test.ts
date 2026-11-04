import { AudioEngine, PlaybackRejected } from '@gbfm/player'
import { Effect, ManagedRuntime } from 'effect'
import type { AudioStatus } from 'expo-audio'
import { expect, test } from 'vitest'

import { ExpoAudioEngineLayer, type ExpoAudioEnginePlayer } from './expoAudioEngine'

const currentStatus: AudioStatus = {
  id: 'player',
  isLoaded: true,
  duration: 60,
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

const makePlayer = (play: () => void): ExpoAudioEnginePlayer => {
  let status = { ...currentStatus }
  let volume = 1
  let muted = false

  return {
    get currentStatus() {
      return status
    },
    play,
    pause: () => {
      status = { ...status, playing: false }
    },
    replace: (source) => {
      if (source === null) {
        status = {
          ...status,
          isLoaded: false,
          playing: false,
          didJustFinish: false,
          currentTime: 0,
          duration: 0,
          isBuffering: false,
        }
      }
    },
    seekTo: () => Promise.resolve(),
    get volume() {
      return volume
    },
    set volume(value: number) {
      volume = value
    },
    get muted() {
      return muted
    },
    set muted(value: boolean) {
      muted = value
    },
    clearLockScreenControls: () => undefined,
    setActiveForLockScreen: () => undefined,
    addListener: () => ({ remove: () => undefined }),
    remove: () => undefined,
  }
}

test('translates a platform play failure into PlaybackRejected without hiding its cause', async () => {
  const failure = new Error('audio session unavailable')

  const player = makePlayer(() => {
    throw failure
  })

  const runtime = ManagedRuntime.make(ExpoAudioEngineLayer(() => player, 'native'))

  const error = await runtime.runPromise(
    Effect.gen(function* () {
      const engine = yield* AudioEngine
      yield* engine.replace('https://cdn.example/track.mp3', 1)

      return yield* Effect.flip(engine.play)
    }),
  )

  await runtime.dispose()

  expect(error).toBeInstanceOf(PlaybackRejected)
  expect(error.cause).toBe(failure)
})

test('drives player settings and source state through a complete replace-and-reset workflow', async () => {
  const player = makePlayer(() => undefined)

  const runtime = ManagedRuntime.make(ExpoAudioEngineLayer(() => player, 'native'))

  const statuses = await runtime.runPromise(
    Effect.gen(function* () {
      const engine = yield* AudioEngine
      yield* engine.setVolume(0.25)
      yield* engine.setMuted(true)
      yield* engine.replace('https://cdn.example/track.mp3', 9)
      const loaded = yield* engine.currentStatus
      yield* engine.clearSource
      const cleared = yield* engine.currentStatus

      return { loaded, cleared }
    }),
  )

  await runtime.dispose()

  expect(player.volume).toBe(0.25)
  expect(player.muted).toBe(true)
  expect(statuses.loaded.sourceGeneration).toBe(9)
  expect(statuses.cleared.sourceGeneration).toBeNull()
  expect(statuses.cleared.isLoaded).toBe(false)
})
