import { Effect } from 'effect'

import {
  randomReaderPost,
  resetReaderHistory,
  TweetReaderUnavailable,
  type ReaderConnection,
} from '@/api/tweetReader'

import { ReaderEvent } from './readerState'

export const readerAction = (
  connection: Effect.Effect<ReaderConnection, TweetReaderUnavailable>,
  input: {
    readonly kind: 'random' | 'reset'
    readonly current: string
    readonly request: number
    readonly controller: AbortController
    readonly acceptsResult: (request: number, controller: AbortController) => boolean
    readonly dispatch: (event: ReaderEvent) => void
    readonly go: (target: string | null) => void
  },
) =>
  connection.pipe(
    Effect.flatMap((connection) =>
      input.kind === 'reset'
        ? resetReaderHistory(connection).pipe(Effect.as(null))
        : randomReaderPost(connection, input.current),
    ),
    Effect.timeoutOrElse({
      duration: '15 seconds',
      orElse: () => Effect.fail(new TweetReaderUnavailable()),
    }),
    Effect.match({
      onSuccess: (target) => {
        if (!input.acceptsResult(input.request, input.controller)) return

        if (input.kind === 'random' && target === null) {
          input.dispatch(
            ReaderEvent.Notice({
              request: input.request,
              message: 'No other unread tweets remaining.',
            }),
          )
        } else {
          input.go(target)
        }
      },
      onFailure: () => {
        if (!input.controller.signal.aborted)
          input.dispatch(
            ReaderEvent.Notice({
              request: input.request,
              message: "Couldn't update reading options. Try again.",
            }),
          )
      },
    }),
  )
