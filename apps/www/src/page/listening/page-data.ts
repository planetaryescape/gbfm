import { ImportPreview, ListeningDocument } from '@gbfm/api/listening'
import { Option, Schema } from 'effect'

import type { ListeningPage } from '../../domain/listening'
import { Route } from '../../route'
import { apiRequest } from '../../server/api'

/** Loads private workspace data only with a principal, public data through public endpoints. */
export const loadListeningPage = async (
  request: Request,
  route: Route,
  url: URL,
  signedIn: boolean,
): Promise<{ page: ListeningPage; status: number } | null> => {
  const workspace = Route.guards.Static(route) && route.page === 'listening'

  const publicPage =
    (Route.guards.Listing(route) || Route.guards.Detail(route)) && route.kind === 'collections'

  if (!workspace && !publicPage) return null
  const empty = { mixes: [], collections: [], memberships: [] }

  if (workspace && !signedIn)
    return { page: { document: empty, workspace, preview: null, error: null }, status: 200 }

  const path = workspace
    ? '/api/listening'
    : Route.guards.Detail(route)
      ? `/api/listening/public/${encodeURIComponent(route.slug)}`
      : '/api/listening/public'

  try {
    const response = await apiRequest(request, path, { method: 'GET' })

    const parsed = response.ok
      ? Option.getOrNull(Schema.decodeUnknownOption(ListeningDocument)(await response.json()))
      : null

    if (!parsed)
      return {
        page: {
          document: empty,
          workspace,
          preview: null,
          error: 'Could not load this collection. Please try again.',
        },
        status: response.status === 404 ? 404 : 503,
      }
    const source = workspace ? url.searchParams.get('import') : null
    let preview: typeof ImportPreview.Type | null = null
    let error: string | null = null

    if (source) {
      const result = await apiRequest(request, '/api/listening/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: source }),
      })

      preview = result.ok
        ? Option.getOrNull(Schema.decodeUnknownOption(ImportPreview)(await result.json()))
        : null

      if (!preview)
        error =
          'This link could not be imported. Check that it is public and supported. You can still paste individual mix links.'
    }

    return { page: { document: parsed, workspace, preview, error }, status: 200 }
  } catch {
    return {
      page: {
        document: empty,
        workspace,
        preview: null,
        error: 'Listening library is unavailable. Please try again.',
      },
      status: 503,
    }
  }
}
