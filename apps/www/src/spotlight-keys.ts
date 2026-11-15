import { Effect, Queue, Stream } from 'effect'

/** Matches Vimium: one tap glides a fixed distance, holding the key keeps scrolling smoothly. */
const TAP_DISTANCE = 60

const HOLD_SPEED = 900

const SEQUENCE_WINDOW_MS = 500

const ignored = (event: KeyboardEvent) => {
  const target = event.target

  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select') !== null)) ||
    document.querySelector(':popover-open, dialog[open]') !== null
  )
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const scrollContext = () => {
  const stage = document.querySelector<HTMLElement>('.spotlight-stage')

  if (stage !== null && getComputedStyle(stage).overflowY === 'auto') {
    return { target: stage, height: stage.clientHeight, extent: stage.scrollHeight }
  }

  return {
    target: window,
    height: window.innerHeight,
    extent: document.documentElement.scrollHeight,
  }
}

const glide = (top: number) =>
  scrollContext().target.scrollBy({ top, behavior: reducedMotion() ? 'auto' : 'smooth' })

const holdScroller = () => {
  let direction = 0
  let held = false
  let travelled = 0
  let last = 0
  let frame = 0

  const tick = (time: number) => {
    const elapsed = last === 0 ? 16 : Math.min(time - last, 50)
    last = time

    if (!held && travelled >= TAP_DISTANCE) {
      frame = 0
      last = 0

      return
    }

    const step = Math.min((HOLD_SPEED * elapsed) / 1000, held ? Infinity : TAP_DISTANCE - travelled)

    scrollContext().target.scrollBy(0, direction * step)
    travelled += step
    frame = requestAnimationFrame(tick)
  }

  return {
    press: (next: number) => {
      if (held && direction === next) return

      if (reducedMotion()) {
        scrollContext().target.scrollBy(0, next * TAP_DISTANCE)

        return
      }

      direction = next
      held = true
      travelled = 0

      if (frame === 0) frame = requestAnimationFrame(tick)
    },
    release: () => {
      held = false
    },
    stop: () => {
      cancelAnimationFrame(frame)
      frame = 0
    },
  }
}

/** Keyboard reading for spotlight posts: h/l and arrows step, j/k/d/u/gg/G scroll. */
export const spotlightKeys = <Message>(handlers: {
  readonly previous: () => Message
  readonly next: () => Message
}) =>
  Stream.callback<Message>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const scroller = holdScroller()
        let lastG = 0

        const keydown = (event: KeyboardEvent) => {
          if (ignored(event)) return

          const step =
            event.key === 'h' || event.key === 'ArrowLeft'
              ? handlers.previous
              : event.key === 'l' || event.key === 'ArrowRight'
                ? handlers.next
                : null

          if (step) {
            event.preventDefault()

            if (!event.repeat) Queue.offerUnsafe(queue, step())

            return
          }

          if (event.key === 'j' || event.key === 'k') {
            event.preventDefault()
            scroller.press(event.key === 'j' ? 1 : -1)

            return
          }

          if (event.key === 'd' || event.key === 'u') {
            event.preventDefault()
            glide((event.key === 'd' ? 1 : -1) * (scrollContext().height / 2))

            return
          }

          if (event.key === 'G') {
            event.preventDefault()
            glide(scrollContext().extent)

            return
          }

          if (event.key === 'g' && !event.repeat) {
            const now = performance.now()

            if (now - lastG < SEQUENCE_WINDOW_MS) {
              event.preventDefault()
              glide(-scrollContext().extent)
              lastG = 0

              return
            }

            lastG = now
          }
        }

        const keyup = (event: KeyboardEvent) => {
          if (event.key === 'j' || event.key === 'k') scroller.release()
        }

        window.addEventListener('keydown', keydown)
        window.addEventListener('keyup', keyup)
        window.addEventListener('blur', scroller.release)

        return () => {
          scroller.stop()
          window.removeEventListener('keydown', keydown)
          window.removeEventListener('keyup', keyup)
          window.removeEventListener('blur', scroller.release)
        }
      }),
      (cleanup) => Effect.sync(cleanup),
    ),
  )
