import { expect, test } from 'vitest'

import {
  reduceTweetPages,
  tweetPagesView,
  TweetPagesEvent,
  TweetPagesState,
  type TweetPage,
} from './tweetPagesState'

const source = (): TweetPage => ({ tweets: [], hasMore: true })

test('loading, failed retry and exhausted pages retain the same source', () => {
  const first = source()
  const initial = TweetPagesState.Initial()
  expect(tweetPagesView(initial, null)).toEqual({
    tweets: [],
    loaded: [],
    hasMore: false,
    status: 'idle',
  })
  const loading = reduceTweetPages(initial, TweetPagesEvent.Started({ source: first, ...first }))
  expect(tweetPagesView(loading, first).status).toBe('loading')
  const failed = reduceTweetPages(loading, TweetPagesEvent.Failed({ source: first }))
  expect(tweetPagesView(failed, first)).toEqual({
    tweets: [],
    loaded: [],
    hasMore: true,
    status: 'failed',
  })
  const retry = reduceTweetPages(failed, TweetPagesEvent.Started({ source: first, ...first }))

  const exhausted = reduceTweetPages(
    retry,
    TweetPagesEvent.Loaded({ source: first, page: { tweets: [], hasMore: false } }),
  )

  expect(tweetPagesView(exhausted, first)).toEqual({
    tweets: [],
    loaded: [],
    hasMore: false,
    status: 'idle',
  })
})

test('page source replacement hides old work and rejects completion once a new source starts', () => {
  const first = source()
  const replacement = source()

  const loading = reduceTweetPages(
    TweetPagesState.Initial(),
    TweetPagesEvent.Started({ source: first, ...first }),
  )

  expect(tweetPagesView(loading, replacement).status).toBe('idle')

  const next = reduceTweetPages(
    loading,
    TweetPagesEvent.Started({ source: replacement, ...replacement }),
  )

  expect(
    reduceTweetPages(
      next,
      TweetPagesEvent.Loaded({ source: first, page: { tweets: [], hasMore: false } }),
    ),
  ).toBe(next)
  expect(reduceTweetPages(next, TweetPagesEvent.Failed({ source: first }))).toBe(next)
})

test('completion for a hidden source remains stored but cannot change the replacement view', () => {
  const first = source()
  const replacement = source()

  const loading = reduceTweetPages(
    TweetPagesState.Initial(),
    TweetPagesEvent.Started({ source: first, ...first }),
  )

  const completed = reduceTweetPages(
    loading,
    TweetPagesEvent.Loaded({ source: first, page: { tweets: [], hasMore: false } }),
  )

  expect(tweetPagesView(completed, replacement).hasMore).toBe(true)
  expect(tweetPagesView(completed, first).hasMore).toBe(false)
})
