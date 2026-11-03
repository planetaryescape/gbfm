import { describe, expect, it } from 'vitest'

import { initialModel, Message, update } from './model'

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
    expect(update(initialModel, start).model).toBe(initialModel)
    const opening = update(initialModel, Message.ToggleFullscreen()).model
    expect(opening.playerDialog.animation.transitionState).not.toBe('Idle')
    expect(update(opening, start).model).toBe(opening)
    const started = update(openPlayer(), start).model
    expect(update(started, Message.PlayerDragStarted({ pointerId: 2, clientY: 200 })).model).toBe(
      started,
    )
    expect(
      update(
        started,
        Message.PlayerDragReleased({ pointerId: 2, clientY: 500, viewportHeight: 800 }),
      ).model,
    ).toBe(started)
    expect(update(initialModel, Message.PlayerDragCancelled()).model).toBe(initialModel)
  })

  it('follows the active pointer downward and snaps short pulls back', () => {
    const started = update(
      openPlayer(),
      Message.PlayerDragStarted({ pointerId: 1, clientY: 100 }),
    ).model

    const moved = update(started, Message.PlayerDragMoved({ pointerId: 1, clientY: 180 })).model
    expect(moved.playerOffset).toBe(80)
    expect(update(moved, Message.PlayerDragMoved({ pointerId: 2, clientY: 400 })).model).toBe(moved)

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
