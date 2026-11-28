import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { JourneyExporter, observabilityLayer } from '@gbfm/observability'
import type { QueueTrackType } from '@gbfm/player'
import { Effect, Layer, Schedule, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { makePlayerClientLayer, type AudioPort } from '../../player/runtime'
import { PlayerControlMessage, PlayerProviderMessage } from './domain'
import { PlayerProvider, playerCommandsLayer } from './provider'
import { runWithLayer } from './testing'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class NativeTestAudio extends EventTarget implements AudioPort {
  src = ''
  currentTime = 0
  duration = 120
  paused = true
  ended = false
  readyState = 4
  volume = 1
  muted = false
  load() {
    this.dispatchEvent(new Event('loadedmetadata'))
  }
  removeAttribute() {
    this.src = ''
  }
  async play() {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
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

const first = track('First native mix')

const second = track('Second native mix')

const NativeProbe = Html.component({
  name: 'NativePlayerProbe',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const snapshot = h.reads.provider.snapshot

    return h.div.children(
      h.button
        .attr('aria-label', 'Play first')
        .on('click', PlayerProviderMessage.RequestedPlayTrack({ track: first }))
        .children('Play first'),
      h.button
        .attr('aria-label', 'Enqueue second')
        .on('click', PlayerProviderMessage.RequestedEnqueue({ track: second }))
        .children('Enqueue second'),
      h.button
        .attr('aria-label', 'Seek')
        .on('click', PlayerProviderMessage.RequestedSeek({ seconds: 42 }))
        .children('Seek'),
      h.button
        .attr('aria-label', 'Next')
        .on('click', PlayerProviderMessage.RequestedNext())
        .children('Next'),
      h.button
        .attr('aria-label', 'Reorder')
        .on('click', PlayerProviderMessage.RequestedReorder({ from: 1, to: 0 }))
        .children('Reorder'),
      h.button
        .attr('aria-label', 'Volume')
        .on('click', PlayerProviderMessage.RequestedVolume({ volume: 30 }))
        .children('Volume'),
      h.button
        .attr('aria-label', 'Mute')
        .on('click', PlayerProviderMessage.RequestedToggleMute())
        .children('Mute'),
      h.button
        .attr('aria-label', 'Clear')
        .on('click', PlayerProviderMessage.RequestedClear())
        .children('Clear'),
      h.output.attr('data-testid', 'snapshot').children(JSON.stringify(snapshot)),
    )
  },
})

const TestAppMessage = UiSchema.TaggedEnum({
  ChangedPage: { path: Schema.String },
  ChangedPrincipal: { principalId: Schema.NullOr(Schema.String) },
})

const NativeApp = Html.component({
  name: 'NativePlayerTestApp',
  model: Schema.Struct({ path: Schema.String, principalId: Schema.NullOr(Schema.String) }),
  message: TestAppMessage,
}).make({
  init: () => ({ path: '/mixes', principalId: null }),
  update: {
    ChangedPage: ($, { path }) => $.evolve({ path }),
    ChangedPrincipal: ($, { principalId }) => $.evolve({ principalId }),
  },
  view: (h, model) =>
    PlayerProvider(h, {
      key: 'persistent',
      props: { principalId: model.principalId, principalKnown: true, returnTo: model.path },
      view: () => h.main.children(h.p(model.path), NativeProbe(h, {})),
    }),
})

const fixture = () => {
  const storage = new MemoryStorage()
  const instances: Array<NativeTestAudio> = []
  let acquisitions = 0

  const client = makePlayerClientLayer({
    createAudio: () => {
      acquisitions++
      const audio = new NativeTestAudio()
      instances.push(audio)

      return audio
    },
    storage: () => storage,
    deliverPlay: () => Effect.void,
    reporter: {},
  }).pipe(
    Layer.provide(
      observabilityLayer.pipe(
        Layer.provide(
          Layer.succeed(JourneyExporter, {
            open: () => Effect.succeed({ finish: () => Effect.void }),
          }),
        ),
      ),
    ),
  )

  return {
    storage,
    instances,
    acquisitions: () => acquisitions,
    layer: playerCommandsLayer.pipe(Layer.provide(client)),
  }
}

describe('native player with the real browser engine service seam', () => {
  it('keeps one source and subscription through page and principal changes, seeks, and persists queue and volume', async () => {
    const f = fixture()
    await runWithLayer(
      Layer.merge(f.layer, TestHost.layer()),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(NativeApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'Play first')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain(first.title)
        const audio = f.instances.at(-1)
        expect(audio?.src).toBe(first.url)
        const beforeNavigation = f.acquisitions()
        root.send(TestAppMessage.ChangedPage({ path: '/editorial/fixture' }))
        root.send(TestAppMessage.ChangedPrincipal({ principalId: 'listener' }))
        yield* TestHost.settle
        expect(f.acquisitions()).toBe(beforeNavigation)
        expect(root.text()).toContain(first.title)
        Locator.fire(root.get(Locator.attr('aria-label', 'Seek')), 'click')
        yield* TestHost.settle
        expect(audio?.currentTime).toBe(42)
        Locator.fire(root.get(Locator.attr('aria-label', 'Enqueue second')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain(second.title)
        Locator.fire(root.get(Locator.attr('aria-label', 'Volume')), 'click')
        yield* TestHost.settle
        expect(audio?.volume).toBeCloseTo(0.3)
        Locator.fire(root.get(Locator.attr('aria-label', 'Mute')), 'click')
        yield* TestHost.settle
        expect(audio?.muted).toBe(true)
        yield* Effect.promise(async () => {
          await expect
            .poll(() => f.storage.getItem('gbfm-audio-queue.json'), {
              timeout: 1000,
              interval: 5,
            })
            .toContain(second.id)
        })
        yield* Effect.promise(async () => {
          await expect
            .poll(() => f.storage.getItem('gbfm-audio-volume.json'), {
              timeout: 1000,
              interval: 5,
            })
            .toContain('30')
        })
        Locator.fire(root.get(Locator.attr('aria-label', 'Reorder')), 'click')
        yield* TestHost.settle
        yield* Effect.promise(async () => {
          await expect
            .poll(() => f.storage.getItem('gbfm-audio-queue.json'), {
              timeout: 1000,
              interval: 5,
            })
            .toContain('"currentIndex":1')
        })
        Locator.fire(root.get(Locator.attr('aria-label', 'Clear')), 'click')
        yield* TestHost.settle
        expect(audio?.src).toBe('')
        expect(root.text()).toContain('"current":null')
      }),
    )
    expect(f.instances.every((audio) => audio.paused && audio.src === '')).toBe(true)
  })

  it('hydrates the stored queue and volume without autoplay and uses the restored track on transport requests', async () => {
    const f = fixture()
    f.storage.setItem(
      'gbfm-audio-queue.json',
      JSON.stringify({ tracks: [first, second], currentIndex: 0 }),
    )
    f.storage.setItem('gbfm-audio-volume.json', JSON.stringify({ volume: 65, isMuted: true }))
    await runWithLayer(
      Layer.merge(f.layer, TestHost.layer()),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(NativeApp, {})
        yield* TestHost.settle.pipe(
          Effect.repeat({
            while: () => !root.text().includes(first.title),
            schedule: Schedule.spaced('1 millis'),
          }),
          Effect.timeout('1 second'),
        )
        expect(root.text()).toContain(first.title)
        expect(root.text()).toContain('"isPlaying":false')
        expect(root.text()).toContain('"volume":65')
        expect(root.text()).toContain('"isMuted":true')
        Locator.fire(root.get(Locator.attr('aria-label', 'Next')), 'click')
        yield* TestHost.settle
        expect(f.instances.at(-1)?.src).toBe(second.url)
      }),
    )
  })
})
