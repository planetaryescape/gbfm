import { Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, Scene, Story } from '@effect/ui/testing'
import { QueueTrack } from '@gbfm/player'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { PerformPlayer } from './commands'
import {
  initialModel,
  PlayerOperation,
  PlayerProviderMessage as M,
  PlayerProviderModel,
  PlayerProviderProps,
} from './domain'
import { PlayerProvider, updatePlayerProvider } from './provider'
import { QueuePlayer } from './queue'

const track = QueueTrack.make({
  id: 'scrubber-track',
  title: 'Scrubber fixture',
  slug: 'scrubber-fixture',
  url: '/scrubber.wav',
  type: 'mix',
  thumbnailUrl: null,
})

const props = { principalId: null, principalKnown: true, returnTo: '/mixes' }

const PlayerState = Html.component({
  name: 'RetirementPlayerState',
  props: PlayerProviderProps,
  model: PlayerProviderModel,
  message: M,
}).make({
  init: () => initialModel,
  update: updatePlayerProvider,
  view: (h) => h.text(''),
})

const playing = {
  ...initialModel,
  fullscreenOpen: true,
  snapshot: {
    ...initialModel.snapshot,
    queue: { tracks: [track], currentIndex: 0, current: track },
    transport: { ...initialModel.snapshot.transport, currentTime: 60, duration: 7200 },
  },
}

const preview = {
  trackId: track.id,
  seconds: 75,
  fine: true,
  referenceSeconds: 60,
  pointerRatio: 0.75,
}

it('a fine hill preview preserves the snapshot, commits exactly 15 seconds once, cancels without commands and clears on close', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)

        const message = M.PreviewedSeek({
          trackId: track.id,
          seconds: 15,
          fine: true,
          referenceSeconds: 60,
          pointerRatio: 0.5,
        })

        s.given(playing).send(message).expectNone()
        expect(s.model.snapshot).toBe(playing.snapshot)
        expect(s.model.seekPreview).toEqual({
          seconds: 15,
          fine: true,
          referenceSeconds: 60,
          pointerRatio: 0.5,
        })
        s.send(M.CommittedSeek({ trackId: track.id, seconds: 15 })).expectExact(
          PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 15 }) }),
        )
        expect(s.model.seekPreview).toBeNull()
        expect(s.model.snapshot.transport.currentTime).toBe(15)
        s.resolve(PerformPlayer, Component.noop)
        s.send(message)
          .send(M.CancelledSeek({ trackId: track.id }))
          .expectNone()
        expect(s.model.seekPreview).toBeNull()
        s.send(message).send(M.RequestedCloseFullscreen()).expectNone()
        expect(s.model.seekPreview).toBeNull()
      }),
    ),
  ))

it('closing and reopening cannot replay a stale scrubber commit while external seeking still works', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)

        const message = M.PreviewedSeek({
          trackId: track.id,
          seconds: 15,
          fine: false,
          referenceSeconds: 60,
          pointerRatio: 0.5,
        })

        s.given(playing).send(message).send(M.RequestedCloseFullscreen()).expectNone()
        expect(s.model.fullscreenOpen).toBe(false)
        const closed = s.model

        s.send(message)
          .send(M.CommittedSeek({ trackId: track.id, seconds: 15 }))
          .expectNone()
        expect(s.model).toBe(closed)
        s.send(M.RequestedToggleFullscreen()).expectNone()
        const reopened = s.model

        s.send(M.CommittedSeek({ trackId: track.id, seconds: 15 })).expectNone()
        expect(s.model).toBe(reopened)
        s.send(M.RequestedCloseFullscreen())
          .send(M.RequestedSeek({ seconds: 20 }))
          .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 20 }) }))
          .resolve(PerformPlayer, Component.noop)
      }),
    ),
  ))

it('ports every fine preview field across ticks, rejects old-track preview/cancel/commit, and external seek clears the active preview', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)
        s.given(playing).send(M.PreviewedSeek(preview)).expectNone()
        expect(s.model.snapshot).toBe(playing.snapshot)
        const expected = { seconds: 75, fine: true, referenceSeconds: 60, pointerRatio: 0.75 }
        expect(s.model.seekPreview).toEqual(expected)
        s.send(
          M.ChangedSnapshot({
            snapshot: {
              ...playing.snapshot,
              transport: { ...playing.snapshot.transport, currentTime: 63 },
            },
          }),
        ).expectNone()
        expect(s.model.seekPreview).toEqual(expected)
        const next = { ...track, id: 'next-track' }
        s.send(
          M.ChangedSnapshot({
            snapshot: {
              ...s.model.snapshot,
              queue: { tracks: [next], currentIndex: 0, current: next },
            },
          }),
        ).expectNone()
        expect(s.model.seekPreview).toBeNull()
        const replaced = s.model
        s.send(M.PreviewedSeek(preview))
          .send(M.CommittedSeek({ trackId: track.id, seconds: 75 }))
          .send(M.CancelledSeek({ trackId: track.id }))
          .expectNone()
        expect(s.model).toBe(replaced)
        s.send(
          M.PreviewedSeek({
            trackId: next.id,
            seconds: 10,
            fine: false,
            referenceSeconds: 63,
            pointerRatio: 0.25,
          }),
        ).expectNone()
        const fresh = s.model
        s.send(M.CancelledSeek({ trackId: track.id })).expectNone()
        expect(s.model).toBe(fresh)
        s.send(M.RequestedSeek({ seconds: 11 })).expectExact(
          PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 11 }) }),
        )
        expect(s.model.seekPreview).toBeNull()
        s.resolve(PerformPlayer, Component.noop)
      }),
    ),
  ))

it('ports one queue drag payload into one reorder and ignores a second drop with no new drag payload', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const tracks = [track, { ...track, id: 'two' }, { ...track, id: 'three' }]

        const provider = {
          ...initialModel,
          ...props,
          queueOpen: true,
          snapshot: {
            ...initialModel.snapshot,
            queue: { tracks, currentIndex: 0, current: track },
          },
        }

        const s = yield* Scene.make(QueuePlayer, {})

        const firstRow: Locator.Locator = {
          description: 'first queue row',
          all: (root) => Locator.tag('li').all(root).slice(0, 1),
        }

        s.given(null, {}, [[PlayerProvider, provider]])
        s.fire(firstRow, 'drop', {
          data: { 'application/x-gbfm-queue-index': JSON.stringify({ index: 2 }) },
        }).sent(PlayerProvider, M.RequestedReorder({ from: 2, to: 0 }))
        s.fire(firstRow, 'drop', { data: {} })
        expect(s.current.sent).toEqual([])
        const engine = yield* Story.make(PlayerState, props)

        engine
          .given({ ...initialModel, snapshot: provider.snapshot })
          .send(M.RequestedReorder({ from: 2, to: 0 }))
          .expectExact(
            PerformPlayer.make({
              operation: PlayerOperation.Reorder({ from: 2, to: 0 }),
            }),
          )
          .resolve(PerformPlayer, Component.noop)
      }),
    ),
  ))

it('guards closed, entering and already-owned sheets and rejects another pointer release without commands', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)
        const start = M.StartedPlayerDrag({ pointerId: 1, clientY: 100 })
        s.send(start).expectNone()
        expect(s.model).toBe(initialModel)
        s.send(M.RequestedToggleFullscreen()).expectNone()
        expect(s.model.fullscreenSettled).toBe(false)
        const entering = s.model
        s.send(start).expectNone()
        expect(s.model).toBe(entering)
        s.send(M.SettledFullscreen({ open: true }))
          .send(start)
          .expectNone()
        const owned = s.model
        s.send(M.StartedPlayerDrag({ pointerId: 2, clientY: 200 }))
          .send(M.ReleasedPlayerDrag({ pointerId: 2, clientY: 500, viewportHeight: 800 }))
          .expectNone()
        expect(s.model).toBe(owned)
        s.send(M.CancelledPlayerDrag()).expectNone()
        expect(s.model.playerDrag).toBeNull()
        s.given(initialModel).send(M.CancelledPlayerDrag()).expectNone()
        expect(s.model).toBe(initialModel)
      }),
    ),
  ))

it('follows the active pointer down by 80 pixels, ignores other movement and snaps a short release without closing', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)
        s.given({ ...playing, fullscreenSettled: true })
          .send(M.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
          .send(M.MovedPlayerDrag({ pointerId: 1, clientY: 180 }))
          .expectNone()
        expect(s.model.playerOffset).toBe(80)
        const moved = s.model
        s.send(M.MovedPlayerDrag({ pointerId: 2, clientY: 400 })).expectNone()
        expect(s.model).toBe(moved)
        s.send(
          M.ReleasedPlayerDrag({ pointerId: 1, clientY: 180, viewportHeight: 800 }),
        ).expectNone()
        expect(s.model).toMatchObject({ playerDrag: null, playerOffset: 0, fullscreenOpen: true })
      }),
    ),
  ))

it('closes beyond the pull threshold and preserves all 170 release pixels for the exit animation', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)
        s.given({ ...playing, fullscreenSettled: true })
          .send(M.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
          .send(M.ReleasedPlayerDrag({ pointerId: 1, clientY: 270, viewportHeight: 800 }))
          .expectNone()
        expect(s.model).toMatchObject({
          fullscreenOpen: false,
          playerOffset: 170,
          playerDrag: null,
        })
      }),
    ),
  ))

it('clamps upward movement to zero and cancelling a moved sheet resets ownership and offset without closing', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(PlayerState, props)
        s.given({ ...playing, fullscreenSettled: true })
          .send(M.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
          .send(M.MovedPlayerDrag({ pointerId: 1, clientY: 80 }))
          .expectNone()
        expect(s.model.playerOffset).toBe(0)
        s.send(M.MovedPlayerDrag({ pointerId: 1, clientY: 300 }))
          .send(M.CancelledPlayerDrag())
          .expectNone()
        expect(s.model).toMatchObject({ fullscreenOpen: true, playerOffset: 0, playerDrag: null })
      }),
    ),
  ))
