import { expect, test } from 'vitest'

import type { Tweet } from '@/api/tweets'

import {
  reduceTweetPages,
  tweetPagesView,
  TweetPagesEvent,
  TweetPagesState,
  type TweetPage,
} from './tweetPagesState'

const tweet = (id: string): Tweet => ({
  id,
  slug: id,
  title: null,
  description: null,
  thumbnailUrl: null,
  content: id,
  compiledContent: id,
  draft: false,
  tags: [],
  type: 'micro',
  musicEntityType: null,
  musicEntityId: null,
  parentPostId: null,
  rootPostId: null,
  quotedPostId: null,
  depth: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const source = (id: string): TweetPage => ({ tweets: [tweet(id)], hasMore: true })

const start = (state: TweetPagesState, page: TweetPage) => {
  const view = tweetPagesView(state, page)

  return reduceTweetPages(
    state,
    TweetPagesEvent.Started({ source: page, tweets: view.loaded, hasMore: view.hasMore }),
  )
}

test('loading, failed retry and exhausted pages retain the same source', () => {
  const first = source('first')
  const initial = TweetPagesState.Initial()
  expect(tweetPagesView(initial, null)).toEqual({
    tweets: [],
    loaded: [],
    hasMore: false,
    status: 'idle',
  })
  const loading = start(initial, first)
  expect(tweetPagesView(loading, first).status).toBe('loading')
  const failed = reduceTweetPages(loading, TweetPagesEvent.Failed({ source: first }))
  expect(tweetPagesView(failed, first)).toEqual({
    tweets: first.tweets,
    loaded: [],
    hasMore: true,
    status: 'failed',
  })
  const retry = start(failed, first)
  expect(tweetPagesView(retry, first).status).toBe('loading')
  const second = source('second')
  const loaded = reduceTweetPages(retry, TweetPagesEvent.Loaded({ source: first, page: second }))
  expect(tweetPagesView(loaded, first)).toEqual({
    tweets: [...first.tweets, ...second.tweets],
    loaded: second.tweets,
    hasMore: true,
    status: 'idle',
  })
  const third = { tweets: [tweet('third')], hasMore: false }

  const exhausted = reduceTweetPages(
    start(loaded, first),
    TweetPagesEvent.Loaded({ source: first, page: third }),
  )

  expect(tweetPagesView(exhausted, first)).toEqual({
    tweets: [...first.tweets, ...second.tweets, ...third.tweets],
    loaded: [...second.tweets, ...third.tweets],
    hasMore: false,
    status: 'idle',
  })
})

test('page source replacement hides old work and rejects completion once a new source starts', () => {
  const first = source('first')
  const replacement = source('replacement')

  const loading = start(TweetPagesState.Initial(), first)

  expect(tweetPagesView(loading, replacement)).toEqual({
    tweets: replacement.tweets,
    loaded: [],
    hasMore: true,
    status: 'idle',
  })

  const next = start(loading, replacement)

  expect(
    reduceTweetPages(next, TweetPagesEvent.Loaded({ source: first, page: source('stale') })),
  ).toBe(next)
  expect(reduceTweetPages(next, TweetPagesEvent.Failed({ source: first }))).toBe(next)
})

test('completion for a hidden source remains stored but cannot change the replacement view', () => {
  const first = source('first')
  const replacement = source('replacement')

  const loading = start(TweetPagesState.Initial(), first)
  const page = { tweets: [tweet('second')], hasMore: false }

  const completed = reduceTweetPages(loading, TweetPagesEvent.Loaded({ source: first, page }))

  expect(tweetPagesView(completed, replacement)).toEqual({
    tweets: replacement.tweets,
    loaded: [],
    hasMore: true,
    status: 'idle',
  })
  expect(tweetPagesView(completed, first)).toEqual({
    tweets: [...first.tweets, ...page.tweets],
    loaded: page.tweets,
    hasMore: false,
    status: 'idle',
  })
})
