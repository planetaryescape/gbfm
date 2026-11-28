import { Effect } from 'effect'

import { emptyDocument } from '../../features/dashboard/document'
import { parseDashboardDocument } from '../../features/dashboard/projection'
import { endpointFor, isAdminSection } from '../../features/dashboard/sections'
import { Route } from '../../route'
import { apiRequest } from '../../server/api'

export const dashboardAccessStatus = (
  route: Route,
  principal: { readonly role: string | null } | null,
) =>
  Route.guards.Dashboard(route) &&
  principal !== null &&
  isAdminSection(route.section) &&
  principal.role !== 'admin'
    ? 403
    : undefined

export const loadDashboardData = async (
  request: Request,
  route: Route,
  url: URL,
  principal: { readonly role: string | null } | null,
  requestApi: typeof apiRequest = apiRequest,
) => {
  if (dashboardAccessStatus(route, principal) === 403) return emptyDocument

  const path =
    Route.guards.Dashboard(route) &&
    principal &&
    (!isAdminSection(route.section) || principal.role === 'admin')
      ? endpointFor(route.section, url.searchParams)
      : null

  return path
    ? requestApi(request, path, { method: 'GET' })
        .then(async (response) =>
          response.ok
            ? Effect.runPromise(parseDashboardDocument(path, await response.json()))
            : null,
        )
        .catch(() => null)
    : null
}
