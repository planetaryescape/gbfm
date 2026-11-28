import { GetAllShowsResponse } from '@gbfm/api/shows'
import { Effect, Schema } from 'effect'

import type { ShowsDocument } from '../../domain/shows'
import { Route } from '../../route'
import { optionalPageRequest } from '../../server/page-data/requests'
import { json } from '../../server/page-data/shared'

export const loadShowsData = (
  request: Request,
  endpoint: string | null,
  route: Route,
  url: URL,
) => {
  const listing = Route.guards.Listing(route) && route.kind === 'shows'

  if (!endpoint || !listing) return null

  return Effect.runPromise(optionalPageRequest(request, endpoint)).then(async (response) => {
    const payload = response?.ok ? await json(response) : null
    const all = response?.ok ? Schema.decodeUnknownSync(GetAllShowsResponse)(payload) : null

    let shows: ShowsDocument | null = null

    if (all) {
      const selectedSlug = url.searchParams.get('show') ?? all.data[0]?.slug ?? null

      shows = {
        shows: all.data,
        selectedSlug,
        episodes: null,
      }
    }

    return {
      response,
      payload,
      shows,
      detailSlug: null,
      metadata: null,
    }
  })
}
