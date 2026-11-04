import { Data } from 'effect'

import type { Tweet } from '@/api/tweets'

import { appendTweets } from './appendTweets'

export type TweetPage = { readonly tweets: ReadonlyArray<Tweet>; readonly hasMore: boolean }

type MorePage = TweetPage & { readonly source: TweetPage }

export type TweetPagesState =
  | { readonly _tag: 'Initial' }
  | ({ readonly _tag: 'Loading' } & MorePage)
  | ({ readonly _tag: 'Ready' } & MorePage)
  | ({ readonly _tag: 'Failed' } & MorePage)

export const TweetPagesState = Data.taggedEnum<TweetPagesState>()

export type TweetPagesEvent =
  | ({ readonly _tag: 'Started' } & MorePage)
  | { readonly _tag: 'Loaded'; readonly source: TweetPage; readonly page: TweetPage }
  | { readonly _tag: 'Failed'; readonly source: TweetPage }

export const TweetPagesEvent = Data.taggedEnum<TweetPagesEvent>()

const moreFor = (state: TweetPagesState, source: TweetPage | null) =>
  !TweetPagesState.$is('Initial')(state) && state.source === source ? state : null

export const tweetPagesView = (state: TweetPagesState, source: TweetPage | null) => {
  const more = moreFor(state, source)

  return {
    tweets: source ? appendTweets(source.tweets, more?.tweets ?? []) : [],
    loaded: more?.tweets ?? [],
    hasMore: more ? more.hasMore : (source?.hasMore ?? false),
    status: more
      ? TweetPagesState.$match(more, {
          Initial: () => 'idle' as const,
          Loading: () => 'loading' as const,
          Ready: () => 'idle' as const,
          Failed: () => 'failed' as const,
        })
      : ('idle' as const),
  }
}

export const reduceTweetPages = (
  state: TweetPagesState,
  event: TweetPagesEvent,
): TweetPagesState => {
  if (TweetPagesEvent.$is('Started')(event)) return TweetPagesState.Loading(event)
  const more = moreFor(state, event.source)

  if (!more) return state

  return TweetPagesEvent.$match(event, {
    Started: () => state,
    Loaded: ({ source, page }) =>
      TweetPagesState.Ready({
        source,
        tweets: [...more.tweets, ...page.tweets],
        hasMore: page.hasMore,
      }),
    Failed: () => TweetPagesState.Failed(more),
  })
}
