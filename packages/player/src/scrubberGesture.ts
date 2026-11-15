import { type ScrubberDrag, startScrubberDrag } from './scrubber'

export type ScrubberPreview = {
  readonly seconds: number
  readonly fine: boolean
}

type Options = {
  readonly scheduleHold: (callback: () => void, delayMs: number) => () => void
  readonly onPreview: (preview: ScrubberPreview) => void
  readonly onCommit: (seconds: number) => void
  readonly onCancel: () => void
  readonly onFine: () => void
}

type Start = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly currentTime: number
  readonly duration: number
}

type Active = {
  drag: ScrubberDrag
  readonly duration: number
  x: number
  y: number
  anchorX: number
  anchorY: number
  seconds: number
}

export const createScrubberGesture = (options: Options) => {
  let active: Active | null = null
  let generation = 0
  let cancelHold: (() => void) | null = null

  const clearHold = () => {
    generation += 1
    cancelHold?.()
    cancelHold = null
  }

  const wholeSecond = (seconds: number, duration: number) =>
    Math.max(0, Math.min(Math.floor(duration), Math.round(seconds)))

  const emit = (gesture: Active) =>
    options.onPreview({ seconds: gesture.seconds, fine: gesture.drag.fine })

  const armHold = (gesture: Active) => {
    clearHold()
    gesture.anchorX = gesture.x
    gesture.anchorY = gesture.y
    const expectedGeneration = generation
    cancelHold = options.scheduleHold(() => {
      if (expectedGeneration !== generation || active !== gesture || gesture.drag.fine) return

      clearHold()
      gesture.drag = gesture.drag.refine(gesture.x, gesture.seconds)
      emit(gesture)
      options.onFine()
    }, 500)
  }

  const move = (x: number, y: number) => {
    const gesture = active

    if (!gesture || !Number.isFinite(x) || !Number.isFinite(y)) return

    gesture.x = x
    gesture.y = y
    gesture.seconds = wholeSecond(gesture.drag.timeAt(x), gesture.duration)
    emit(gesture)

    if (!gesture.drag.fine && Math.hypot(x - gesture.anchorX, y - gesture.anchorY) > 6) {
      armHold(gesture)
    }
  }

  return {
    start: ({ x, y, width, currentTime, duration }: Start): void => {
      clearHold()
      active = null

      if (
        !Number.isFinite(width) ||
        width <= 0 ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        return
      }

      const drag = startScrubberDrag(x, width, currentTime, duration)

      const gesture: Active = {
        drag,
        duration,
        x,
        y,
        anchorX: x,
        anchorY: y,
        seconds: wholeSecond(drag.timeAt(x), duration),
      }

      active = gesture
      emit(gesture)
      armHold(gesture)
    },
    move,
    release: (x: number, y: number): void => {
      if (!active) return

      move(x, y)
      const seconds = active.seconds
      active = null
      clearHold()
      options.onCommit(seconds)
    },
    cancel: (): void => {
      const wasActive = active !== null
      active = null
      clearHold()

      if (wasActive) options.onCancel()
    },
    dispose: (): void => {
      active = null
      clearHold()
    },
  }
}
