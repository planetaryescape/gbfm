import type {
  GetMicroPostListResponse,
  MicroPostScreenMusic,
  MicroPostScreenPost,
} from '@gbfm/api/post'
import { Effect } from 'effect'

import { getApiClient } from '@/api/client'

export type Tweet = (typeof GetMicroPostListResponse.Type)['data'][number]

export type TweetScreenPost = MicroPostScreenPost

export type TweetMusic = MicroPostScreenMusic

export const TWEETS_PAGE_SIZE = 30

export const getTweetsPage = (offset: number) =>
  Effect.gen(function* () {
    const client = yield* getApiClient

    const result = yield* client.post.getMicroPosts({
      query: { limit: TWEETS_PAGE_SIZE, offset },
    })

    return { tweets: result.data, hasMore: result.pagination.hasMore }
  })

export const getTweetScreen = (slug: string) =>
  Effect.gen(function* () {
    const client = yield* getApiClient

    return yield* client.post.getMicroPostScreen({ params: { slug }, query: {} })
  })

export const getTweetTags = Effect.gen(function* () {
  const client = yield* getApiClient

  return yield* client.post.getMicroTags()
})
