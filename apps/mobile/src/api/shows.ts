import type { GetAllShowsResponse, GetShowEpisodesResponse } from '@gbfm/api/shows'
import { Data, Effect, Option, Stream } from 'effect'

import { getApiClient, type ApiClient } from '@/api/client'

export type Show = (typeof GetAllShowsResponse.Type)['data'][number]

export type ShowEpisode = (typeof GetShowEpisodesResponse.Type)['data'][number]

export const getShows = Effect.gen(function* () {
  const client = yield* getApiClient
  const result = yield* client.shows.getAllShows({ query: { limit: 10, offset: 0 } })

  return result.data
})

const episodePageSize = 50

class IncompleteShowEpisodes extends Data.TaggedError('IncompleteShowEpisodes')<{
  readonly offset: number
}> {}

export const getShowEpisodesWithClient = (
  client: Pick<ApiClient['shows'], 'getShowEpisodes'>,
  slug: string,
) =>
  Stream.paginate(0, (offset) =>
    Effect.gen(function* () {
      const { data, pagination } = yield* client.getShowEpisodes({
        params: { slug },
        query: { limit: episodePageSize, offset },
      })

      if (!pagination.hasMore) return [data, Option.none()] as const

      if (data.length === 0) return yield* new IncompleteShowEpisodes({ offset })

      return [data, Option.some(offset + data.length)] as const
    }),
  ).pipe(Stream.runCollect)

export const getShowEpisodes = (slug: string) =>
  getApiClient.pipe(Effect.flatMap((client) => getShowEpisodesWithClient(client.shows, slug)))
