import { Effect, Exit, Predicate, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { acquirePlayerDrag, type PlayerDragMessage } from './drag-events'

class PointerInput extends Event {
  readonly button = 0
  readonly isPrimary = true
  constructor(
    type: string,
    readonly pointerId: number,
    readonly clientY: number,
  ) {
    super(type, { cancelable: true })
  }
}

class ClickInput extends Event {
  constructor(
    readonly detail: number | undefined,
    private readonly origin: EventTarget,
  ) {
    super('click', { cancelable: true })
  }
  override get target() {
    return this.origin
  }
}

const fixture = () => {
  const element = new EventTarget()
  const document = new EventTarget()
  const window = new EventTarget()
  const messages: Array<PlayerDragMessage> = []
  let forwardedClicks = 0
  document.addEventListener(
    'click',
    () => {
      forwardedClicks++
    },
    { capture: true },
  )

  const scope = Scope.makeUnsafe()
  Effect.runSync(
    acquirePlayerDrag(element, document, window, {
      allowControls: true,
      isInteractiveTarget: () => false,
      containsTarget: (target) => target === element,
      viewportHeight: () => 800,
      send: (message) => {
        messages.push(message)
      },
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  const cleanup = () => Effect.runSync(Scope.close(scope, Exit.void))

  return {
    messages,
    cleanup,
    down: (id: number, y: number) => element.dispatchEvent(new PointerInput('pointerdown', id, y)),
    move: (id: number, y: number) => document.dispatchEvent(new PointerInput('pointermove', id, y)),
    up: (id: number, y: number) => document.dispatchEvent(new PointerInput('pointerup', id, y)),
    cancel: () => document.dispatchEvent(new Event('pointercancel')),
    click: (detail?: number) => {
      const event = new ClickInput(detail, element)
      window.dispatchEvent(event)

      if (!event.defaultPrevented) document.dispatchEvent(event)

      if (!event.defaultPrevented) element.dispatchEvent(event)

      return event.defaultPrevented
    },
    forwarded: () => forwardedClicks,
  }
}

describe('native player drag DOM event binding', () => {
  it('suppresses a completed drag before pre-existing document-capture click handlers', () => {
    const drag = fixture()

    try {
      drag.down(1, 0)
      drag.move(1, 80)
      drag.up(1, 80)
      expect(drag.click(1)).toBe(true)
      expect(drag.forwarded()).toBe(0)
      expect(drag.click(1)).toBe(false)
      expect(drag.forwarded()).toBe(1)
    } finally {
      drag.cleanup()
    }
  })
  it('uses the matching pointer and a strict six-pixel threshold', () => {
    const drag = fixture()

    try {
      drag.down(1, 100)
      drag.move(2, 120)
      drag.move(1, 106)
      expect(drag.click(1)).toBe(false)
      drag.move(1, 93)
      drag.move(1, 100)
      drag.up(1, 100)
      expect(drag.click(1)).toBe(true)
      expect(drag.click(1)).toBe(false)
      expect(drag.forwarded()).toBe(2)
      expect(drag.messages.filter(Predicate.isTagged('MovedPlayerDrag'))).toHaveLength(3)
    } finally {
      drag.cleanup()
    }
  })

  it('preserves suppression after pointer cancellation and ignores subsequent movement', () => {
    const drag = fixture()

    try {
      drag.down(1, 0)
      drag.move(1, 10)
      drag.cancel()
      drag.cancel()
      drag.move(1, 100)
      expect(drag.click(1)).toBe(true)
      drag.down(1, 0)
      drag.cancel()
      drag.move(1, 100)
      expect(drag.click(1)).toBe(false)
    } finally {
      drag.cleanup()
    }
  })

  it('lets keyboard and non-mouse clicks clear suppression without blocking them', () => {
    const drag = fixture()

    try {
      for (const detail of [0, undefined]) {
        drag.down(1, 0)
        drag.move(1, 10)
        drag.up(1, 10)
        expect(drag.click(detail)).toBe(false)
        expect(drag.click(1)).toBe(false)
      }
    } finally {
      drag.cleanup()
    }
  })

  it('lets a new press replace pending suppression and retains origin for pre-release clicks', () => {
    const drag = fixture()

    try {
      drag.down(1, 0)
      drag.move(1, 10)
      expect(drag.click(1)).toBe(true)
      drag.move(1, 10)
      expect(drag.click(1)).toBe(true)
      drag.down(1, 0)
      drag.move(1, 10)
      drag.up(1, 10)
      drag.down(2, 100)
      expect(drag.click(1)).toBe(false)
    } finally {
      drag.cleanup()
    }
  })

  it('removes all DOM listeners when the owning mount is released', () => {
    const drag = fixture()
    drag.down(1, 0)
    drag.move(1, 10)
    drag.cleanup()
    const count = drag.messages.length
    drag.up(1, 10)
    drag.down(2, 0)
    drag.move(2, 20)
    drag.cancel()
    expect(drag.click(1)).toBe(false)
    expect(drag.messages).toHaveLength(count)
  })
})
