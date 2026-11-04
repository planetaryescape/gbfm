import { Effect, Exit } from 'effect'
import { useCallback, useReducer, useRef } from 'react'

import { getTweetsPage } from '@/api/tweets'

import {
  reduceTweetPages,
  tweetPagesView,
  TweetPagesEvent,
  TweetPagesState,
  type TweetPage,
} from './tweetPagesState'

const initial = TweetPagesState.Initial()

export function useTweetPages(firstPage: TweetPage | null) {
  const [state, dispatch] = useReducer(reduceTweetPages, initial)
  const loading = useRef(false)
  const { tweets, loaded, hasMore, status } = tweetPagesView(state, firstPage)

  const loadMore = useCallback(() => {
    if (!firstPage || !hasMore || loading.current) return
    loading.current = true
    dispatch(TweetPagesEvent.Started({ source: firstPage, tweets: loaded, hasMore }))

    void Effect.runPromiseExit(getTweetsPage(firstPage.tweets.length + loaded.length)).then(
      (exit) => {
        loading.current = false
        dispatch(
          Exit.isSuccess(exit)
            ? TweetPagesEvent.Loaded({ source: firstPage, page: exit.value })
            : TweetPagesEvent.Failed({ source: firstPage }),
        )
      },
    )
  }, [firstPage, hasMore, loaded])

  return { tweets, hasMore, status, loadMore }
}
