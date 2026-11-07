import { Data } from 'effect'

import { readerAcceptsAction, type ReaderState } from './readerState'

type Focus =
  | { readonly _tag: 'Blurred'; readonly request: number }
  | { readonly _tag: 'Focused'; readonly request: number; readonly controller: AbortController }

const Focus = Data.taggedEnum<Focus>()

export const readerOwnership = () => {
  let focus: Focus = Focus.Blurred({ request: 0 })
  let action: AbortController | null = null

  const cancelAction = () => action?.abort()

  return {
    focus: () => {
      const visit = { request: focus.request + 1, controller: new AbortController() }
      focus = Focus.Focused(visit)
      cancelAction()
      action = null

      return visit
    },
    blur: (controller: AbortController) => {
      focus = Focus.Blurred({ request: focus.request })
      controller.abort()
      const pending = action
      action = null
      pending?.abort()
    },
    cancelAction,
    beginAction: (state: ReaderState) => {
      if (!readerAcceptsAction(state, focus.request, Focus.$is('Focused')(focus)) || action)
        return null

      const controller = new AbortController()
      action = controller

      return { request: focus.request, controller }
    },
    acceptsResult: (request: number, controller: AbortController) =>
      !controller.signal.aborted && focus.request === request,
    finishAction: (controller: AbortController) => {
      if (action !== controller) return false
      action = null

      return true
    },
  }
}
