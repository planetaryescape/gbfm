import { Effect, Redacted } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { expect, test } from 'vitest'

import { getSessionWithClient } from './auth'

const sessionUser = {
  id: 'fixture-user',
  name: 'Fixture Creator',
  username: 'fixture',
  email: 'fixture@example.test',
  emailVerified: true,
  image: null,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
}

test('session refresh retains the server role used by mobile publishing permissions', async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({ user: { ...sessionUser, role: 'creator' } }),
      ),
    ),
  )

  const user = await Effect.runPromise(
    getSessionWithClient({
      httpClient,
      baseUrl: 'https://fixture.test',
      sessionToken: Redacted.make('fixture-token'),
    }),
  )

  expect(user.role).toBe('creator')
  expect(user.username).toBe('fixture')
})

test('sessions without a role never gain creator privileges', async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ user: sessionUser }))),
  )

  const user = await Effect.runPromise(
    getSessionWithClient({
      httpClient,
      baseUrl: 'https://fixture.test',
      sessionToken: Redacted.make('fixture-token'),
    }),
  )

  expect(user.role).toBe('user')
})
