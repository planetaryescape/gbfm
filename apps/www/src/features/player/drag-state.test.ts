import { Html } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  initialModel,
  PlayerProviderMessage,
  PlayerProviderModel,
  PlayerProviderProps,
} from './domain'
import { updatePlayerProvider } from './provider'

const PlayerDragState = Html.component({
  name: 'PlayerDragState',
  props: PlayerProviderProps,
  model: PlayerProviderModel,
  message: PlayerProviderMessage,
}).make({
  init: () => initialModel,
  update: updatePlayerProvider,
  view: (h) => h.text(''),
})

const props = { principalId: null, principalKnown: true, returnTo: '/mixes' }

const openPlayer = { ...initialModel, fullscreenOpen: true, fullscreenSettled: true }

describe('native player pull state legacy assertion parity', () => {
  it('guards closed, animating and already-owned sheets without commands or model replacement', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerDragState, props)
          const closed = s.model
          s.send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
          expect(s.model).toBe(closed)
          expect(s.pending).toEqual([])

          s.send(PlayerProviderMessage.RequestedToggleFullscreen())
          const opening = s.model
          expect(opening.fullscreenSettled).toBe(false)
          s.send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
          expect(s.model).toBe(opening)
          expect(s.pending).toEqual([])

          s.given(openPlayer).send(
            PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }),
          )
          const started = s.model
          expect(started.playerDrag).toEqual({ pointerId: 1, startY: 100 })
          s.send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 2, clientY: 200 }))
          expect(s.model).toBe(started)
          s.send(
            PlayerProviderMessage.ReleasedPlayerDrag({
              pointerId: 2,
              clientY: 500,
              viewportHeight: 800,
            }),
          )
          expect(s.model).toBe(started)
          expect(s.pending).toEqual([])

          s.given(initialModel).send(PlayerProviderMessage.CancelledPlayerDrag())
          expect(s.model).toBe(initialModel)
          expect(s.pending).toEqual([])
        }),
      ),
    ))

  it('follows only the active pointer downward and snaps an 80-pixel pull back without closing', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerDragState, props)
          s.given(openPlayer)
            .send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
            .send(PlayerProviderMessage.MovedPlayerDrag({ pointerId: 1, clientY: 180 }))
          const moved = s.model
          expect(moved.playerOffset).toBe(80)
          s.send(PlayerProviderMessage.MovedPlayerDrag({ pointerId: 2, clientY: 400 }))
          expect(s.model).toBe(moved)
          s.send(
            PlayerProviderMessage.ReleasedPlayerDrag({
              pointerId: 1,
              clientY: 180,
              viewportHeight: 800,
            }),
          )
          expect(s.model.playerDrag).toBeNull()
          expect(s.model.playerOffset).toBe(0)
          expect(s.model.fullscreenOpen).toBe(true)
          expect(s.model.snapshot).toBe(openPlayer.snapshot)
          expect(s.pending).toEqual([])
        }),
      ),
    ))

  it('closes past the threshold while preserving the exact 170-pixel release position for exit', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerDragState, props)
          s.given(openPlayer)
            .send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
            .send(
              PlayerProviderMessage.ReleasedPlayerDrag({
                pointerId: 1,
                clientY: 270,
                viewportHeight: 800,
              }),
            )
          expect(s.model.fullscreenOpen).toBe(false)
          expect(s.model.playerOffset).toBe(170)
          expect(s.model.playerDrag).toBeNull()
          expect(s.pending).toEqual([])

          const released = s.model
          s.send(PlayerProviderMessage.CancelledPlayerDrag())
          expect(s.model).toBe(released)
          expect(s.model.playerOffset).toBe(170)
          s.send(PlayerProviderMessage.RequestedToggleFullscreen())
          expect(s.model.fullscreenOpen).toBe(true)
          expect(s.model.playerOffset).toBe(0)
          expect(s.model.playerDrag).toBeNull()
        }),
      ),
    ))

  it('clamps upward motion to zero and cancels a 200-pixel pull without closing', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerDragState, props)
          s.given(openPlayer)
            .send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
            .send(PlayerProviderMessage.MovedPlayerDrag({ pointerId: 1, clientY: 80 }))
          expect(s.model.playerOffset).toBe(0)
          s.send(PlayerProviderMessage.MovedPlayerDrag({ pointerId: 1, clientY: 300 }))
          expect(s.model.playerOffset).toBe(200)
          s.send(PlayerProviderMessage.CancelledPlayerDrag())
          expect(s.model.fullscreenOpen).toBe(true)
          expect(s.model.playerOffset).toBe(0)
          expect(s.model.playerDrag).toBeNull()
          expect(s.model.snapshot).toBe(openPlayer.snapshot)
          expect(s.pending).toEqual([])
        }),
      ),
    ))

  it('ignores moves and releases with no active pointer, including while an exit is settling', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(PlayerDragState, props)
          const exiting = { ...initialModel, fullscreenSettled: false, playerOffset: 170 }
          s.given(exiting).send(
            PlayerProviderMessage.MovedPlayerDrag({ pointerId: 1, clientY: 600 }),
          )
          expect(s.model).toBe(exiting)
          s.send(
            PlayerProviderMessage.ReleasedPlayerDrag({
              pointerId: 1,
              clientY: 600,
              viewportHeight: 800,
            }),
          )
          expect(s.model).toBe(exiting)
          s.send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 600 }))
          expect(s.model).toBe(exiting)
          expect(s.pending).toEqual([])
        }),
      ),
    ))

  it.each([
    { viewportHeight: 600, offset: 119, closes: false },
    { viewportHeight: 600, offset: 120, closes: true },
    { viewportHeight: 1200, offset: 159, closes: false },
    { viewportHeight: 1200, offset: 160, closes: true },
  ])(
    'preserves the inclusive min(160px, 20vh) threshold at $viewportHeight/$offset',
    ({ viewportHeight, offset, closes }) =>
      Effect.runSync(
        Effect.scoped(
          Effect.gen(function* () {
            const s = yield* Story.make(PlayerDragState, props)
            s.given(openPlayer)
              .send(PlayerProviderMessage.StartedPlayerDrag({ pointerId: 1, clientY: 100 }))
              .send(
                PlayerProviderMessage.ReleasedPlayerDrag({
                  pointerId: 1,
                  clientY: 100 + offset,
                  viewportHeight,
                }),
              )
            expect(s.model.fullscreenOpen).toBe(!closes)
            expect(s.model.playerOffset).toBe(closes ? offset : 0)
            expect(s.model.playerDrag).toBeNull()
            expect(s.pending).toEqual([])
          }),
        ),
      ),
  )
})
