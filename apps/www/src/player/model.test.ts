import type { QueueTrackType } from '@gbfm/player'
import { describe, expect, it } from 'vitest'

import { initialModel, Message, update } from './model'

const track: QueueTrackType = {
  id: 'scrubber-track',
  title: 'Scrubber fixture',
  slug: 'scrubber-fixture',
  url: '/scrubber.wav',
  type: 'mix',
  thumbnailUrl: null,
}

const playingModel = {
  ...initialModel,
  playerDialog: {
    ...initialModel.playerDialog,
    isOpen: true,
    animation: { ...initialModel.playerDialog.animation, isShowing: true },
  },
  snapshot: {
    ...initialModel.snapshot,
    queue: { tracks: [track], currentIndex: 0, current: track },
    transport: { ...initialModel.snapshot.transport, currentTime: 60, duration: 7200 },
  },
}

describe('player submodel', () => {
  it('models queue and fullscreen visibility independently', () => {
    const open = update(initialModel, Message.ToggleQueue()).model
    expect(open.queueDialog.isOpen).toBe(true)
    expect(update(open, Message.ToggleFullscreen()).model).toMatchObject({
      queueDialog: { isOpen: true },
      playerDialog: { isOpen: true },
    })
    expect(update(open, Message.CloseQueue()).model.queueDialog.isOpen).toBe(false)
  })

  it('turns transport requests into Effects without performing them in update', () => {
    const result = update(initialModel, Message.SeekTo({ seconds: 42 }))
    expect(result.model).toBe(initialModel)
    expect(result.commands?.map(({ name }) => name)).toEqual(['PlayerSeek'])
  })

  it('previews a hill drag without seeking until release and discards cancelled previews', () => {
    const preview = update(
      playingModel,
      Message.PreviewSeek({
        trackId: track.id,
        seconds: 15,
        fine: true,
        referenceSeconds: 60,
        pointerRatio: 0.5,
      }),
    )

    expect(preview.commands ?? []).toEqual([])
    expect(preview.model.snapshot).toBe(playingModel.snapshot)
    expect(preview.model.seekPreview).toEqual({
      seconds: 15,
      fine: true,
      referenceSeconds: 60,
      pointerRatio: 0.5,
    })
    const committed = update(preview.model, Message.CommitSeek({ trackId: track.id, seconds: 15 }))
    expect(committed.model.seekPreview).toBeNull()
    expect(committed.model.snapshot.transport.currentTime).toBe(15)
    expect(committed.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: 'PlayerSeek', args: { seconds: 15 } },
    ])
    const cancelled = update(preview.model, Message.CancelSeek({ trackId: track.id }))
    expect(cancelled.model.seekPreview).toBeNull()
    expect(cancelled.commands ?? []).toEqual([])
    expect(update(preview.model, Message.CloseFullscreen()).model.seekPreview).toBeNull()
  })

  it('rejects gesture events during close/leave while preserving intentional external seeking', () => {
    const previewMessage = Message.PreviewSeek({
      trackId: track.id,
      seconds: 15,
      fine: false,
      referenceSeconds: 60,
      pointerRatio: 0.5,
    })

    const preview = update(playingModel, previewMessage).model
    const closed = update(preview, Message.CloseFullscreen()).model
    expect(closed.playerDialog.isOpen).toBe(false)
    expect(closed.playerDialog.animation.transitionState).not.toBe('Idle')
    expect(update(closed, previewMessage)).toEqual({ model: closed })
    expect(update(closed, Message.CommitSeek({ trackId: track.id, seconds: 15 }))).toEqual({
      model: closed,
    })
    const reopened = update(closed, Message.ToggleFullscreen()).model
    expect(update(reopened, Message.CommitSeek({ trackId: track.id, seconds: 15 }))).toEqual({
      model: reopened,
    })
    expect(update(closed, Message.SeekTo({ seconds: 20 })).commands?.[0]?.name).toBe('PlayerSeek')
  })

  it('keeps a fine preview across playback ticks and ignores stale track gestures', () => {
    const preview = update(
      playingModel,
      Message.PreviewSeek({
        trackId: track.id,
        seconds: 75,
        fine: true,
        referenceSeconds: 60,
        pointerRatio: 0.75,
      }),
    ).model

    const ticked = update(
      preview,
      Message.SnapshotChanged({
        snapshot: {
          ...preview.snapshot,
          transport: { ...preview.snapshot.transport, currentTime: 63 },
        },
      }),
    ).model

    expect(ticked.seekPreview).toEqual({
      seconds: 75,
      fine: true,
      referenceSeconds: 60,
      pointerRatio: 0.75,
    })
    const nextTrack = { ...track, id: 'next-track' }

    const changed = update(
      ticked,
      Message.SnapshotChanged({
        snapshot: {
          ...ticked.snapshot,
          queue: { tracks: [nextTrack], currentIndex: 0, current: nextTrack },
        },
      }),
    ).model

    expect(changed.seekPreview).toBeNull()
    expect(update(changed, Message.CommitSeek({ trackId: track.id, seconds: 75 }))).toEqual({
      model: changed,
    })
    expect(
      update(
        changed,
        Message.PreviewSeek({
          trackId: track.id,
          seconds: 75,
          fine: true,
          referenceSeconds: 60,
          pointerRatio: 0.75,
        }),
      ),
    ).toEqual({ model: changed })

    const fresh = update(
      changed,
      Message.PreviewSeek({
        trackId: nextTrack.id,
        seconds: 10,
        fine: false,
        referenceSeconds: 63,
        pointerRatio: 0.25,
      }),
    ).model

    expect(update(fresh, Message.CancelSeek({ trackId: track.id })).model).toBe(fresh)
    expect(update(fresh, Message.SeekTo({ seconds: 11 })).model.seekPreview).toBeNull()
  })

  it('converts a drag/drop gesture to one reorder command', () => {
    const dragging = update(initialModel, Message.DragStarted({ index: 2 })).model
    const dropped = update(dragging, Message.DroppedAt({ index: 0 }))
    expect(dropped.model.draggedIndex).toBeNull()
    expect(dropped.commands?.[0]?.args).toEqual({ from: 2, to: 0 })
    expect(update(dropped.model, Message.DroppedAt({ index: 1 })).commands).toBeUndefined()
  })
})

describe('player pull gesture', () => {
  const openPlayer = () => ({
    ...initialModel,
    playerDialog: { ...initialModel.playerDialog, isOpen: true },
  })

  it('guards closed, animating and already-owned sheets without issuing commands', () => {
    const start = Message.PlayerDragStarted({ pointerId: 1, clientY: 100 })
    expect(update(initialModel, start)).toEqual({ model: initialModel })
    const opening = update(initialModel, Message.ToggleFullscreen()).model
    expect(opening.playerDialog.animation.transitionState).not.toBe('Idle')
    expect(update(opening, start)).toEqual({ model: opening })
    const started = update(openPlayer(), start).model
    expect(update(started, Message.PlayerDragStarted({ pointerId: 2, clientY: 200 }))).toEqual({
      model: started,
    })
    expect(
      update(
        started,
        Message.PlayerDragReleased({ pointerId: 2, clientY: 500, viewportHeight: 800 }),
      ),
    ).toEqual({ model: started })
    expect(update(initialModel, Message.PlayerDragCancelled())).toEqual({ model: initialModel })
  })

  it('follows the active pointer downward and snaps short pulls back', () => {
    const started = update(
      openPlayer(),
      Message.PlayerDragStarted({ pointerId: 1, clientY: 100 }),
    ).model

    const moved = update(started, Message.PlayerDragMoved({ pointerId: 1, clientY: 180 })).model
    expect(moved.playerOffset).toBe(80)
    expect(update(moved, Message.PlayerDragMoved({ pointerId: 2, clientY: 400 }))).toEqual({
      model: moved,
    })

    const released = update(
      moved,
      Message.PlayerDragReleased({ pointerId: 1, clientY: 180, viewportHeight: 800 }),
    ).model

    expect(released.playerDrag).toBeNull()
    expect(released.playerOffset).toBe(0)
    expect(released.playerDialog.isOpen).toBe(true)
  })

  it('closes past the threshold while preserving the release position for the exit animation', () => {
    const started = update(
      openPlayer(),
      Message.PlayerDragStarted({ pointerId: 1, clientY: 100 }),
    ).model

    const released = update(
      started,
      Message.PlayerDragReleased({ pointerId: 1, clientY: 270, viewportHeight: 800 }),
    ).model

    expect(released.playerDialog.isOpen).toBe(false)
    expect(released.playerOffset).toBe(170)
    expect(released.playerDrag).toBeNull()
  })

  it('clamps upward movement and cancels without closing', () => {
    const started = update(
      openPlayer(),
      Message.PlayerDragStarted({ pointerId: 1, clientY: 100 }),
    ).model

    expect(
      update(started, Message.PlayerDragMoved({ pointerId: 1, clientY: 80 })).model.playerOffset,
    ).toBe(0)
    const moved = update(started, Message.PlayerDragMoved({ pointerId: 1, clientY: 300 })).model
    const cancelled = update(moved, Message.PlayerDragCancelled()).model
    expect(cancelled.playerDialog.isOpen).toBe(true)
    expect(cancelled.playerOffset).toBe(0)
    expect(cancelled.playerDrag).toBeNull()
  })
})
