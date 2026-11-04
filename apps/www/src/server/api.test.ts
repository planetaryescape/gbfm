import { createServer } from 'node:http'

import { Schema } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import { parseRoute } from '../route'
import { apiRequest, endpointFor } from './api'
import { contentItems, json } from './page-data/shared'

afterEach(() => vi.unstubAllEnvs())

test('OAuth form forwarding retains the original Cloudflare address with explicit headers', async () => {
  const addresses: Array<string | Array<string> | undefined> = []

  const server = createServer((request, response) => {
    addresses.push(request.headers['cf-connecting-ip'])
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
      server.address(),
    )

    vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)

    for (const clientIp of ['192.0.2.10', '192.0.2.11']) {
      await apiRequest(
        new Request('https://goosebumps.fm/connect/gbfm', {
          method: 'POST',
          headers: { 'cf-connecting-ip': clientIp },
        }),
        '/auth/sign-in/email',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      )
    }

    expect(addresses).toEqual(['192.0.2.10', '192.0.2.11'])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('editorial list navigation uses summaries without changing article detail reads', () => {
  expect(endpointFor(parseRoute('/editorial'))).toBe('/api/content/editorial-summaries')
  expect(endpointFor(parseRoute('/editorial/a-story'))).toBe(
    '/api/content/posts/editorials/a-story',
  )
  expect(endpointFor(parseRoute('/tweets'))).toBe('/api/content/posts/micro')
  expect(endpointFor(parseRoute('/shows'))).toBe('/api/shows?limit=100&offset=0')
})

test('a reload with cookies forwards revalidation to a summary read and retains card metadata', async () => {
  const requests: Array<{
    path: string | undefined
    cacheControl: string | undefined
    cookie: string | undefined
  }> = []

  const summary = {
    id: 'editorial-one',
    slug: 'a-story',
    title: 'Listening notes',
    description: 'Independent frequencies',
    thumbnailUrl: 'https://example.com/artwork.webp',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    creators: [{ id: 'creator-one', name: 'Local creator', username: 'local-creator' }],
    tags: ['ambient'],
  }

  const server = createServer((request, response) => {
    requests.push({
      path: request.url,
      cacheControl: request.headers['cache-control'],
      cookie: request.headers.cookie,
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        data: [summary],
        pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
      }),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
      server.address(),
    )

    vi.stubEnv('VPS_PROXY_TARGET', `http://127.0.0.1:${address.port}`)
    const endpoint = endpointFor(parseRoute('/editorial'))

    if (!endpoint) throw new Error('Missing editorial endpoint')

    const response = await apiRequest(
      new Request('https://goosebumps.fm/editorial', {
        headers: { 'cache-control': 'max-age=0', cookie: 'reader=fixture' },
      }),
      endpoint,
      { method: 'GET' },
    )

    const items = contentItems(await json(response), '/editorial')
    expect(requests).toEqual([
      {
        path: '/api/content/editorial-summaries',
        cacheControl: 'max-age=0',
        cookie: 'reader=fixture',
      },
    ])
    expect(items).toMatchObject([
      {
        id: summary.id,
        title: summary.title,
        description: summary.description,
        imageUrl: summary.thumbnailUrl,
        creators: summary.creators,
        tags: summary.tags,
        href: '/editorial/a-story',
        meta: summary.createdAt,
        content: '',
        richContent: null,
      },
    ])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
