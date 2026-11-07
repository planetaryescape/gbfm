import { Effect, Redacted } from 'effect'
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import { describe, expect, test } from 'vitest'

import { getSessionWithClient } from './auth'
import { loadFavorite, saveFavorite, type FavoriteTrack } from './favorites'

const track: FavoriteTrack = {
  id: '6f1c2a54-3b0e-4d7a-9a51-2f0c8d4e7b19',
  type: 'mix',
  slug: 'late-night-signal',
}

const mutation = { requestId: '08d8b15f-c772-4ba7-b355-83f969e42873', expectedRevision: 17 }

const fakeServer = (respond: (method: string, path: string) => Response | undefined) => {
  const seen: Array<{ method: string; path: string; authorization: string }> = []

  const httpClient = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      seen.push({
        method: request.method,
        path: url.pathname,
        authorization: request.headers['authorization'] ?? '',
      })
      const response = respond(request.method, url.pathname)

      if (!response)
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request }),
        })

      return HttpClientResponse.fromWeb(request, response)
    }),
  )

  return {
    seen,
    connection: {
      httpClient,
      baseUrl: 'http://fixture.test',
      sessionToken: Redacted.make('fixture-session-token'),
    },
  }
}

const jsonResponse = (status: number, body: string) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } })

const httpError = (status: number, tag: string) =>
  jsonResponse(status, JSON.stringify({ ['_tag']: tag }))

const outcome = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.map((value) => ({ ok: value })),
      Effect.catch((error) => Effect.succeed({ failed: error._tag })),
    ),
  )

describe('getSessionWithClient', () => {
  test.each([
    ['null session', () => jsonResponse(200, 'null')],
    ['unauthorized', () => httpError(401, 'Unauthorized')],
  ])('reports expiry for %s', async (_name, respond) => {
    const server = fakeServer(respond)
    expect(await outcome(getSessionWithClient(server.connection))).toEqual({
      failed: 'SessionExpired',
    })
  })
  test.each([
    ['malformed session', () => jsonResponse(200, JSON.stringify({ user: { id: 'listener-1' } }))],
    ['invalid JSON', () => jsonResponse(200, '{')],
    ['service unavailable', () => httpError(503, 'ServiceUnavailable')],
    ['network unavailable', () => undefined],
  ])('reports unavailability for %s', async (_name, respond) => {
    const server = fakeServer(respond)
    expect(await outcome(getSessionWithClient(server.connection))).toEqual({
      failed: 'SessionUnavailable',
    })
  })
})

test('loads favorite and owner revision from the same authenticated atomic state response', async () => {
  const server = fakeServer(() =>
    jsonResponse(200, JSON.stringify({ favorited: true, subscribed: null, revision: 17 })),
  )

  expect(await outcome(loadFavorite(server.connection, track))).toEqual({
    ok: { favorite: true, revision: 17 },
  })
  expect(server.seen).toEqual([
    {
      method: 'GET',
      path: `/api/favorites/audio/${track.id}/state`,
      authorization: 'Bearer fixture-session-token',
    },
  ])
})

test.each([true, false])(
  'saves desired state %s only from a matching committed response',
  async (favorite) => {
    const result = {
      ...mutation,
      requestId: mutation.requestId,
      operationId: 'b'.repeat(64),
      targetKind: 'audio',
      targetId: track.id,
      desiredState: favorite,
      revision: 18,
      notifications: 'not_sent',
    }

    const server = fakeServer(() => jsonResponse(200, JSON.stringify(result)))
    expect(await outcome(saveFavorite(server.connection, track, favorite, mutation))).toEqual({
      ok: { favorite, revision: 18 },
    })
    expect(server.seen).toEqual([
      {
        method: favorite ? 'POST' : 'DELETE',
        path: favorite ? '/api/favorites' : `/api/favorites/${track.id}`,
        authorization: 'Bearer fixture-session-token',
      },
    ])

    for (const wrong of [
      { ...result, targetId: 'other' },
      { ...result, revision: 17 },
      { ...result, desiredState: !favorite },
      { ...result, requestId: '10000000-0000-4000-8000-000000000000' },
    ]) {
      const mismatch = fakeServer(() => jsonResponse(200, JSON.stringify(wrong)))
      expect(await outcome(saveFavorite(mismatch.connection, track, favorite, mutation))).toEqual({
        failed: 'FavoriteRequestFailed',
      })
    }
  },
)

test.each([
  [409, 'Conflict', 'FavoriteConflict'],
  [410, 'Gone', 'FavoriteConflict'],
  [401, 'Unauthorized', 'FavoriteSessionExpired'],
  [403, 'Forbidden', 'FavoriteSessionExpired'],
  [503, 'ServiceUnavailable', 'FavoriteRequestFailed'],
])(
  'never treats HTTP %s as mutation success or retries automatically',
  async (status, tag, expected) => {
    const server = fakeServer(() => httpError(status, tag))
    expect(await outcome(saveFavorite(server.connection, track, true, mutation))).toEqual({
      failed: expected,
    })
    expect(server.seen).toHaveLength(1)
  },
)

test('missing/private status and invalid revision fail closed', async () => {
  const missing = fakeServer(() => httpError(404, 'NotFound'))
  expect(await outcome(loadFavorite(missing.connection, track))).toEqual({
    failed: 'FavoriteTrackUnavailable',
  })

  const malformed = fakeServer(() =>
    jsonResponse(200, JSON.stringify({ favorited: false, subscribed: null, revision: -1 })),
  )

  expect(await outcome(loadFavorite(malformed.connection, track))).toEqual({
    failed: 'FavoriteRequestFailed',
  })
})
