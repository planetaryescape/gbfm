import { Data, Effect, Option, Schema } from 'effect'

import { PlayerProviderMessage } from './domain'

export type PlayerDragMessage =
  | typeof PlayerProviderMessage.cases.StartedPlayerDrag.Type
  | typeof PlayerProviderMessage.cases.MovedPlayerDrag.Type
  | typeof PlayerProviderMessage.cases.ReleasedPlayerDrag.Type
  | typeof PlayerProviderMessage.cases.CancelledPlayerDrag.Type

type ClickState =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Pressed'; readonly pointerId: number; readonly startY: number }
  | { readonly _tag: 'Dragged'; readonly pointerId: number; readonly startY: number }
  | { readonly _tag: 'ReleasedDrag' }

const ClickState = Data.taggedEnum<ClickState>()

const PointerInput = Schema.Struct({
  pointerId: Schema.Number,
  clientY: Schema.Number,
  button: Schema.Number,
  isPrimary: Schema.Boolean,
})

const ClickInput = Schema.Struct({ detail: Schema.optional(Schema.Number) })

export const bindPlayerDrag = (
  element: EventTarget,
  document: EventTarget,
  window: EventTarget | null,
  options: {
    readonly allowControls: boolean
    readonly isInteractiveTarget: (target: EventTarget | null) => boolean
    readonly containsTarget: (target: EventTarget | null) => boolean
    readonly viewportHeight: () => number
    readonly send: (message: PlayerDragMessage) => void
  },
) => {
  let state: ClickState = ClickState.Idle()
  let pointer: number | null = null

  const down = (event: Event) => {
    const input = Schema.decodeUnknownOption(PointerInput)(event)

    if (Option.isNone(input) || input.value.button !== 0 || !input.value.isPrimary) return

    if (!options.allowControls && options.isInteractiveTarget(event.target)) return
    const { pointerId, clientY } = input.value

    if (pointer !== null) options.send(PlayerProviderMessage.CancelledPlayerDrag())
    state = ClickState.Pressed({ pointerId, startY: clientY })
    pointer = pointerId
    options.send(PlayerProviderMessage.StartedPlayerDrag({ pointerId, clientY }))
  }

  const move = (event: Event) => {
    const input = Schema.decodeUnknownOption(PointerInput)(event)

    if (Option.isNone(input) || pointer !== input.value.pointerId) return
    const { pointerId, clientY } = input.value

    if (ClickState.$is('Pressed')(state) && Math.abs(clientY - state.startY) > 6)
      state = ClickState.Dragged({ pointerId, startY: state.startY })
    options.send(PlayerProviderMessage.MovedPlayerDrag({ pointerId, clientY }))
  }

  const release = () => {
    state = ClickState.$match(state, {
      Idle: () => ClickState.Idle(),
      Pressed: () => ClickState.Idle(),
      Dragged: () => ClickState.ReleasedDrag(),
      ReleasedDrag: () => ClickState.ReleasedDrag(),
    })
    pointer = null
  }

  const up = (event: Event) => {
    const input = Schema.decodeUnknownOption(PointerInput)(event)

    if (Option.isNone(input) || pointer !== input.value.pointerId) return
    release()
    options.send(
      PlayerProviderMessage.ReleasedPlayerDrag({
        pointerId: input.value.pointerId,
        clientY: input.value.clientY,
        viewportHeight: options.viewportHeight(),
      }),
    )
  }

  const cancel = () => {
    if (pointer === null) return
    release()
    options.send(PlayerProviderMessage.CancelledPlayerDrag())
  }

  const click = (event: Event) => {
    if (!options.containsTarget(event.target)) return
    const input = Schema.decodeUnknownOption(ClickInput)(event)
    const detail = Option.isSome(input) ? input.value.detail : undefined
    const dragged = ClickState.$is('Dragged')(state) || ClickState.$is('ReleasedDrag')(state)
    state = ClickState.$match(state, {
      Idle: () => ClickState.Idle(),
      Pressed: (pressed) => pressed,
      Dragged: ({ pointerId, startY }) => ClickState.Pressed({ pointerId, startY }),
      ReleasedDrag: () => ClickState.Idle(),
    })

    if (dragged && detail !== undefined && detail !== 0) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  element.addEventListener('pointerdown', down)
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
  document.addEventListener('pointercancel', cancel)
  window?.addEventListener('blur', cancel)
  const clickTarget = window ?? element
  clickTarget.addEventListener('click', click, { capture: true })

  return () => {
    element.removeEventListener('pointerdown', down)
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    document.removeEventListener('pointercancel', cancel)
    window?.removeEventListener('blur', cancel)
    clickTarget.removeEventListener('click', click, { capture: true })
  }
}

export const acquirePlayerDrag = (...args: Parameters<typeof bindPlayerDrag>) =>
  Effect.acquireRelease(
    Effect.sync(() => bindPlayerDrag(...args)),
    (cleanup) => Effect.sync(cleanup),
  )
