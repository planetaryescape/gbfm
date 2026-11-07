import { Effect, Exit } from 'effect'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { getTweetsPage } from '@/api/tweets'

import {
  reduceTweetPages,
  tweetPagesView,
  TweetPagesEvent,
  TweetPagesState,
  type TweetPage,
} from './tweetPagesState'

const initial = TweetPagesState.Initial()

type PageLifetime = {
  readonly source: TweetPage | null
  request: AbortController | null
}

export function useTweetPages(
  firstPage: TweetPage | null,
  getPage: (
    offset: number,
  ) => Effect.Effect<TweetPage, Effect.Error<ReturnType<typeof getTweetsPage>>> = getTweetsPage,
) {
  const [state, dispatch] = useReducer(reduceTweetPages, initial)
  const owner = useRef<PageLifetime | null>(null)
  const { tweets, loaded, hasMore, status } = tweetPagesView(state, firstPage)

  useEffect(() => {
    const lifetime: PageLifetime = { source: firstPage, request: null }
    owner.current = lifetime

    return () => {
      if (owner.current === lifetime) owner.current = null
      lifetime.request?.abort()
    }
  }, [firstPage])

  const loadMore = useCallback(() => {
    const lifetime = owner.current

    if (!firstPage || !hasMore || !lifetime || lifetime.source !== firstPage || lifetime.request)
      return
    const controller = new AbortController()
    lifetime.request = controller
    dispatch(TweetPagesEvent.Started({ source: firstPage, tweets: loaded, hasMore }))

    void Effect.runPromiseExit(getPage(firstPage.tweets.length + loaded.length), {
      signal: controller.signal,
    }).then((exit) => {
      if (
        owner.current !== lifetime ||
        lifetime.request !== controller ||
        controller.signal.aborted
      )
        return
      lifetime.request = null
      dispatch(
        Exit.isSuccess(exit)
          ? TweetPagesEvent.Loaded({ source: firstPage, page: exit.value })
          : TweetPagesEvent.Failed({ source: firstPage }),
      )
    })
  }, [firstPage, hasMore, loaded, getPage])

  return { tweets, hasMore, status, loadMore }
}
