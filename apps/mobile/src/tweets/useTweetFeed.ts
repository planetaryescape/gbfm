import { Data, Effect, Exit } from 'effect'
import { useEffect, useState } from 'react'

import { getTweetsPage } from '@/api/tweets'

import { useTweetPages } from './useTweetPages'

type FirstPage = Effect.Success<ReturnType<typeof getTweetsPage>>

type FeedState =
  | { readonly _tag: 'Loading' }
  | { readonly _tag: 'Ready'; readonly page: FirstPage }
  | { readonly _tag: 'Failed' }

const FeedState = Data.taggedEnum<FeedState>()

const initial = FeedState.Loading()

export function useTweetFeed() {
  const [state, setState] = useState<FeedState>(initial)
  const first = FeedState.$is('Ready')(state) ? state.page : null

  const status = FeedState.$match(state, {
    Loading: () => 'loading' as const,
    Ready: () => 'ready' as const,
    Failed: () => 'error' as const,
  })

  const pages = useTweetPages(first)

  useEffect(() => {
    const controller = new AbortController()

    void Effect.runPromiseExit(getTweetsPage(0).pipe(Effect.timeout('15 seconds')), {
      signal: controller.signal,
    }).then((exit) => {
      if (controller.signal.aborted) return

      if (Exit.isSuccess(exit)) {
        setState(FeedState.Ready({ page: exit.value }))
      } else {
        setState(FeedState.Failed())
      }
    })

    return () => controller.abort()
  }, [])

  return {
    status,
    tweets: pages.tweets,
    hasMore: pages.hasMore,
    loadMoreFailed: pages.status === 'failed',
    loadMore: pages.loadMore,
  }
}
