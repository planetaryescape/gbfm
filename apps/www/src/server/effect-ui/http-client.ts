import { Layer, Predicate } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { siteHttpClientLayer } from '../../app/http-client'
import { apiRequest } from '../api'

interface StreamingRequestInit extends RequestInit {
  readonly duplex: 'half'
}

export const requestFetch = (
  source: Request,
  send: typeof apiRequest = apiRequest,
): typeof fetch => {
  const origin = new URL(source.url)

  return async (input, init) => {
    let address: string

    if (Predicate.isString(input)) address = input
    else if (input instanceof URL) address = input.href
    else address = input.url

    const url = URL.parse(address, origin)

    if (
      !url ||
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith('/api/')
    )
      throw new Error('Server component requests must target the same-origin API.')

    const target = new Request(input instanceof Request ? input : url, init)
    const headers = new Headers(source.headers)

    target.headers.forEach((value, name) => headers.set(name, value))
    const authorization = source.headers.get('authorization')

    if (authorization) headers.set('authorization', authorization)
    else headers.delete('authorization')

    const owned = new Request(source, {
      signal: AbortSignal.any([source.signal, target.signal]),
    })

    const forwarded: StreamingRequestInit = {
      ...init,
      method: target.method,
      headers,
      body: target.body,
      signal: owned.signal,
      duplex: 'half',
    }

    return send(owned, `${url.pathname}${url.search}`, forwarded)
  }
}

export const requestHttpClientLayer = (request: Request) => {
  const transport = Layer.succeed(FetchHttpClient.Fetch, requestFetch(request))

  return Layer.mergeAll(
    transport,
    siteHttpClientLayer(new URL(request.url)).pipe(Layer.provide(transport)),
  )
}
