import { Effect } from 'effect'
import { createElement, useEffect, useEffectEvent } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
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

  let view: ReactTestRenderer | undefined
  await act(() => {
    view = create(createElement(Pager, { page: first }))
  })

  if (!current || !view) throw new Error('pager not mounted')
  const mounted = view
  const staleLoad = current.loadMore
  await act(() => {
    current?.loadMore()
    current?.loadMore()
  })
  expect(requests).toHaveLength(1)
  await act(() => mounted.update(createElement(Pager, { page: replacement })))
  expect(requests[0]?.signal.aborted).toBe(true)
  await act(() => {
    staleLoad()
    current?.loadMore()
  })
  expect(requests).toHaveLength(2)
  await act(() => requests[0]?.finish({ tweets: [], hasMore: false }))
  await act(() => current?.loadMore())
  expect(requests).toHaveLength(2)
  expect(current.hasMore).toBe(true)
  expect(current.status).toBe('loading')
  await act(() => mounted.unmount())
  expect(requests[1]?.signal.aborted).toBe(true)
  await act(() => staleLoad())
  expect(requests).toHaveLength(2)
})
