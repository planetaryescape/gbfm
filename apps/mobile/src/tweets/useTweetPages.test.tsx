import { Effect } from 'effect'
import { act, createElement, useEffect, useEffectEvent } from 'react'
import { createRoot } from 'test-renderer'
import { expect, test } from 'vitest'

import type { TweetPage } from './tweetPagesState'
import { useTweetPages } from './useTweetPages'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('pagination replacement aborts the old request without releasing the new request gate', async () => {
  let current: ReturnType<typeof useTweetPages> | undefined

  const requests: Array<{
    offset: number
    signal: AbortSignal
    finish: (page: TweetPage) => void
  }> = []

  const first: TweetPage = { tweets: [], hasMore: true }
  const replacement: TweetPage = { tweets: [], hasMore: true }

  const getPage = (offset: number) =>
    Effect.promise(
      (signal) => new Promise<TweetPage>((finish) => requests.push({ offset, signal, finish })),
    )

  function Pager({ page }: { readonly page: TweetPage }) {
    const pages = useTweetPages(page, getPage)
    useEffect(() => {
      current = pages
    })
    const loadReplacement = useEffectEvent(() => pages.loadMore())
    useEffect(() => {
      if (page === replacement) loadReplacement()
    }, [page])

    return null
  }

  const mounted = createRoot()
  await act(async () => {
    mounted.render(createElement(Pager, { page: first }))
  })

  if (!current) throw new Error('pager not mounted')
  const staleLoad = current.loadMore
  await act(async () => {
    current?.loadMore()
    current?.loadMore()
  })
  expect(requests).toHaveLength(1)
  await act(async () => mounted.render(createElement(Pager, { page: replacement })))
  expect(requests[0]?.signal.aborted).toBe(true)
  await act(async () => {
    staleLoad()
    current?.loadMore()
  })
  expect(requests).toHaveLength(2)
  await act(async () => requests[0]?.finish({ tweets: [], hasMore: false }))
  await act(async () => current?.loadMore())
  expect(requests).toHaveLength(2)
  expect(current.hasMore).toBe(true)
  expect(current.status).toBe('loading')
  await act(async () => mounted.unmount())
  expect(requests[1]?.signal.aborted).toBe(true)
  await act(async () => staleLoad())
  expect(requests).toHaveLength(2)
})
