import { createScrubberGesture } from '@gbfm/player'
import { Effect, Queue, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './model'

export const ScrubberGesture = Mount.defineStream('Player.ScrubberGesture', {
  args: { trackId: Schema.String },
  messages: [Message.CommitSeek, Message.PreviewSeek, Message.CancelSeek],
  execute: ({ element, trackId }) =>
    Stream.callback<
      | typeof Message.CommitSeek.Type
      | typeof Message.PreviewSeek.Type
      | typeof Message.CancelSeek.Type
    >((queue) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const input = element.querySelector('input')

            if (!(input instanceof HTMLInputElement)) return () => {}

            let pointer: { id: number; left: number; top: number } | null = null
            let referenceSeconds = 0
            let pointerRatio = 0
            let width = 0

            const releasePointer = () => {
              const id = pointer?.id
              pointer = null
              element.removeAttribute('data-pressed')

              if (id !== undefined && element.hasPointerCapture(id))
                element.releasePointerCapture(id)
            }

            const gesture = createScrubberGesture({
              scheduleHold: (callback, delayMs) => {
                const timer = window.setTimeout(callback, delayMs)

                return () => window.clearTimeout(timer)
              },
              onPreview: ({ seconds, fine }) =>
                Queue.offerUnsafe(
                  queue,
                  Message.PreviewSeek({ trackId, seconds, fine, referenceSeconds, pointerRatio }),
                ),
              onCommit: (seconds) =>
                Queue.offerUnsafe(queue, Message.CommitSeek({ trackId, seconds })),
              onCancel: () => Queue.offerUnsafe(queue, Message.CancelSeek({ trackId })),
              onFine: () => {},
            })

            const move = (event: PointerEvent) => {
              if (pointer?.id !== event.pointerId) return
              pointerRatio = (event.clientX - pointer.left) / width
              gesture.move(event.clientX - pointer.left, event.clientY - pointer.top)
            }

            const down = (event: Event) => {
              if (
                !(event instanceof PointerEvent) ||
                event.button !== 0 ||
                !event.isPrimary ||
                input.disabled ||
                pointer
              )
                return
              event.preventDefault()
              const bounds = element.getBoundingClientRect()
              width = bounds.width
              pointerRatio = (event.clientX - bounds.left) / width
              pointer = { id: event.pointerId, left: bounds.left, top: bounds.top }
              referenceSeconds = Number(input.value)
              input.focus({ preventScroll: true })
              element.setPointerCapture(event.pointerId)
              element.setAttribute('data-pressed', '')
              gesture.start({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
                width: bounds.width,
                currentTime: referenceSeconds,
                duration: Number(input.max),
              })
            }

            const up = (event: PointerEvent) => {
              if (pointer?.id !== event.pointerId) return
              const { left, top } = pointer
              gesture.release(event.clientX - left, event.clientY - top)
              releasePointer()
            }

            const cancel = (event: Event) => {
              if (!(event instanceof PointerEvent) || pointer?.id !== event.pointerId) return
              releasePointer()
              gesture.cancel()
            }

            const blur = () => {
              releasePointer()
              gesture.cancel()
            }

            element.addEventListener('pointerdown', down, true)
            document.addEventListener('pointermove', move)
            document.addEventListener('pointerup', up)
            document.addEventListener('pointercancel', cancel)
            element.addEventListener('lostpointercapture', cancel)
            window.addEventListener('blur', blur)

            return () => {
              gesture.dispose()
              releasePointer()
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
