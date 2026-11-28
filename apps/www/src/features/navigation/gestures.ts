import { Mount, UiSchema } from '@effect/ui'
import { DialogInteraction } from '@effect/ui-kit'
import { Effect, Queue, Schema, Stream } from 'effect'

import { NavigationMessage } from './domain'
import { nextScrollState } from './links'

export const NavigationReady = Mount.makeStream(
  'NavigationReady',
  { args: {} },
  (_element: HTMLElement) => Stream.make(NavigationMessage.Ready()),
)

type DragMessage =
  | typeof NavigationMessage.cases.StartedMenuDrag.Type
  | typeof NavigationMessage.cases.MovedMenuDrag.Type
  | typeof NavigationMessage.cases.ReleasedMenuDrag.Type
  | typeof NavigationMessage.cases.CancelledMenuDrag.Type

export const TrackMenuDrag = Mount.makeStream(
  'TrackMenuDrag',
  { args: { active: Schema.Boolean } },
  (element: HTMLElement, _args, changes) =>
    changes.pipe(
      Stream.switchMap(({ active }) => {
        if (!active) return Stream.empty

        return Stream.callback<DragMessage>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const document = element.ownerDocument
              const window = document.defaultView
              let pointer: { id: number; startY: number; dragged: boolean } | null = null
              let suppressClick = false
              const send = (message: DragMessage) => Queue.offerUnsafe(queue, message)

              const down = (event: PointerEvent) => {
                if (event.button !== 0 || !event.isPrimary || pointer) return

                if (event.target instanceof Element && event.target.closest('button,a,input'))
                  return
                pointer = { id: event.pointerId, startY: event.clientY, dragged: false }
                suppressClick = false
                send(
                  NavigationMessage.StartedMenuDrag({
                    pointerId: event.pointerId,
                    clientY: event.clientY,
                  }),
                )
              }

              const move = (event: PointerEvent) => {
                if (pointer?.id !== event.pointerId) return

                if (Math.abs(event.clientY - pointer.startY) > 6) pointer.dragged = true
                send(
                  NavigationMessage.MovedMenuDrag({
                    pointerId: event.pointerId,
                    clientY: event.clientY,
                  }),
                )
              }

              const up = (event: PointerEvent) => {
                if (pointer?.id !== event.pointerId) return
                suppressClick = pointer.dragged
                pointer = null
                send(
                  NavigationMessage.ReleasedMenuDrag({
                    pointerId: event.pointerId,
                    clientY: event.clientY,
                    viewportHeight: window?.innerHeight ?? document.documentElement.clientHeight,
                  }),
                )
              }

              const cancel = (event?: PointerEvent) => {
                if (!pointer || (event && event.pointerId !== pointer.id)) return
                suppressClick = pointer.dragged
                pointer = null
                send(NavigationMessage.CancelledMenuDrag())
              }

              const blur = () => cancel()

              const click = (event: MouseEvent) => {
                if (suppressClick && event.detail !== 0) {
                  event.preventDefault()
                  event.stopImmediatePropagation()
                }

                suppressClick = false
              }

              element.addEventListener('pointerdown', down)
              document.addEventListener('pointermove', move)
              document.addEventListener('pointerup', up)
              document.addEventListener('pointercancel', cancel)
              window?.addEventListener('blur', blur)
              element.addEventListener('click', click, true)

              return () => {
                element.removeEventListener('pointerdown', down)
                document.removeEventListener('pointermove', move)
                document.removeEventListener('pointerup', up)
                document.removeEventListener('pointercancel', cancel)
                window?.removeEventListener('blur', blur)
                element.removeEventListener('click', click, true)
              }
            }),
            (cleanup) => Effect.sync(cleanup),
          ),
        )
      }),
    ),
)

export const DockMessage = UiSchema.TaggedEnum({
  RequestedSearch: {},
  RequestedMenu: { method: DialogInteraction },
  RequestedExpand: {},
  ChangedMinimized: { minimized: Schema.Boolean },
})

export const TrackNavigationScroll = Mount.makeStream(
  'TrackNavigationScroll',
  { args: { active: Schema.Boolean, minimized: Schema.Boolean } },
  (element: HTMLElement, _args, changes) =>
    changes.pipe(
      Stream.switchMap(({ active, minimized }) => {
        if (!active) return Stream.empty

        return Stream.callback<typeof DockMessage.cases.ChangedMinimized.Type>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const window = element.ownerDocument.defaultView

              if (!window) return () => undefined
              let state = { y: window.scrollY, minimized }

              const scroll = () => {
                const next = nextScrollState(state, window.scrollY)

                if (next.minimized !== state.minimized)
                  Queue.offerUnsafe(
                    queue,
                    DockMessage.ChangedMinimized({ minimized: next.minimized }),
                  )
                state = next
              }

              window.addEventListener('scroll', scroll, { passive: true })

              return () => window.removeEventListener('scroll', scroll)
            }),
            (cleanup) => Effect.sync(cleanup),
          ),
        )
      }),
    ),
)
