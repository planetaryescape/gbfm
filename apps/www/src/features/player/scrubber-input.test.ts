import { Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate, Queue, Schema, Stream } from 'effect'
import { expect, it } from 'vitest'

import { PerformPlayer } from './commands'
import {
  initialSnapshot,
  PlayerControlMessage,
  PlayerOperation,
  type PlayerSnapshot,
} from './domain'
import { PlayerProvider } from './provider'
import { Scrubber } from './scrubber'
import { PlayerSnapshotSource } from './subscriptions'
import { runWithLayer } from './testing'

const paused = {
  ...initialSnapshot,
  transport: {
    ...initialSnapshot.transport,
    isInitialized: true,
    isLoaded: true,
    currentTime: 0.9,
    duration: 30,
  },
}

const ScrubberInput = Html.component({
  name: 'ScrubberInput',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) =>
    Scrubber(h, {
      currentTime: h.reads.provider.snapshot.transport.currentTime,
      duration: h.reads.provider.snapshot.transport.duration,
      trackId: 'keyboard-fixture',
      preview: h.reads.provider.seekPreview,
      isOpen: false,
    }),
})

const Harness = Html.component({
  name: 'ScrubberInputHarness',
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    PlayerProvider(h, {
      props: { principalId: null, principalKnown: true, returnTo: '/mixes' },
      view: () => ScrubberInput(h, {}),
    }),
})

it('keeps both controlled inputs at the requested tenth second before the engine acknowledges', async () => {
  let publish: (snapshot: PlayerSnapshot) => void = () => undefined
  const operations: Array<typeof PlayerOperation.Type> = []

  const source = Layer.succeed(PlayerSnapshotSource, {
    snapshots: Stream.callback<PlayerSnapshot>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          publish = (snapshot) => {
            Queue.offerUnsafe(queue, snapshot)
          }

          publish(paused)
        }),
        () =>
          Effect.sync(() => {
            publish = () => undefined
          }),
      ),
    ),
  })

  const commands = PerformPlayer.toLayer(({ operation }) =>
    Effect.sync(() => {
      operations.push(operation)

      return Component.noop
    }),
  )

  await runWithLayer(
    Layer.mergeAll(TestHost.layer(), source, commands),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(Harness, {})
      yield* TestHost.settle
      operations.length = 0

      const inputs = () =>
        root.all(Locator.tag('input')).map((node) => {
          if (!Predicate.isTagged(node, 'Element')) throw new Error('Expected a range input')

          return node
        })

      expect(inputs().map((input) => input.attrs.step)).toEqual(['0.1', '0.1'])

      for (const seconds of [0, 0.1, 0, 30, 0, 0.1]) {
        Locator.fire(root.get(Locator.attr('class', 'hill-scrubber-input')), 'input', {
          value: String(seconds),
        })
        yield* TestHost.settle
        expect(inputs().map((input) => input.props.value)).toEqual([
          String(seconds),
          String(seconds),
        ])
      }

      expect(operations).toEqual(
        [0, 0.1, 0, 30, 0, 0.1].map((seconds) => PlayerOperation.Seek({ seconds })),
      )
      publish({
        ...paused,
        transport: { ...paused.transport, currentTime: 0.1 },
      })
      yield* TestHost.settle
      expect(inputs().map((input) => input.props.value)).toEqual(['0.1', '0.1'])
      publish(paused)
      yield* TestHost.settle
      expect(inputs().map((input) => input.props.value)).toEqual(['0.9', '0.9'])
    }),
  )
})
