import * as Server from 'foldkit/experimental/server'
import { expect, test } from 'vitest'

import { websiteFetch } from './worker-fetch'

const fetchPage = (request: Request) =>
  Server.handleRequest(request, {
    renderPage: async () => Server.Responded(new Response('page')),
    renderDocument: () => '',
  })

test('plain-text guide bypasses Foldkit asset classification and preserves the API response', async () => {
  const requests: Array<Request> = []
  const fetch = websiteFetch(fetchPage)

  for (const method of ['GET', 'HEAD']) {
    const request = new Request('https://goosebumps.fm/mcp.txt?source=client', {
      method,
      headers: { accept: 'text/plain', 'x-request-id': 'guide-request' },
    })

    expect((await fetchPage(request)).status).toBe(404)

    const upstream = new Response(method === 'HEAD' ? null : 'connection guide', {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })

    const response = await fetch(request, {
      API: {
        fetch: async (forwarded) => {
          requests.push(forwarded)

          return upstream
        },
      },
    })

    expect(response).toBe(upstream)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(method === 'HEAD' ? '' : 'connection guide')
  }

  expect(requests.map((request) => request.url)).toEqual([
    'https://api.internal/mcp.txt?source=client',
    'https://api.internal/mcp.txt?source=client',
  ])
  expect(requests.map((request) => request.method)).toEqual(['GET', 'HEAD'])
  expect(requests.map((request) => request.headers.get('x-request-id'))).toEqual([
    'guide-request',
    'guide-request',
  ])
})

test('guide unavailability remains a plain-text 503 rather than an asset 404', async () => {
  const response = await websiteFetch(fetchPage)(new Request('https://goosebumps.fm/mcp.txt'), {
    API: {
      fetch: async () =>
        new Response('MCP unavailable', {
          status: 503,
          headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
        }),
    },
  })

  expect(response.status).toBe(503)
  expect(response.headers.get('content-type')).toBe('text/plain')
  expect(await response.text()).toBe('MCP unavailable')
})

test('ordinary pages and missing static assets retain the real Foldkit handler behavior', async () => {
  const fetch = websiteFetch(fetchPage)
  const requests: Array<Request> = []

  const bindings = {
    API: {
      fetch: async (request: Request) => {
        requests.push(request)

        return new Response('unexpected API request', { status: 500 })
      },
    },
  }

  expect((await fetch(new Request('https://goosebumps.fm/editorial'), bindings)).status).toBe(200)
  expect(
    (await fetch(new Request('https://goosebumps.fm/assets/missing.js'), bindings)).status,
  ).toBe(404)
  expect(
    (await fetch(new Request('https://goosebumps.fm/not-the-guide.txt'), bindings)).status,
  ).toBe(404)
  expect(requests).toEqual([])
})
