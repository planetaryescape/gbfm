import type { JourneyObserver } from './callbacks'

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
    committed: (state: {
      readonly request: number
      readonly status: 'loading' | 'ready' | 'empty' | 'error'
      readonly hasContent: boolean
    }) => {
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
