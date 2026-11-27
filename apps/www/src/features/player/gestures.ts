import { Mount } from '@effect/ui'
import { createScrubberGesture } from '@gbfm/player'
import { Effect, Queue, Schema, Stream } from 'effect'

import { PlayerProviderMessage } from './domain'
import { acquirePlayerDrag, type PlayerDragMessage } from './drag-events'

export const TrackPlayerDrag = Mount.makeStream(
  'TrackPlayerDrag',
  {
    args: { allowControls: Schema.Boolean },
  },
  (element: HTMLElement, { allowControls }) =>
    Stream.callback<PlayerDragMessage>((queue) =>
      acquirePlayerDrag(element, element.ownerDocument, element.ownerDocument.defaultView, {
        allowControls,
        isInteractiveTarget: (target) =>
          target instanceof Element && target.closest('button,a,input') !== null,
        containsTarget: (target) => target instanceof Node && element.contains(target),
        viewportHeight: () =>
          element.ownerDocument.defaultView?.innerHeight ??
          element.ownerDocument.documentElement.clientHeight,
        send: (message) => {
          Queue.offerUnsafe(queue, message)
        },
      }),
    ),
)

type ScrubberMessage =
  | typeof PlayerProviderMessage.cases.PreviewedSeek.Type
  | typeof PlayerProviderMessage.cases.CommittedSeek.Type
  | typeof PlayerProviderMessage.cases.CancelledSeek.Type

export const TrackScrubberGesture = Mount.makeStream(
  'TrackScrubberGesture',
  {
    args: { trackId: Schema.String },
  },
  (element: HTMLElement, { trackId }) =>
    Stream.callback<ScrubberMessage>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const input = element.querySelector('input')
          const document = element.ownerDocument
          const window = document.defaultView

          if (!(input instanceof HTMLInputElement) || !window) return () => undefined
          let pointer: { id: number; left: number; top: number } | null = null
          let referenceSeconds = 0
          let pointerRatio = 0
          let width = 0

          const releasePointer = () => {
            const id = pointer?.id
            pointer = null
            element.removeAttribute('data-pressed')

            if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id)
          }

          const gesture = createScrubberGesture({
            scheduleHold: (callback, delayMs) => {
              const timer = window.setTimeout(callback, delayMs)

              return () => window.clearTimeout(timer)
            },
            onPreview: ({ seconds, fine }) =>
              Queue.offerUnsafe(
                queue,
                PlayerProviderMessage.PreviewedSeek({
                  trackId,
                  seconds,
                  fine,
                  referenceSeconds,
                  pointerRatio,
                }),
              ),
            onCommit: (seconds) =>
              Queue.offerUnsafe(queue, PlayerProviderMessage.CommittedSeek({ trackId, seconds })),
            onCancel: () =>
              Queue.offerUnsafe(queue, PlayerProviderMessage.CancelledSeek({ trackId })),
            onFine: () => undefined,
          })

          const down = (event: PointerEvent) => {
            if (event.button !== 0 || !event.isPrimary || input.disabled || pointer) return
            const bounds = element.getBoundingClientRect()

            if (bounds.width <= 0) return
            event.preventDefault()
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
              width,
              currentTime: referenceSeconds,
              duration: Number(input.max),
            })
          }

          const move = (event: PointerEvent) => {
            if (pointer?.id !== event.pointerId) return
            pointerRatio = (event.clientX - pointer.left) / width
            gesture.move(event.clientX - pointer.left, event.clientY - pointer.top)
          }

          const up = (event: PointerEvent) => {
            if (pointer?.id !== event.pointerId) return
            gesture.release(event.clientX - pointer.left, event.clientY - pointer.top)
            releasePointer()
          }

          const cancel = (event: PointerEvent) => {
            if (pointer?.id !== event.pointerId) return
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
      ),
    ),
)
