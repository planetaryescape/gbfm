import { expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Predicate } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'

import { siteHttpClientLayer } from '../../app/http-client'
import { requestFetch } from './http-client'

it.effect('resolves component HTTP paths against the document origin', () => {
  const targets: Array<string> = []

  const transport = Layer.succeed(FetchHttpClient.Fetch, async (input) => {
    if (Predicate.isString(input)) targets.push(input)
    else if (input instanceof URL) targets.push(input.href)
    else targets.push(input.url)

    return Response.json({ ok: true })
  })

  return Effect.gen(function* () {
    const context = yield* Layer.build(
      siteHttpClientLayer(new URL('https://goosebumps.fm/tweets')).pipe(Layer.provide(transport)),
    )

    const client = Context.get(context, HttpClient.HttpClient)
    yield* client.get('/api/content/posts/micro/example?part=main')

    expect(targets).toEqual(['https://goosebumps.fm/api/content/posts/micro/example?part=main'])
  })
})

it('keeps server API identity and cancellation request-owned', async () => {
  const received: Array<{ cookie: string | null; path: string; aborted: boolean }> = []

  const send = async (source: Request, path: string) => {
    const value = {
      cookie: source.headers.get('cookie'),
      path,
      aborted: source.signal.aborted,
    }

    received.push(value)

    return Response.json(value)
  }

  const aborted = new AbortController()
  aborted.abort()

  const first = requestFetch(
    new Request('https://goosebumps.fm/new/tweet', { headers: { cookie: 'fixture=A' } }),
    send,
  )

  const second = requestFetch(
    new Request('https://goosebumps.fm/new/tweet', { headers: { cookie: 'fixture=B' } }),
    send,
  )

  await Promise.all([
    first('/api/content/posts/first'),
    second('/api/content/posts/second', { signal: aborted.signal }),
  ])

  expect(received).toEqual([
    { cookie: 'fixture=A', path: '/api/content/posts/first', aborted: false },
    { cookie: 'fixture=B', path: '/api/content/posts/second', aborted: true },
  ])
})

it('rejects cross-origin and non-API component requests before forwarding identity', async () => {
  let sent = 0

  const transport = requestFetch(new Request('https://goosebumps.fm/about'), async () => {
    sent += 1

    return new Response()
  })

  await expect(transport('https://other.invalid/api/private')).rejects.toThrow(
    'Server component requests must target the same-origin API.',
  )
  await expect(transport('/actions/mosaic')).rejects.toThrow(
    'Server component requests must target the same-origin API.',
  )
  await expect(transport('https://fixture:private@goosebumps.fm/api/private')).rejects.toThrow(
    'Server component requests must target the same-origin API.',
  )
  expect(sent).toBe(0)
})

it('preserves the request authorization while allowing component response negotiation', async () => {
  const received: Array<{ authorization: string | null; accept: string | null }> = []

  const transport = requestFetch(
    new Request('https://goosebumps.fm/new/tweet', {
      headers: { authorization: 'Bearer fixture-owner', accept: 'text/html' },
    }),
    async (_request, _path, init) => {
      const headers = new Headers(init?.headers)
      received.push({
        authorization: headers.get('authorization'),
        accept: headers.get('accept'),
      })

      return Response.json({ ok: true })
    },
  )

  await transport('/api/content/posts/draft', {
    headers: { accept: 'application/json', authorization: 'Bearer fixture-other' },
  })

  expect(received).toEqual([{ authorization: 'Bearer fixture-owner', accept: 'application/json' }])
})

it('preserves JSON request bodies through the streaming API forwarding seam', async () => {
  const transport = requestFetch(
    new Request('https://goosebumps.fm/new/editorial'),
    async (_source, path, init) => {
      const forwarded = new Request(new URL(path, 'https://api.internal'), init)

      return Response.json(await forwarded.json())
    },
  )

  const response = await transport('/api/content/posts/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Fixture writing' }),
  })

  expect(await response.json()).toEqual({ content: 'Fixture writing' })
})
