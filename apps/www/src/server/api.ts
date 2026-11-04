import { resolveRequestId } from '@gbfm/core/observability/request-id'

import { Route } from '../route'

/** The original Request preserves streaming bodies, aborts and all response cookies. */
export const apiRequest = async (
  request: Request,
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(init?.headers ?? request.headers)
  const cookie = request.headers.get('cookie')
  const traceparent = request.headers.get('traceparent')
  const clientIp = request.headers.get('cf-connecting-ip')

  if (cookie) headers.set('cookie', cookie)

  if (traceparent) headers.set('traceparent', traceparent)

  if (clientIp) headers.set('cf-connecting-ip', clientIp)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('x-request-id', resolveRequestId(request.headers.get('x-request-id')))
  const target = new URL(path, 'https://api.internal')

  const forwarded = init
    ? new Request(target, { ...init, headers, signal: request.signal })
    : new Request(target, request)

  headers.forEach((value, name) => forwarded.headers.set(name, value))

  if (import.meta.env.PROD) {
    const { env } = await import('cloudflare:workers')

    return env.API.fetch(forwarded)
  }

  return fetch(
    new Request(new URL(path, process.env.VPS_PROXY_TARGET ?? 'http://127.0.0.1:3003'), forwarded),
  )
}

const endpoints = new Map([
  ['mixes', '/api/content/audio/mix'],
  ['tracks', '/api/content/audio/track'],
  ['shows', '/api/shows'],
  ['editorial', '/api/content/posts/editorials'],
  ['tweets', '/api/content/posts/micro'],
  ['labels', '/api/music/labels'],
  ['releases', '/api/content/releases'],
  ['tags', '/api/content/posts/tags'],
  ['djs', '/api/user/djs'],
  ['profile', '/api/profile'],
  ['resolve', '/api/resolve'],
])

export const endpointFor = (route: Route): string | null =>
  Route.match(route, {
    Home: () => '/api/content/homepage-mixes',
    Listing: ({ kind }) => {
      if (kind === 'editorial') return '/api/content/editorial-summaries'

      return kind === 'shows' ? '/api/shows?limit=100&offset=0' : (endpoints.get(kind) ?? null)
    },
    Detail: ({ kind, slug }) => {
      if (kind === 'tags') return `/api/content/tag/${encodeURIComponent(slug)}`
      const root = endpoints.get(kind)

      return root
        ? `${root}${kind === 'labels' ? '/slug' : ''}/${encodeURIComponent(slug)}${kind === 'tweets' ? '/screen?part=main' : ''}`
        : null
    },
    Auth: () => null,
    Composer: () => null,
    Dashboard: () => null,
    Static: () => null,
    NotFound: () => null,
  })
