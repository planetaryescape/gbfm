import type { JourneyObserver } from '@gbfm/observability/callbacks'

import type { ReaderState } from './readerState'

export const readerJourney = (observer: JourneyObserver) => {
  let pending:
    | { readonly request: number; readonly finish: ReturnType<JourneyObserver['start']> }
    | undefined

  return {
    start: (request: number) => {
      pending?.finish('canceled')
      const finish = observer.start('reader.open')
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
