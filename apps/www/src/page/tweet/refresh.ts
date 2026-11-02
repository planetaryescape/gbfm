import { Effect, Queue, Stream } from 'effect'

import { Message } from './reader'

export const readerRefreshEvents = Stream.callback<typeof Message.RetryNavigation.Type>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const refresh = () => {
        if (document.visibilityState === 'visible')
          Queue.offerUnsafe(queue, Message.RetryNavigation())
      }

      document.addEventListener('visibilitychange', refresh)
      window.addEventListener('focus', refresh)
      window.addEventListener('pageshow', refresh)

      return () => {
        document.removeEventListener('visibilitychange', refresh)
        window.removeEventListener('focus', refresh)
        window.removeEventListener('pageshow', refresh)
      }
    }),
    (cleanup) => Effect.sync(cleanup),
  ).pipe(Effect.andThen(Effect.never)),
)
