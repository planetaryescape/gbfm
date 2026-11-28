import { createServer } from 'node:http'

import { Predicate, Schema } from 'effect'
import { vi } from 'vitest'

import { renderPage } from '../../entry.effect.server'

export interface ConnectionApiCall {
  readonly path: string
  readonly method: string
  readonly body: string
  readonly cookie: string | undefined
  readonly origin: string | undefined
}

export const connectionQuery = (writes = false) => {
  const query = new URLSearchParams({
    client_id: 'native-http-fixture',
    scope: writes ? 'posts:read drafts:write offline_access' : 'posts:read offline_access',
    redirect_uri: 'http://127.0.0.1:38479/callback',
    exp: '9999999999',
    sig: 'synthetic-provider-verified-continuation',
    state: 'native-http-fixture-state',
  })

  for (const key of [...query.keys(), 'ba_param']) query.append('ba_param', key)

  return query
}

export const renderConnection = async (request: Request) => {
  const result = await renderPage(request)

  if (!Predicate.isTagged(result, 'Responded'))
    throw new Error('Connect HTTP request unexpectedly reached application rendering')

  return result.response
}

export const withConnectionApi = async (
  respond: (call: ConnectionApiCall) => Response | Promise<Response>,
  verify: (calls: ReadonlyArray<ConnectionApiCall>) => Promise<void>,
) => {
  const calls: Array<ConnectionApiCall> = []

  const server = createServer(async (request, reply) => {
    let body = ''

    for await (const chunk of request) body += chunk

    const call = {
      path: request.url ?? '',
      method: request.method ?? '',
      body,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
    }

    calls.push(call)

    const response = await respond(call)

    reply.statusCode = response.status
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') reply.setHeader(name, value)
    })

    const cookies = response.headers.getSetCookie()

    if (cookies.length) reply.setHeader('set-cookie', cookies)

    reply.end(await response.text())
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())

  vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

  try {
    await verify(calls)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

export const connectionCookies = (response: Response, cookies: ReadonlyArray<string>) => {
  for (const cookie of cookies) response.headers.append('set-cookie', cookie)

  return response
}
