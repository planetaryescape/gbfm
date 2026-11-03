import { Effect, Exit } from 'effect'
import { useEffect, useState } from 'react'

import { getTweetsPage } from '@/api/tweets'

import { useTweetPages } from './useTweetPages'

type FirstPage = Effect.Success<ReturnType<typeof getTweetsPage>>

export function useTweetFeed() {
  const [first, setFirst] = useState<FirstPage | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const pages = useTweetPages(first)

  useEffect(() => {
    const controller = new AbortController()

    void Effect.runPromiseExit(getTweetsPage(0).pipe(Effect.timeout('15 seconds')), {
      signal: controller.signal,
    }).then((exit) => {
      if (controller.signal.aborted) return

      if (Exit.isSuccess(exit)) {
        setFirst(exit.value)
        setStatus('ready')
      } else {
        setStatus('error')
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
