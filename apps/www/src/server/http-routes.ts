import { parseRoute, Route } from '../route'

export const handlesHttpRequest = (request: Request): boolean => {
  const url = new URL(request.url)
  const path = url.pathname

  if (url.searchParams.has('__data')) return true

  if (
    path === '/connect/gbfm' ||
    path.startsWith('/connect/gbfm/') ||
    path === '/telemetry/browser' ||
    path.startsWith('/social/cards/') ||
    path.startsWith('/social/tweets/') ||
    path === '/actions/mosaic'
  )
    return true

  if (
    path.startsWith('/api/') ||
    path.startsWith('/s/') ||
    ['/rss.xml', '/sitemap.xml', '/mcp.txt'].includes(path) ||
    (path === '/auth/verify-email' && url.searchParams.has('token'))
  )
    return true
  const route = parseRoute(path)

  if (path.startsWith('/auth/') && !Route.guards.Auth(route)) return true

  return request.method === 'POST' && (Route.guards.Auth(route) || path.startsWith('/actions/'))
}
