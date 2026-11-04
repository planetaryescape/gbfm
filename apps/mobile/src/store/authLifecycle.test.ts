import { Deferred, Effect, Fiber, Match, Predicate, Redacted } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { expect, test } from 'vitest'

import { getSessionWithClient } from '@/api/auth'

import {
  acceptAuthSession,
  AuthLifecycle,
  AuthSessionStorage,
  AuthSessionValidation,
  AuthStorageFailed,
  clearAuthSession,
  currentAuthSession,
  emptyAuthSession,
  restoreAuthSession,
  type AuthSession,
  type SetAuthLifecycle,
} from './authLifecycle'

const wireUser = {
  role: 'creator',
  id: 'fixture-user',
  name: 'Fixture Creator',
  username: 'fixture',
  email: 'fixture@example.test',
  emailVerified: true,
  image: null,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
}

const cached: AuthSession = {
  user: {
    role: 'creator',
    id: wireUser.id,
    name: 'Cached name',
    username: wireUser.username,
    email: wireUser.email,
    avatarUrl: null,
    verified: true,
    createdAt: wireUser.createdAt,
    updatedAt: wireUser.updatedAt,
  },
  sessionToken: 'fixture-token',
}

const fixture = (stored: string | null, response = Response.json({ user: wireUser })) => {
  const persisted = new Map<string, string>()

  if (stored !== null) persisted.set('session', stored)
  const failures = new Set<string>()
  const phases: Array<AuthLifecycle['_tag']> = []
  let state: AuthLifecycle = AuthLifecycle.Bootstrapping()

  const setState: SetAuthLifecycle = (update) => {
    const next = Predicate.isFunction(update) ? update(state) : update

    if (next !== state) phases.push(next._tag)
    state = next
  }

  const storage = AuthSessionStorage.of({
    read: Effect.suspend(() =>
      failures.has('read')
        ? Effect.fail(new AuthStorageFailed({ message: 'Read failed' }))
        : Effect.succeed(persisted.get('session') ?? null),
    ),
    write: (session) =>
      failures.has('write')
        ? Effect.fail(new AuthStorageFailed({ message: 'Write failed' }))
        : Effect.sync(() => {
            persisted.set('session', JSON.stringify(session))
          }),
    remove: Effect.suspend(() =>
      failures.has('remove')
        ? Effect.fail(new AuthStorageFailed({ message: 'Remove failed' }))
        : Effect.sync(() => {
            persisted.delete('session')
          }),
    ),
  })

  const httpClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, response)),
  )

  const validation = AuthSessionValidation.of({
    validate: (token) =>
      getSessionWithClient({
        httpClient,
        baseUrl: 'https://fixture.test',
        sessionToken: Redacted.make(token),
      }),
  })

  const restore = restoreAuthSession(setState).pipe(
    Effect.provideService(AuthSessionStorage, storage),
    Effect.provideService(AuthSessionValidation, validation),
  )

  return {
    persisted,
    failures,
    phases,
    storage,
    validation,
    restore,
    setState,
    state: () => state,
    session: () => currentAuthSession(state),
  }
}

test.each([
  null,
  '',
  '{invalid',
  JSON.stringify({ user: { id: 'incomplete' }, sessionToken: 'fixture' }),
])('absent or invalid stored sessions never become authenticated (%s)', async (stored) => {
  const auth = fixture(stored)
  await Effect.runPromise(auth.restore)
  expect(auth.session()).toEqual(emptyAuthSession)
  expect(auth.phases).toEqual([])

  expect(auth.persisted.get('session') ?? null).toBe(stored === '' ? '' : null)
})

test('unreadable storage and failed invalid-session cleanup remain nonfatal', async () => {
  const unreadable = fixture(JSON.stringify(cached))
  unreadable.failures.add('read')
  await Effect.runPromise(unreadable.restore)
  expect(unreadable.session()).toEqual(emptyAuthSession)
  expect(unreadable.persisted.get('session')).toBe(JSON.stringify(cached))
  const invalid = fixture('{invalid')
  invalid.failures.add('remove')
  await Effect.runPromise(invalid.restore)
  expect(invalid.session()).toEqual(emptyAuthSession)
  expect(invalid.persisted.get('session')).toBe('{invalid')
})

test('cached session becomes visible during validation and refresh keeps the persisted format', async () => {
  const auth = fixture(JSON.stringify(cached))
  await Effect.runPromise(auth.restore)
  expect(auth.phases).toEqual(['ValidatingSession', 'Authenticated'])
  expect(auth.session().user?.name).toBe(wireUser.name)
  expect(auth.persisted.get('session')).toBe(JSON.stringify(auth.session()))
})

test.each([new Response(null, { status: 401 }), Response.json(null)])(
  'expired sessions are cleared both in memory and storage',
  async (response) => {
    const auth = fixture(JSON.stringify(cached), response)
    await Effect.runPromise(auth.restore)
    expect(auth.phases).toEqual(['ValidatingSession', 'SignedOut'])
    expect(auth.session()).toEqual(emptyAuthSession)
    expect(auth.persisted.has('session')).toBe(false)
  },
)

test.each([new Response(null, { status: 503 }), Response.json({ invalid: true })])(
  'transient or malformed session checks retain the cached session',
  async (response) => {
    const auth = fixture(JSON.stringify(cached), response)
    await Effect.runPromise(auth.restore)
    expect(auth.phases).toEqual(['ValidatingSession', 'CachedSession'])
    expect(auth.session()).toEqual(cached)
    expect(auth.persisted.get('session')).toBe(JSON.stringify(cached))
  },
)

test('refresh persistence failure keeps the refreshed memory session and stale stored session', async () => {
  const auth = fixture(JSON.stringify(cached))
  auth.failures.add('write')
  await Effect.runPromise(auth.restore)
  expect(AuthLifecycle.$is('Authenticated')(auth.state())).toBe(true)
  expect(auth.session().user?.name).toBe(wireUser.name)
  expect(auth.persisted.get('session')).toBe(JSON.stringify(cached))
})

test('expiry cleanup failure leaves memory signed out but retains the stored expired session', async () => {
  const auth = fixture(JSON.stringify(cached), new Response(null, { status: 401 }))
  auth.failures.add('remove')
  expect(await Effect.runPromise(auth.restore.pipe(Effect.isFailure))).toBe(true)
  expect(auth.session()).toEqual(emptyAuthSession)
  expect(auth.persisted.get('session')).toBe(JSON.stringify(cached))
})

test('sign-in updates memory immediately even when persisting the session later fails', async () => {
  const auth = fixture(null)
  auth.failures.add('write')

  const persistence = acceptAuthSession(cached, auth.setState).pipe(
    Effect.provideService(AuthSessionStorage, auth.storage),
  )

  expect(auth.session()).toEqual(cached)
  expect(await Effect.runPromise(persistence.pipe(Effect.isFailure))).toBe(true)
  expect(auth.session()).toEqual(cached)
  expect(auth.persisted.has('session')).toBe(false)
})

test('failed sign-out persistence does not clear the memory session', async () => {
  const auth = fixture(JSON.stringify(cached))
  await Effect.runPromise(
    acceptAuthSession(cached, auth.setState).pipe(
      Effect.provideService(AuthSessionStorage, auth.storage),
    ),
  )
  auth.failures.add('remove')
  expect(
    await Effect.runPromise(
      clearAuthSession(auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, auth.storage),
        Effect.isFailure,
      ),
    ),
  ).toBe(true)
  expect(auth.session()).toEqual(cached)
})

test.each([
  { stored: JSON.stringify(cached), operation: 'sign-in' },
  { stored: '{invalid', operation: 'sign-in' },
  { stored: JSON.stringify(cached), operation: 'sign-out' },
  { stored: '{invalid', operation: 'sign-out' },
])(
  'a delayed initial storage read cannot replace or remove a newer $operation ($stored)',
  async ({ stored, operation }) => {
    const auth = fixture(stored)
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()

        const fiber = yield* restoreAuthSession(auth.setState).pipe(
          Effect.provideService(AuthSessionStorage, {
            ...auth.storage,
            read: Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.as(stored),
            ),
          }),
          Effect.provideService(AuthSessionValidation, auth.validation),
          Effect.forkScoped,
        )

        yield* Deferred.await(started)
        yield* (
          operation === 'sign-in'
            ? acceptAuthSession({ ...cached, sessionToken: 'new-login-token' }, auth.setState)
            : clearAuthSession(auth.setState)
        ).pipe(Effect.provideService(AuthSessionStorage, auth.storage))
        const newer = auth.state()
        const persisted = auth.persisted.get('session')
        yield* Deferred.succeed(finish, undefined)
        yield* Fiber.join(fiber)
        expect(auth.state()).toBe(newer)
        expect(auth.persisted.get('session')).toBe(persisted)
      }).pipe(Effect.scoped),
    )
  },
)

test.each([
  ['sign-out', 'success'],
  ['sign-in', 'success'],
  ['sign-out', 'expired'],
  ['sign-in', 'expired'],
  ['sign-out', 'unavailable'],
  ['sign-in', 'unavailable'],
  ['restore', 'success'],
  ['restore', 'expired'],
  ['restore', 'unavailable'],
])('late restore preserves a newer %s after validation %s', async (operation, result) => {
  const auth = fixture(
    JSON.stringify(cached),
    Match.value(result).pipe(
      Match.when('expired', () => new Response(null, { status: 401 })),
      Match.when('unavailable', () => new Response(null, { status: 503 })),
      Match.orElse(() => Response.json({ user: wireUser })),
    ),
  )

  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()

      const restore = restoreAuthSession(auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, auth.storage),
        Effect.provideService(AuthSessionValidation, {
          validate: (token) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.andThen(auth.validation.validate(token)),
            ),
        }),
      )

      const fiber = yield* restore.pipe(Effect.forkScoped)
      yield* Deferred.await(started)

      if (operation === 'sign-out') {
        yield* clearAuthSession(auth.setState).pipe(
          Effect.provideService(AuthSessionStorage, auth.storage),
        )
        expect(auth.session().user).toBeNull()
      } else if (operation === 'restore') {
        auth.setState(AuthLifecycle.ValidatingSession({ session: auth.session() }))
      } else {
        yield* acceptAuthSession(
          { ...cached, user: cached.user ? { ...cached.user, id: 'new-login' } : null },
          auth.setState,
        ).pipe(Effect.provideService(AuthSessionStorage, auth.storage))
        expect(auth.session().user?.id).toBe('new-login')
      }

      const newer = auth.session()
      const lifecycle = auth.state()
      const persisted = auth.persisted.get('session')
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(fiber)
      expect(auth.session()).toEqual(newer)
      expect(auth.state()).toBe(lifecycle)
      expect(auth.persisted.get('session')).toBe(persisted)
    }).pipe(Effect.scoped),
  )
})
