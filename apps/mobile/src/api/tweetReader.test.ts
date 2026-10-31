import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Effect, Redacted } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { HttpApiError } from 'effect/http-api'
import { expect, test } from 'vitest'

import {
  loadReaderNavigation,
  loadReaderPost,
  randomReaderPost,
  recordReaderVisit,
  resetReaderHistory,
  type ReaderConnection,
} from './tweetReader'

const fixture = (respond: (method: string, path: string) => Response, authenticated = false) => {
  const requests: Array<{ method: string; path: string; authorization: string | undefined }> = []

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

  const connection: ReaderConnection = {
    httpClient,
    baseUrl: 'https://fixture.test',
    sessionToken: authenticated ? Redacted.make('test-session') : null,
  }

  return { connection, requests }
}

type Json =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }

const json = (
  value: Json | MicroPostScreenResponse | HttpApiError.NotFound | HttpApiError.InternalServerError,
  status = 200,
) => Response.json(value, { status })

const outcome = <A, E extends { readonly _tag: string }>(work: Effect.Effect<A, E>) =>
  Effect.runPromise(
    work.pipe(
      Effect.match({
        onSuccess: (value) => ({ value }),
        onFailure: (error) => ({ error: error._tag }),
      }),
    ),
  )

const post = MicroPostScreenResponse.fields.post.make({
  id: 'reader-one',
  title: 'A record',
  description: null,
  thumbnailUrl: null,
  slug: 'reader-one',
  content: 'Listen to this.',
  draft: false,
  tags: [],
  type: 'micro',
  musicEntityType: null,
  musicEntityId: null,
  parentPostId: null,
  rootPostId: null,
  depth: 0,
  quotedPostId: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  compiledContent: '',
  music: null,
})

test('entry resolves latest into the same parsed screen contract used by direct tweet navigation', async () => {
  const screen = MicroPostScreenResponse.make({ post, root: post, replies: [], quote: null })

  const server = fixture((_method, path) =>
    path.endsWith('/latest') ? json({ slug: post.slug }) : json(screen),
  )

  expect(await Effect.runPromise(loadReaderPost(server.connection, null))).toEqual(screen)
  expect(server.requests.map((request) => request.path)).toEqual([
    '/api/content/posts/micro/latest',
    '/api/content/posts/micro/reader-one/screen',
  ])
})

test('direct links preserve the requested tweet instead of returning latest', async () => {
  const server = fixture(() =>
    json(MicroPostScreenResponse.make({ post, root: post, replies: [], quote: null })),
  )

  await Effect.runPromise(loadReaderPost(server.connection, 'reader-one'))
  expect(server.requests.map((request) => request.path)).toEqual([
    '/api/content/posts/micro/reader-one/screen',
  ])
})

test('an empty corpus produces the empty reader without requesting a made-up slug', async () => {
  const server = fixture(() => json(null))

  expect(await Effect.runPromise(loadReaderPost(server.connection, null))).toBeNull()
  expect(server.requests).toEqual([
    { method: 'GET', path: '/api/content/posts/micro/latest', authorization: undefined },
  ])
})

test('navigation reads use the signed-in session and parse unread/month data', async () => {
  const server = fixture(
    () =>
      json({
        newer: null,
        older: 'older-one',
        olderUnread: 'older-one',
        newerUnread: null,
        seen: true,
        unreadCount: 2,
        timeline: [{ month: '2026-10', total: 3, unread: 2, newestSlug: 'latest-one' }],
      }),
    true,
  )

  const result = await Effect.runPromise(loadReaderNavigation(server.connection, 'a slug'))

  expect(result.olderUnread).toBe('older-one')
  expect(result.timeline[0]?.month).toBe('2026-10')
  expect(server.requests).toEqual([
    {
      method: 'GET',
      path: '/api/content/posts/micro/a%20slug/neighbours',
      authorization: 'Bearer test-session',
    },
  ])
})

test('anonymous reads do not send a bearer token', async () => {
  const server = fixture(() =>
    json({
      newer: null,
      older: null,
      olderUnread: null,
      newerUnread: null,
      seen: false,
      unreadCount: 1,
      timeline: [],
    }),
  )

  await Effect.runPromise(loadReaderNavigation(server.connection, 'one'))
  expect(server.requests[0]?.authorization).toBeUndefined()
})

test('a viewed tweet is recorded through the existing POST endpoint', async () => {
  const server = fixture(() => json({ recorded: true }), true)

  await Effect.runPromise(recordReaderVisit(server.connection, 'one'))
  expect(server.requests).toEqual([
    {
      method: 'POST',
      path: '/api/content/posts/micro/one/seen',
      authorization: 'Bearer test-session',
    },
  ])
})

test('a rejected seen write does not pretend reading progress was saved', async () => {
  const server = fixture(() => json({ recorded: false }))

  expect(await outcome(recordReaderVisit(server.connection, 'one'))).toEqual({
    error: 'TweetReaderUnavailable',
  })
})

test('random unread returns a concrete destination, with no destination on exhaustion', async () => {
  const available = fixture(() => json({ slug: 'unread-one' }))
  const exhausted = fixture(() => json(new HttpApiError.NotFound(), 404))

  expect(await Effect.runPromise(randomReaderPost(available.connection, 'one'))).toBe('unread-one')
  expect(await Effect.runPromise(randomReaderPost(exhausted.connection, 'one'))).toBeNull()
})

test('random service failures stay failures rather than falsely reporting caught up', async () => {
  const server = fixture(() => json(new HttpApiError.InternalServerError(), 500))

  expect(await outcome(randomReaderPost(server.connection, 'one'))).toEqual({
    error: 'TweetReaderUnavailable',
  })
})

test('explicit history reset uses DELETE under the current account', async () => {
  const server = fixture(() => json({ reset: true }), true)

  await Effect.runPromise(resetReaderHistory(server.connection))
  expect(server.requests).toEqual([
    {
      method: 'DELETE',
      path: '/api/navigation/reading-history',
      authorization: 'Bearer test-session',
    },
  ])
})

test('invalid navigation payloads fail at the HTTP boundary', async () => {
  const server = fixture(() => json({ unreadCount: 'many' }))

  expect(await outcome(loadReaderNavigation(server.connection, 'one'))).toEqual({
    error: 'TweetReaderUnavailable',
  })
})
