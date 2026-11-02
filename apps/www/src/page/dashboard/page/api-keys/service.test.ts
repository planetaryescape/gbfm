import { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { KeyService, makeKeyServiceLayer } from './service'

const metadata = {
  id: 'c63400ba-984d-4d4e-91ce-3b1722cc28f2',
  ownerUserId: 'owner',
  name: 'Writing agent',
  environment: 'dev',
  scopes: ['posts:read'],
  displayPrefix: 'gbfm_pat_v1_dev_abcdef',
  createdAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-12-02T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
}

describe('personal key API adapter', () => {
  it('renews only the current account session using the supplied password', async () => {
    const requests: Array<{
      path: string
      credentials?: RequestCredentials
      passwordProvided: boolean
    }> = []

    const layer = makeKeyServiceLayer(async (input, init) => {
      const path = input instanceof Request ? input.url : input.toString()
      requests.push({
        path,
        credentials: init?.credentials,
        passwordProvided:
          Schema.is(Schema.String)(init?.body) && init.body.includes('disposable-password'),
      })

      return path === '/auth/get-session'
        ? Response.json({ user: { id: 'owner', email: 'owner@example.test' }, session: {} })
        : Response.json({ token: 'not-read-or-exposed', user: { id: 'owner' } })
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)
        yield* Context.get(context, KeyService).confirmPassword(
          'owner',
          Redacted.make('disposable-password'),
        )
      }).pipe(Effect.scoped),
    )
    expect(requests).toEqual([
      { path: '/auth/get-session', credentials: 'same-origin', passwordProvided: false },
      { path: '/auth/sign-in/email', credentials: 'same-origin', passwordProvided: true },
      { path: '/auth/get-session', credentials: 'same-origin', passwordProvided: false },
    ])
  })

  for (const session of [
    { user: { id: 'other', email: 'other@example.test' }, session: {} },
    { user: { id: 'owner', email: 'owner@example.test' }, session: { impersonatedBy: 'admin' } },
  ])
    it('does not reauthenticate a different or impersonated account', async () => {
      const paths: Array<string> = []

      const layer = makeKeyServiceLayer(async (input) => {
        paths.push(input instanceof Request ? input.url : input.toString())

        return Response.json(session)
      })

      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer)

          return yield* Context.get(context, KeyService).confirmPassword(
            'owner',
            Redacted.make('disposable-password'),
          )
        }).pipe(Effect.scoped, Effect.flip),
      )

      expect(error.message).toContain('account session changed')
      expect(paths).toEqual(['/auth/get-session'])
    })

  it('rejects an account change during password confirmation', async () => {
    let reads = 0

    const layer = makeKeyServiceLayer(async (input) => {
      if (input === '/auth/sign-in/email') return Response.json({ token: 'ignored-token' })
      reads += 1

      return Response.json({
        user: { id: reads === 1 ? 'owner' : 'other', email: 'owner@example.test' },
        session: {},
      })
    })

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Context.get(context, KeyService).confirmPassword(
          'owner',
          Redacted.make('disposable-password'),
        )
      }).pipe(Effect.scoped, Effect.flip),
    )

    expect(error.message).toContain('account session changed')
  })

  it('reports invalid passwords without reading or exposing the authentication body', async () => {
    const layer = makeKeyServiceLayer(async (input) =>
      input === '/auth/get-session'
        ? Response.json({ user: { id: 'owner', email: 'owner@example.test' }, session: {} })
        : new Response('private-auth-payload', { status: 401 }),
    )

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Context.get(context, KeyService).confirmPassword(
          'owner',
          Redacted.make('disposable-password'),
        )
      }).pipe(Effect.scoped, Effect.flip),
    )

    expect(error.message).toBe('Incorrect password. Try again.')
    expect(JSON.stringify(error)).not.toContain('private-auth-payload')
    expect(JSON.stringify(error)).not.toContain('disposable-password')
  })

  it('decodes metadata, isolates the secret, and uses same-origin uncached requests', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []

    const layer = makeKeyServiceLayer(async (input, init) => {
      requests.push({ path: input instanceof Request ? input.url : input.toString(), init })

      return Response.json({ key: metadata, secret: 'disposable-test-secret' })
    })

    const input = Schema.decodeUnknownSync(IssueKeyInput)({
      requestId: '035f8f64-414e-474c-95fd-4256cd52390b',
      name: 'Writing agent',
      scopes: ['posts:read'],
    })

    const issued = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Context.get(context, KeyService).issue(input)
      }).pipe(Effect.scoped),
    )

    expect(issued.key.name).toBe('Writing agent')
    expect(Redacted.isRedacted(issued.secret)).toBe(true)
    expect(JSON.stringify(issued)).not.toContain('disposable-test-secret')
    expect(requests).toMatchObject([
      {
        path: '/api/user/api-keys',
        init: {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          body: JSON.stringify(input),
        },
      },
    ])
  })

  it('does not expose an arbitrary server error body', async () => {
    const layer = makeKeyServiceLayer(
      async () => new Response('private-server-payload', { status: 403 }),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Context.get(context, KeyService).list(0)
      }).pipe(
        Effect.scoped,
        Effect.match({ onSuccess: () => '', onFailure: (error) => error.message }),
      ),
    )

    expect(result).toContain('authoring permissions')
    expect(result).not.toContain('private-server-payload')
  })

  it('rejects malformed metadata without reflecting response values', async () => {
    const layer = makeKeyServiceLayer(async () =>
      Response.json({ data: [{ secret: 'private-response' }], pagination: {} }),
    )

    const message = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Context.get(context, KeyService).list(20)
      }).pipe(
        Effect.scoped,
        Effect.match({ onSuccess: () => '', onFailure: (error) => error.message }),
      ),
    )

    expect(message).toContain('Could not read')
    expect(message).not.toContain('private-response')
  })
})
