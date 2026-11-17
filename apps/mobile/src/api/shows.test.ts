import { Api } from '@gbfm/api/api'
import { Effect, Exit } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { describe, expect, it } from 'vitest'

import { getShowEpisodesWithClient, type ShowEpisode } from './shows'

const episodes = Array.from({ length: 101 }, (_, index): ShowEpisode => ({
  id: `episode-${index}`,
  title: `Episode ${index}`,
  slug: `episode-${index}`,
  url: `https://cdn.example/episode-${index}.mp3`,
  type: 'mix',
  description: null,
  thumbnailUrl: null,
  bannerImageUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  draft: false,
  tags: null,
  content: '',
  showId: null,
  episodeNumber: index,
  playCount: 0,
  creators: [],
  artists: [],
}))

const fixture = (secondPage: 'ready' | 'unavailable' | 'empty' = 'ready') => {
  const requests: Array<string> = []

  const httpClient = HttpClient.make((request, url) => {
    requests.push(`${url.pathname}${url.search}`)
    const offset = Number(url.searchParams.get('offset'))
    const limit = Number(url.searchParams.get('limit'))

    const response =
      offset === 50 && secondPage === 'unavailable'
        ? new Response(null, { status: 500 })
        : Response.json({
            data:
              offset === 50 && secondPage === 'empty' ? [] : episodes.slice(offset, offset + limit),
            pagination: {
              total: episodes.length,
              offset,
              limit,
              hasMore: offset + limit < episodes.length,
            },
          })

    return Effect.succeed(HttpClientResponse.fromWeb(request, response))
  })

  const load = HttpApiClient.make(Api, { baseUrl: 'https://api.example' }).pipe(
    Effect.provideService(HttpClient.HttpClient, httpClient),
    Effect.flatMap((client) => getShowEpisodesWithClient(client.shows, 'radio')),
  )

  return { requests, load }
}

describe('show episodes', () => {
  it('returns every page in show order', async () => {
    const { load, requests } = fixture()

    expect(await Effect.runPromise(load)).toEqual(episodes)
    expect(requests).toEqual([
      '/api/shows/radio/episodes?limit=50&offset=0',
      '/api/shows/radio/episodes?limit=50&offset=50',
      '/api/shows/radio/episodes?limit=50&offset=100',
    ])
  })

  it.each(['unavailable', 'empty'] as const)(
    'fails without returning a partial list if the next page is %s',
    async (secondPage) => {
      const { load, requests } = fixture(secondPage)

      expect(Exit.isFailure(await Effect.runPromiseExit(load))).toBe(true)
      expect(requests).toHaveLength(2)
    },
  )
})
