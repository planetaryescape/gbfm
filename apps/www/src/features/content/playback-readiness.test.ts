import { Component } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { Locator, Story, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type { QueueTrackType } from '@gbfm/player'
import { Effect, Layer, Predicate, Queue, Schema, Stream } from 'effect'

import { PerformPlayer } from '../player/commands'
import {
  initialModel,
  initialSnapshot,
  PlayerOperation,
  type PlayerSnapshot,
} from '../player/domain'
import { PlayerProvider, playerServerLayer } from '../player/provider'
import { PlayerSnapshotSource } from '../player/subscriptions'
import { runWithLayer } from '../player/testing'
import {
  PlaybackControls,
  PlaybackControlsMessage,
  PlaylistControls,
  PlaylistControlsMessage,
} from './playback-controls'

const track: QueueTrackType = {
  id: 'readiness-fixture',
  slug: 'readiness-fixture',
  title: 'Readiness fixture',
  url: '/api/e2e-audio.wav',
  thumbnailUrl: null,
  type: 'mix',
}

const shared = {
  ...initialModel,
  returnTo: '/mixes',
  principalId: null,
  principalKnown: true,
}

const Harness = Html.component({
  name: 'PlaybackReadinessHarness',
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    PlayerProvider(h, {
      props: { principalId: null, principalKnown: true, returnTo: '/mixes' },
      view: () =>
        h.main.children(
          PlaybackControls(h, { props: { track, enqueue: true } }),
          PlaylistControls(h, { props: { tracks: [track] } }),
        ),
    }),
})

it.effect('ignores directly dispatched play and queue intents before player initialization', () =>
  Effect.gen(function* () {
    const playback = yield* Story.make(PlaybackControls, { track, enqueue: true })
    playback
      .shared(PlayerProvider, shared)
      .send(PlaybackControlsMessage.ClickedPlay())
      .send(PlaybackControlsMessage.ClickedEnqueue())
    assert.deepStrictEqual(playback.current.sent, [])
    const playlist = yield* Story.make(PlaylistControls, { tracks: [track] })
    playlist
      .shared(PlayerProvider, shared)
      .send(PlaylistControlsMessage.ClickedPlayAll())
      .send(PlaylistControlsMessage.ClickedQueueAll())
    assert.deepStrictEqual(playlist.current.sent, [])
  }),
)

it('server-renders every playback and queue control disabled while the provider is present', async () => {
  const rendered = await runWithLayer(playerServerLayer, HtmlServer.renderToHtml(Harness, {}))
  const buttons = rendered.html.match(/<button\b[^>]*>/g) ?? []
  assert.equal(buttons.length, 4)
  assert.ok(buttons.every((button) => /\bdisabled(?:[=>\s]|$)/.test(button)))
  assert.ok(rendered.html.includes('Play all'))
  assert.ok(rendered.html.includes('Queue all'))
  assert.ok(rendered.html.includes('aria-label="Play"'))
  assert.ok(rendered.html.includes('aria-label="Add to queue"'))
})

it('enables all controls after an initialized snapshot and preserves their actual provider commands', async () => {
  let publish: (snapshot: PlayerSnapshot) => void = () => undefined
  const operations: Array<typeof PlayerOperation.Type> = []

  const source = Layer.succeed(PlayerSnapshotSource, {
    snapshots: Stream.callback<PlayerSnapshot>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          publish = (snapshot) => {
            Queue.offerUnsafe(queue, snapshot)
          }

          publish(initialSnapshot)
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

      const disabled = () =>
        root.all(Locator.tag('button')).map((node) => {
          if (!Predicate.isTagged(node, 'Element')) throw new Error('Expected a playback button')

          return node.attrs.disabled !== undefined
        })

      assert.deepStrictEqual(disabled(), [true, true, true, true])
      operations.length = 0
      publish({
        ...initialSnapshot,
        transport: { ...initialSnapshot.transport, isInitialized: true },
      })
      yield* TestHost.settle
      assert.deepStrictEqual(disabled(), [false, false, false, false])

      for (const label of ['Play', 'Add to queue']) {
        Locator.fire(root.get(Locator.attr('aria-label', label)), 'click')
        yield* TestHost.settle
      }

      for (const label of ['Play all', 'Queue all']) {
        Locator.fire(root.get(Locator.text(label)), 'click')
        yield* TestHost.settle
      }

      assert.deepStrictEqual(operations, [
        PlayerOperation.PlayTrack({ track }),
        PlayerOperation.Enqueue({ track }),
        PlayerOperation.PlayAll({ tracks: [track] }),
        PlayerOperation.EnqueueAll({ tracks: [track] }),
      ])
    }),
  )
})
