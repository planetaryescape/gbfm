import { startScrubberDrag } from '@gbfm/player'
import { Effect, Queue, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './model'

export const ScrubberGesture = Mount.defineStream('Player.ScrubberGesture', {
  args: {},
  messages: [Message.SeekTo, Message.PreviewSeek, Message.CancelSeek],
  execute: ({ element }) =>
    Stream.callback<
      typeof Message.SeekTo.Type | typeof Message.PreviewSeek.Type | typeof Message.CancelSeek.Type
    >((queue) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const input = element.querySelector('input')

            if (!(input instanceof HTMLInputElement)) return () => {}

            let gesture: {
              pointerId: number
              left: number
              drag: ReturnType<typeof startScrubberDrag>
            } | null = null

            const release = () => {
              const pointerId = gesture?.pointerId
              gesture = null
              element.removeAttribute('data-pressed')

              if (pointerId !== undefined && element.hasPointerCapture(pointerId))
                element.releasePointerCapture(pointerId)
            }

            const move = (event: PointerEvent) => {
              if (!gesture || event.pointerId !== gesture.pointerId) return
              Queue.offerUnsafe(
                queue,
                Message.PreviewSeek({ seconds: gesture.drag.timeAt(event.clientX - gesture.left) }),
              )
            }

            const down = (event: Event) => {
              if (
                !(event instanceof PointerEvent) ||
                event.button !== 0 ||
                !event.isPrimary ||
                input.disabled ||
                gesture
              )
                return
              event.preventDefault()
              const bounds = element.getBoundingClientRect()
              gesture = {
                pointerId: event.pointerId,
                left: bounds.left,
                drag: startScrubberDrag(
                  event.clientX - bounds.left,
                  bounds.width,
                  Number(input.value),
                  Number(input.max),
                ),
              }
              input.focus({ preventScroll: true })
              element.setPointerCapture(event.pointerId)
              element.setAttribute('data-pressed', '')
              move(event)
            }

            const up = (event: PointerEvent) => {
              if (gesture?.pointerId !== event.pointerId) return
              const seconds = gesture.drag.timeAt(event.clientX - gesture.left)
              release()
              Queue.offerUnsafe(queue, Message.SeekTo({ seconds }))
            }

            const cancel = (event: Event) => {
              if (event instanceof PointerEvent && gesture?.pointerId === event.pointerId) {
                release()
                Queue.offerUnsafe(queue, Message.CancelSeek())
              }
            }

            const blur = () => {
              if (!gesture) return
              release()
              Queue.offerUnsafe(queue, Message.CancelSeek())
            }

            element.addEventListener('pointerdown', down, true)
            document.addEventListener('pointermove', move)
            document.addEventListener('pointerup', up)
            document.addEventListener('pointercancel', cancel)
            element.addEventListener('lostpointercapture', cancel)
            window.addEventListener('blur', blur)

            return () => {
              release()
              element.removeEventListener('pointerdown', down, true)
              document.removeEventListener('pointermove', move)
              document.removeEventListener('pointerup', up)
              document.removeEventListener('pointercancel', cancel)
              element.removeEventListener('lostpointercapture', cancel)
              window.removeEventListener('blur', blur)
            }
          }),
          (cleanup) => Effect.sync(cleanup),
        )

        return yield* Effect.never
      }),
    ),
})
