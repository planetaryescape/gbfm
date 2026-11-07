import { Data, Effect } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './model'

type DragClick =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Pressed'; readonly pointerId: number; readonly startY: number }
  | { readonly _tag: 'Dragged'; readonly pointerId: number; readonly startY: number }
  | { readonly _tag: 'ReleasedDrag' }

const DragClick = Data.taggedEnum<DragClick>()

export const createDragClickSuppression = () => {
  let state: DragClick = DragClick.Idle()

  return {
    down(pointerId: number, clientY: number) {
      state = DragClick.Pressed({ pointerId, startY: clientY })
    },
    move(pointerId: number, clientY: number) {
      if (
        DragClick.$is('Pressed')(state) &&
        state.pointerId === pointerId &&
        Math.abs(clientY - state.startY) > 6
      )
        state = DragClick.Dragged({ pointerId, startY: state.startY })
    },
    release() {
      state = DragClick.$match(state, {
        Idle: () => DragClick.Idle(),
        Pressed: () => DragClick.Idle(),
        Dragged: () => DragClick.ReleasedDrag(),
        ReleasedDrag: () => DragClick.ReleasedDrag(),
      })
    },
    click(detail: number | undefined) {
      const dragged = DragClick.$is('Dragged')(state) || DragClick.$is('ReleasedDrag')(state)
      state = DragClick.$match(state, {
        Idle: () => DragClick.Idle(),
        Pressed: (pressed) => pressed,
        Dragged: ({ pointerId, startY }) => DragClick.Pressed({ pointerId, startY }),
        ReleasedDrag: () => DragClick.Idle(),
      })

      return dragged && detail !== undefined && detail !== 0
    },
  }
}

export const SuppressDragClick = Mount.define('Player.SuppressDragClick', {
  args: {},
  messages: [Message.OperationCompleted],
  execute: ({ element }) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const suppression = createDragClickSuppression()

        const down = (event: Event) => {
          if (!(event instanceof PointerEvent) || event.button !== 0) return
          suppression.down(event.pointerId, event.clientY)
        }

        const move = (event: PointerEvent) => {
          suppression.move(event.pointerId, event.clientY)
        }

        const up = () => {
          suppression.release()
        }

        const click = (event: Event) => {
          if (suppression.click(event instanceof MouseEvent ? event.detail : undefined)) {
            event.preventDefault()
            event.stopImmediatePropagation()
          }
        }

        element.addEventListener('pointerdown', down)
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
        document.addEventListener('pointercancel', up)
        element.addEventListener('click', click, true)

        return () => {
          element.removeEventListener('pointerdown', down)
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
          document.removeEventListener('pointercancel', up)
          element.removeEventListener('click', click, true)
        }
      }),
      (cleanup) => Effect.sync(cleanup),
    ).pipe(Effect.as(Message.OperationCompleted())),
})
