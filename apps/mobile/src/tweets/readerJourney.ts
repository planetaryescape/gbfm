import { startJourney, type JourneySink } from '../observability/journey'
import type { ReaderState } from './readerState'

export const readerJourney = (sink: JourneySink, now: () => number = () => performance.now()) => {
  let pending:
    | { readonly request: number; readonly finish: ReturnType<typeof startJourney> }
    | undefined

  return {
    start: (request: number) => {
      pending?.finish('canceled')
      const finish = startJourney(sink, 'reader.open', now)
      pending = { request, finish }

      return () => {
        finish('canceled')

        if (pending?.request === request) pending = undefined
      }
    },
    committed: (
      state: Pick<ReaderState, 'request' | 'status'> & { readonly hasContent: boolean },
    ) => {
      if (!pending || pending.request !== state.request || state.status === 'loading') return

      pending.finish(
        state.status === 'ready' && state.hasContent
          ? 'succeeded'
          : state.status === 'empty'
            ? 'empty'
            : 'failed',
      )
      pending = undefined
    },
  }
}
