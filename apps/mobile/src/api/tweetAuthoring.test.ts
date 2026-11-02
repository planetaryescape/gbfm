import { PostResponse } from '@gbfm/api/post'
import { Effect, Redacted } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { HttpApiError } from 'effect/http-api'
import { expect, test } from 'vitest'

import { emptyTweetDraft } from '@/tweets/draft'

import { saveTweet, type AuthoringConnection } from './tweetAuthoring'

const post = PostResponse.make({
  id: 'saved-id',
  title: 'A record',
  description: null,
  thumbnailUrl: null,
  slug: 'mobile-fixed-id',
  content: null,
  draft: false,
  tags: [],
  type: 'micro',
  musicEntityType: null,
  musicEntityId: null,
  parentPostId: null,
  rootPostId: null,
  depth: 0,
  quotedPostId: null,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
})

const fixture = (respond: (method: string, path: string) => Response) => {
  const requests: Array<{
    readonly method: string
    readonly path: string
    readonly authorization: string | undefined
  }> = []

  const httpClient = HttpClient.make((request, url) => {
    requests.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.authorization,
    })

    return Effect.succeed(
      HttpClientResponse.fromWeb(request, respond(request.method, url.pathname)),
    )
  })

  const connection: AuthoringConnection = {
    httpClient,
    baseUrl: 'https://fixture.test',
    sessionToken: Redacted.make('fixture-token'),
  }

  return { connection, requests }
}

const draft = { ...emptyTweetDraft('fixed-id'), title: 'A record' }

const compiled = { ...post, compiledContent: '' }

test('creates a tweet through the parsed API contract with bearer authentication', async () => {
  const server = fixture(() => Response.json(post))
  expect(await Effect.runPromise(saveTweet(server.connection, draft, true))).toEqual(post)
  expect(server.requests).toEqual([
    { method: 'POST', path: '/api/content/post', authorization: 'Bearer fixture-token' },
  ])
})

test('updates an existing private account draft rather than creating another post', async () => {
  const server = fixture(() => Response.json(compiled))
  await Effect.runPromise(saveTweet(server.connection, { ...draft, remote: true }, true))
  expect(server.requests.map(({ method, path }) => [method, path])).toEqual([
    ['PATCH', '/api/content/posts/mobile-fixed-id'],
  ])
})

test('retry after an uncertain save checks edit access then updates the same slug', async () => {
  const server = fixture((method) =>
    method === 'POST'
      ? Response.json(new HttpApiError.Conflict(), { status: 409 })
      : Response.json(compiled),
  )

  await Effect.runPromise(saveTweet(server.connection, draft, true))
  expect(server.requests.map(({ method, path }) => [method, path])).toEqual([
    ['POST', '/api/content/post'],
    ['GET', '/api/content/posts/mobile-fixed-id/edit'],
    ['PATCH', '/api/content/posts/mobile-fixed-id'],
  ])
})

test('permission failures are visible and do not retry the create', async () => {
  const server = fixture(() => Response.json(new HttpApiError.Forbidden(), { status: 403 }))

  const message = await Effect.runPromise(
    saveTweet(server.connection, draft, true).pipe(
      Effect.match({ onSuccess: () => '', onFailure: (error) => error.message }),
    ),
  )

  expect(message).toContain('permission')
  expect(server.requests).toHaveLength(1)
})

test('a slug conflict never updates a post without passing the authenticated edit check', async () => {
  const server = fixture((method) =>
    method === 'POST'
      ? Response.json(new HttpApiError.Conflict(), { status: 409 })
      : Response.json(new HttpApiError.Unauthorized(), { status: 401 }),
  )

  expect(
    await Effect.runPromise(saveTweet(server.connection, draft, true).pipe(Effect.isFailure)),
  ).toBe(true)
  expect(server.requests.map(({ method }) => method)).toEqual(['POST', 'GET'])
})

test('invalid and empty tweets do not reach the network', async () => {
  const server = fixture(() => Response.json(post))
  expect(
    await Effect.runPromise(
      saveTweet(server.connection, emptyTweetDraft('id'), true).pipe(Effect.isFailure),
    ),
  ).toBe(true)
  expect(server.requests).toEqual([])
})

test('malformed success payloads and transport failures remain typed failures', async () => {
  const malformed = fixture(() => Response.json({ slug: 'missing-fields' }))
  expect(
    await Effect.runPromise(saveTweet(malformed.connection, draft, true).pipe(Effect.isFailure)),
  ).toBe(true)
  const unavailable = fixture(() => new Response(null, { status: 503 }))
  expect(
    await Effect.runPromise(saveTweet(unavailable.connection, draft, true).pipe(Effect.isFailure)),
  ).toBe(true)
})
