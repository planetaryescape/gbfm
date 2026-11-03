import { Effect, Exit } from 'effect'
import { useCallback, useEffect, useRef, useState } from 'react'

import { loadOlderReaderPost, loadReaderEntry } from '@/api/tweetReader'
import type { Tweet } from '@/api/tweets'

import { readerConnection } from './useTweetReader'

type Page = {
  readonly tweets: ReadonlyArray<Tweet>
  readonly older: string | null
}

export function useAnchoredFeed(sessionToken: string | null, startSlug: string | null) {
  const [page, setPage] = useState<Page | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failed, setFailed] = useState(false)
  const pending = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    pending.current = controller

    const work = readerConnection(sessionToken).pipe(
      Effect.flatMap((connection) => loadReaderEntry(connection, startSlug)),
      Effect.timeout('15 seconds'),
    )

    void Effect.runPromiseExit(work, { signal: controller.signal }).then((exit) => {
      if (controller.signal.aborted) return
      pending.current = null

      if (Exit.isFailure(exit)) {
        setStatus('error')

        return
      }

      const tweet = exit.value?.post
      setPage({ tweets: tweet ? [tweet] : [], older: tweet?.slug ?? null })
      setStatus('ready')
    })

    return () => {
      controller.abort()
      pending.current?.abort()
    }
  }, [sessionToken, startSlug])

  const loadMore = useCallback(() => {
    const slug = page?.older

    if (!slug || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setFailed(false)

    const work = readerConnection(sessionToken).pipe(
      Effect.flatMap((connection) => loadOlderReaderPost(connection, slug)),
      Effect.timeout('15 seconds'),
    )

    void Effect.runPromiseExit(work, { signal: controller.signal }).then((exit) => {
      if (controller.signal.aborted) return
      pending.current = null

      if (Exit.isFailure(exit)) {
        setFailed(true)

        return
      }

      const tweet = exit.value?.post
      setPage((current) =>
        current
          ? {
              tweets:
                tweet && !current.tweets.some((item) => item.slug === tweet.slug)
                  ? [...current.tweets, tweet]
                  : current.tweets,
              older: tweet?.slug ?? null,
            }
          : current,
      )
    })
  }, [page, sessionToken])

  return {
    status,
    tweets: page?.tweets ?? [],
    hasMore: Boolean(page?.older),
    loadMoreFailed: failed,
    loadMore,
  }
}
