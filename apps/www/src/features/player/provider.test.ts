import { Component } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import type { QueueTrackType } from '@gbfm/player'
import { Effect, Layer, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { PlayerClient } from '../../player/runtime'
import { MembershipProvider, membershipCommandsLayer } from '../public-actions/provider'
import { PerformPlayer } from './commands'
import {
  initialModel,
  initialSnapshot,
  PlayerOperation,
  PlayerProviderMessage,
  PlayerProviderModel,
  PlayerProviderProps,
} from './domain'
import {
  PlayerProvider,
  playerCommandsLayer,
  playerServerLayer,
  updatePlayerProvider,
} from './provider'
import { subscriptions, PlayerSnapshotSource } from './subscriptions'
import { runWithLayer } from './testing'
import { PersistentPlayer } from './view'

const PlayerState = Html.component({
  name: 'PlayerState',
  props: PlayerProviderProps,
  model: PlayerProviderModel,
  message: PlayerProviderMessage,
}).make({
  init: () => initialModel,
  update: updatePlayerProvider,
  subscriptions,
  view: (h) => h.text(''),
})

const props = { principalId: 'listener', principalKnown: true, returnTo: '/mixes/fixture' }

const track: QueueTrackType = {
  id: 'fixture',
  slug: 'fixture',
  title: 'Fixture mix',
  url: '/fixture.mp3',
  thumbnailUrl: null,
  type: 'mix',
}

const playing: PlayerProviderModel = {
  ...initialModel,
  fullscreenOpen: true,
  snapshot: {
    ...initialSnapshot,
    queue: { tracks: [track], currentIndex: 0, current: track },
    transport: { ...initialSnapshot.transport, currentTime: 60, duration: 7200 },
  },
}

describe('native seek receipt ownership', () => {
  it('keeps the pending target through old snapshots and cancellation, then commits one preview', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.given(playing)
            .send(PlayerProviderMessage.RequestedSeek({ seconds: 0 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 0 }) }))
            .keepPending(PerformPlayer)
          s.send(
            PlayerProviderMessage.ChangedSnapshot({
              snapshot: {
                ...playing.snapshot,
                volume: { volume: 25, isMuted: true },
              },
            }),
          )
          expect(s.model.snapshot.transport.currentTime).toBe(0)
          expect(s.model.snapshot.volume).toEqual({ volume: 25, isMuted: true })
          expect(s.model.pendingSeek).toEqual({ sequence: 1, seconds: 0 })

          const preview = PlayerProviderMessage.PreviewedSeek({
            trackId: track.id,
            seconds: 15,
            fine: false,
            referenceSeconds: 0,
            pointerRatio: 0.4,
          })

          s.send(preview).send(PlayerProviderMessage.CancelledSeek({ trackId: track.id }))
          expect(s.model.seekPreview).toBeNull()
          expect(s.model.pendingSeek?.seconds).toBe(0)
          s.send(preview).resolve(PerformPlayer, Component.noop)
          expect(s.model.pendingSeek).toBeNull()
          expect(s.model.seekPreview?.seconds).toBe(15)
          s.send(PlayerProviderMessage.CommittedSeek({ trackId: track.id, seconds: 15 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 15 }) }))
            .resolve(PerformPlayer, Component.noop)
          expect(s.model.snapshot.transport.currentTime).toBe(15)
          expect(s.model.pendingSeek).toBeNull()
          s.send(PlayerProviderMessage.CommittedSeek({ trackId: track.id, seconds: 15 }))
          expect(s.pending).toEqual([])
        }),
      ),
    ))

  it('rejects old and wrong-track receipts through newer seeks and track replacement', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.given(playing)
            .send(PlayerProviderMessage.RequestedSeek({ seconds: 0 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 0 }) }))
            .keepPending(PerformPlayer)
          s.send(PlayerProviderMessage.RequestedSeek({ seconds: 10 }))
            .expectExact(
              PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 0 }) }),
              PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 10 }) }),
            )
            .keepPending(PerformPlayer)
          s.send(PlayerProviderMessage.CompletedSeek({ sequence: 1, trackId: track.id }))
          s.send(PlayerProviderMessage.CompletedSeek({ sequence: 2, trackId: 'other-track' }))
          expect(s.model.pendingSeek).toEqual({ sequence: 2, seconds: 10 })
          const other = { ...track, id: 'other-track' }
          s.send(
            PlayerProviderMessage.ChangedSnapshot({
              snapshot: {
                ...playing.snapshot,
                queue: { tracks: [other], currentIndex: 0, current: other },
              },
            }),
          )
          expect(s.model.pendingSeek).toBeNull()
          s.resolve(
            PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 0 }) }),
            Component.noop,
          ).resolve(
            PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 10 }) }),
            Component.noop,
          )
          expect(s.model.snapshot.queue.current?.id).toBe(other.id)
          expect(s.model.snapshot.transport.currentTime).toBe(60)
          s.send(PlayerProviderMessage.ChangedSnapshot({ snapshot: playing.snapshot }))
            .send(PlayerProviderMessage.RequestedSeek({ seconds: 20 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 20 }) }))
            .keepPending(PerformPlayer)
          s.send(PlayerProviderMessage.CompletedSeek({ sequence: 1, trackId: track.id }))
          expect(s.model.pendingSeek).toEqual({ sequence: 3, seconds: 20 })
          s.resolve(PerformPlayer, Component.noop)
          expect(s.model.pendingSeek).toBeNull()
        }),
      ),
    ))
})

describe('native PlayerProvider', () => {
  it('maps visible queue actions to their engine indices when ungranted private rows are hidden', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)

          const privateTrack = {
            ...track,
            id: 'private-fixture',
            url: 'https://cdn.fixture.test/user-content/private/fixture/song.wav',
          }

          const next = { ...track, id: 'next' }
          s.given({
            ...playing,
            snapshot: {
              ...playing.snapshot,
              queue: { tracks: [privateTrack, track, next], currentIndex: 1, current: track },
            },
          })
          s.send(PlayerProviderMessage.RequestedPlayIndex({ index: 0 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.PlayIndex({ index: 1 }) }))
            .resolve(PerformPlayer, Component.noop)
          s.send(PlayerProviderMessage.RequestedRemove({ index: 0 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Remove({ index: 1 }) }))
            .resolve(PerformPlayer, Component.noop)
          s.send(PlayerProviderMessage.RequestedReorder({ from: 0, to: 1 }))
            .expectExact(
              PerformPlayer.make({ operation: PlayerOperation.Reorder({ from: 1, to: 2 }) }),
            )
            .resolve(PerformPlayer, Component.noop)
          expect(s.model.snapshot.queue.tracks).toEqual([privateTrack, track, next])
        }),
      ),
    ))
  it('owns queue and fullscreen independently and closes both explicitly', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          expect(s.subscriptions).toEqual([
            'playerPrincipal:true,"listener",false',
            'playerSnapshots',
          ])
          s.send(PlayerProviderMessage.RequestedToggleQueue())
          s.send(PlayerProviderMessage.RequestedToggleFullscreen())
          expect(s.model.queueOpen).toBe(true)
          expect(s.model.fullscreenOpen).toBe(true)
          s.send(PlayerProviderMessage.RequestedCloseQueue())
          expect(s.model.queueOpen).toBe(false)
          expect(s.model.fullscreenOpen).toBe(true)
          s.send(PlayerProviderMessage.RequestedCloseFullscreen())
          expect(s.model).toMatchObject({
            queueOpen: false,
            fullscreenOpen: false,
            seekPreview: null,
          })
        }),
      ),
    ))

  it('issues native transport Commands without performing effects in update', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.send(PlayerProviderMessage.RequestedSeek({ seconds: 42 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 42 }) }))
            .resolve(PerformPlayer, Component.noop)
          expect(s.model.snapshot).toEqual(initialSnapshot)
          s.send(PlayerProviderMessage.RequestedPlayTrack({ track }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.PlayTrack({ track }) }))
            .resolve(PerformPlayer, Component.noop)
          expect(s.model.fullscreenOpen).toBe(true)
        }),
      ),
    ))

  it('previews fine seeks without executing them, commits only for the current open track, and cancels', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.given(playing).send(
            PlayerProviderMessage.PreviewedSeek({
              trackId: track.id,
              seconds: 15,
              fine: true,
              referenceSeconds: 60,
              pointerRatio: 0.5,
            }),
          )
          expect(s.pending).toEqual([])
          expect(s.model.snapshot.transport.currentTime).toBe(60)
          expect(s.model.seekPreview?.fine).toBe(true)
          s.send(
            PlayerProviderMessage.ChangedSnapshot({
              snapshot: {
                ...playing.snapshot,
                transport: { ...playing.snapshot.transport, currentTime: 63 },
              },
            }),
          )
          expect(s.model.seekPreview?.seconds).toBe(15)
          s.send(PlayerProviderMessage.CommittedSeek({ trackId: track.id, seconds: 15 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 15 }) }))
            .resolve(PerformPlayer, Component.noop)
          expect(s.model.snapshot.transport.currentTime).toBe(15)
          expect(s.model.seekPreview).toBeNull()
          s.send(
            PlayerProviderMessage.PreviewedSeek({
              trackId: track.id,
              seconds: 22,
              fine: false,
              referenceSeconds: 15,
              pointerRatio: 0.6,
            }),
          ).send(PlayerProviderMessage.CancelledSeek({ trackId: track.id }))
          expect(s.model.seekPreview).toBeNull()
          s.send(PlayerProviderMessage.RequestedCloseFullscreen()).send(
            PlayerProviderMessage.CommittedSeek({ trackId: track.id, seconds: 90 }),
          )
          expect(s.pending).toEqual([])
          s.send(PlayerProviderMessage.RequestedToggleFullscreen()).send(
            PlayerProviderMessage.CommittedSeek({ trackId: track.id, seconds: 90 }),
          )
          expect(s.pending).toEqual([])
        }),
      ),
    ))

  it('discards stale track gestures but preserves deliberate external seeking while closed', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.given(playing).send(
            PlayerProviderMessage.PreviewedSeek({
              trackId: track.id,
              seconds: 80,
              fine: true,
              referenceSeconds: 60,
              pointerRatio: 0.8,
            }),
          )
          const next = { ...track, id: 'next' }
          s.send(
            PlayerProviderMessage.ChangedSnapshot({
              snapshot: {
                ...playing.snapshot,
                queue: { tracks: [next], currentIndex: 0, current: next },
              },
            }),
          ).send(PlayerProviderMessage.CommittedSeek({ trackId: track.id, seconds: 80 }))
          expect(s.model.seekPreview).toBeNull()
          expect(s.pending).toEqual([])
          s.send(PlayerProviderMessage.RequestedCloseFullscreen())
            .send(PlayerProviderMessage.RequestedSeek({ seconds: 20 }))
            .expectExact(PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds: 20 }) }))
            .resolve(PerformPlayer, Component.noop)
        }),
      ),
    ))

  it('retains playback and queue identity when principal and return path props change', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.given(playing).props({
            principalId: 'another-listener',
            principalKnown: true,
            returnTo: '/shows',
          })
          expect(s.model.snapshot).toEqual(playing.snapshot)
          expect(s.model.fullscreenOpen).toBe(true)
          expect(s.subscriptions).toEqual([
            'playerPrincipal:true,"another-listener",false',
            'playerSnapshots',
          ])
          expect(PlayerProvider.definition.restore).toBe(false)
        }),
      ),
    ))

  it('gates sheet drag during entry, rejects other pointers, resets a short drag and dismisses past the threshold', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerState, props)
          s.send(PlayerProviderMessage.RequestedToggleFullscreen()).send(
            PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 0 }),
          )
          expect(s.model.playerDrag).toBeNull()
          s.send(PlayerProviderMessage.SettledFullscreen({ open: true }))
            .send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 0 }))
            .send(PlayerProviderMessage.MovedPlayerDrag({ pointerId: 2, clientY: 250 }))
          expect(s.model.playerOffset).toBe(0)
          s.send(
            PlayerProviderMessage.ReleasedPlayerDrag({
              pointerId: 1,
              clientY: 25,
              viewportHeight: 600,
            }),
          )
          expect(s.model).toMatchObject({ playerDrag: null, playerOffset: 0, fullscreenOpen: true })
          s.send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 0 })).send(
            PlayerProviderMessage.ReleasedPlayerDrag({
              pointerId: 1,
              clientY: 130,
              viewportHeight: 600,
            }),
          )
          expect(s.model).toMatchObject({ playerDrag: null, fullscreenOpen: false })
        }),
      ),
    ))

  it('renders descendants on the server without browser resources or subtree deferral', async () => {
    let snapshotAcquisitions = 0
    let browserEventAcquisitions = 0
    let browserEngineAcquisitions = 0

    const recordedServer = Layer.effect(
      PlayerSnapshotSource,
      Effect.sync(() => {
        snapshotAcquisitions++

        return {
          snapshots: Stream.unwrap(
            Effect.sync(() => {
              browserEventAcquisitions++

              return Stream.empty
            }),
          ),
        }
      }),
    )

    const resources = {
      client: playerCommandsLayer.pipe(
        Layer.provide(
          Layer.effect(
            PlayerClient,
            Effect.sync(() => {
              browserEngineAcquisitions++
            }).pipe(
              Effect.andThen(Effect.die(new Error('A browser engine must not be acquired by SSR'))),
            ),
          ),
        ),
      ),
      server: Layer.merge(playerServerLayer, recordedServer),
    }

    const ServerPage = Html.component({
      name: 'PlayerServerPage',
      model: Schema.Null,
      message: Schema.Never,
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) =>
        PlayerProvider(h, {
          props,
          view: () => h.main.children(h.h1('Server-rendered GBFM page')),
        }),
    })

    const result = await runWithLayer(resources.server, HtmlServer.renderToHtml(ServerPage, {}))

    expect(result.html).toContain('Server-rendered GBFM page')
    expect(result.state['~deferred']).toEqual([])
    expect(JSON.stringify(result.state)).toContain('PlayerProvider')
    expect(snapshotAcquisitions).toBe(1)
    expect(browserEventAcquisitions).toBe(0)
    expect(browserEngineAcquisitions).toBe(0)
  })

  it('server-renders the complete persistent player and its controlled dialogs alongside public content', async () => {
    const Page = Html.component({
      name: 'CompletePlayerServerPage',
      model: Schema.Null,
      message: Schema.Never,
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) =>
        MembershipProvider(h, {
          props: { principalId: null, principalKnown: true },
          view: () =>
            PlayerProvider(h, {
              props: { principalId: null, principalKnown: true, returnTo: '/' },
              view: () => h.main.children(h.h1('Public station'), PersistentPlayer(h, {})),
            }),
        }),
    })

    const result = await runWithLayer(
      Layer.merge(playerServerLayer, membershipCommandsLayer),
      HtmlServer.renderToHtml(Page, {}),
    )

    expect(result.html).toContain('Public station')
    expect(result.html).toContain('fullscreen-player')
    expect(result.html).toContain('playback-queue')
    expect(result.state['~deferred']).toEqual([])
    const fullscreen = result.html.match(/<dialog\b[^>]*id="fullscreen-player"[^>]*>/)?.[0]

    expect(fullscreen).toBeDefined()
    expect(fullscreen).toContain('min-width:100vw')
    expect(fullscreen).toContain('min-height:100dvh')
    expect(fullscreen).toContain('popover="manual"')
  })
})
