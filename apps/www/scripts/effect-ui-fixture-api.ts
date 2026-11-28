import { URL } from 'node:url'

import { fetch as fixtureFetch, Headers, type Request, Response } from 'miniflare'

export const parseFixtureBase = (input: string | undefined): URL | undefined => {
  if (input === undefined) return undefined
  const url = URL.parse(input)

  if (
    !url ||
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.port === '0' ||
    url.port === '3003' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('The frontend fixture base must be an HTTP loopback origin on a non-3003 port')

  return url
}

export const createFixtureApiBinding = (
  input: string | undefined,
): ((request: Request) => Promise<Response>) => {
  const origin = parseFixtureBase(input)?.origin

  return async (request) => {
    const source = new URL(request.url)

    if (origin === undefined) {
      const session =
        ['/auth/get-session', '/api/auth/get-session'].includes(source.pathname) &&
        ['GET', 'HEAD'].includes(request.method)

      const body = session ? 'null' : '{"error":"Unconfigured local fixture endpoint"}'

      return new Response(request.method === 'HEAD' ? null : body, {
        status: session ? 200 : 404,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'private, no-store',
        },
      })
    }

    const target = new URL(origin)
    target.pathname = source.pathname
    target.search = source.search
    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')

    return fixtureFetch(target, {
      method: request.method,
      headers,
      body: request.body,
      signal: request.signal,
      redirect: 'manual',
      duplex: 'half',
    })
  }
}
