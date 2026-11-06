import { createServer } from 'node:http'

import { Predicate, Schema } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import { renderResponse } from './request-dispatch'

afterEach(() => vi.unstubAllEnvs())

test('website forwards the plain-text MCP guide and unavailable status without rendering a page', async () => {
  const requests: Array<string | undefined> = []
  let status = 200

  const server = createServer((request, response) => {
    requests.push(request.url)
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(status === 200 ? 'GBFM MCP connection instructions\n' : 'MCP unavailable\n')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
      server.address(),
    )

    vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

    for (const upstreamStatus of [200, 503]) {
      status = upstreamStatus
      const result = await renderResponse(new Request('https://goosebumps.fm/mcp.txt'))

      expect(Predicate.isTagged(result, 'Responded')).toBe(true)

      if (!Predicate.isTagged(result, 'Responded')) throw new Error('Expected raw guide response')

      expect(result.response.status).toBe(upstreamStatus)
      expect(result.response.headers.get('content-type')).toContain('text/plain')
      expect(result.response.headers.get('cache-control')).toBe('no-store')
      expect(await result.response.text()).toBe(
        upstreamStatus === 200 ? 'GBFM MCP connection instructions\n' : 'MCP unavailable\n',
      )
    }

    expect(requests).toEqual(['/mcp.txt', '/mcp.txt'])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
