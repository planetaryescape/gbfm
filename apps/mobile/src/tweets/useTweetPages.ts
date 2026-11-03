import { Effect, Exit } from 'effect'
import { useCallback, useRef, useState } from 'react'

import { getTweetsPage, type Tweet } from '@/api/tweets'

import { appendTweets } from './appendTweets'

type Page = { readonly tweets: ReadonlyArray<Tweet>; readonly hasMore: boolean }

type MoreState = Page & {
  readonly source: Page
  readonly status: 'idle' | 'loading' | 'failed'
}

export function useTweetPages(firstPage: Page | null) {
  const [state, setState] = useState<MoreState | null>(null)
  const loading = useRef(false)
  const more = state && state.source === firstPage ? state : null

  const tweets = firstPage ? appendTweets(firstPage.tweets, more?.tweets ?? []) : []
  const hasMore = more ? more.hasMore : (firstPage?.hasMore ?? false)

  const loadMore = useCallback(() => {
    if (!firstPage || !hasMore || loading.current) return
    loading.current = true
    const loaded = more?.tweets ?? []
    setState({ source: firstPage, tweets: loaded, hasMore, status: 'loading' })

    void Effect.runPromiseExit(getTweetsPage(firstPage.tweets.length + loaded.length)).then(
      (exit) => {
        loading.current = false
        setState((current) => {
          if (current?.source !== firstPage) return current

          return Exit.isSuccess(exit)
            ? {
                source: firstPage,
                tweets: [...current.tweets, ...exit.value.tweets],
                hasMore: exit.value.hasMore,
                status: 'idle',
              }
            : { ...current, status: 'failed' }
        })
      },
    )
  }, [firstPage, hasMore, more])

  return { tweets, hasMore, status: more?.status ?? 'idle', loadMore }
}
