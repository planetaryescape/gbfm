import { describe, expect, it } from 'vitest'

import { createDragClickSuppression } from './drag-handle'

describe('player drag click suppression', () => {
  it('uses the matching pointer and a strict six-pixel threshold', () => {
    const drag = createDragClickSuppression()
    drag.down(1, 100)
    drag.move(2, 120)
    drag.move(1, 106)
    expect(drag.click(1)).toBe(false)
    drag.move(1, 93)
    drag.move(1, 100)
    drag.release()
    expect(drag.click(1)).toBe(true)
    expect(drag.click(1)).toBe(false)
  })

  it('preserves suppression after pointer cancellation and ignores subsequent movement', () => {
    const drag = createDragClickSuppression()
    drag.down(1, 0)
    drag.move(1, 10)
    drag.release()
    drag.release()
    drag.move(1, 100)
    expect(drag.click(1)).toBe(true)
    drag.down(1, 0)
    drag.release()
    drag.move(1, 100)
    expect(drag.click(1)).toBe(false)
  })

  it('lets keyboard and non-mouse clicks clear suppression without blocking them', () => {
    const drag = createDragClickSuppression()

    for (const detail of [0, undefined]) {
      drag.down(1, 0)
      drag.move(1, 10)
      drag.release()
      expect(drag.click(detail)).toBe(false)
      expect(drag.click(1)).toBe(false)
    }
  })

  it('lets a new press replace a pending drag click and retains origin for pre-release clicks', () => {
    const drag = createDragClickSuppression()
    drag.down(1, 0)
    drag.move(1, 10)
    expect(drag.click(1)).toBe(true)
    drag.move(1, 10)
    expect(drag.click(1)).toBe(true)
    drag.down(1, 0)
    drag.move(1, 10)
    drag.release()
    drag.down(2, 100)
    expect(drag.click(1)).toBe(false)
  })
})
