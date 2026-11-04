import { Deferred, Effect, Exit, Fiber, Match, Predicate, Redacted } from 'effect'
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
  currentAuthIdentity,
  currentAuthSession,
  emptyAuthSession,
  makeAuthSessionStorage,
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

const fixture = (
  stored: string | null,
  response = Response.json({ user: wireUser }),
  gates: {
    readonly write?: (session: AuthSession) => Effect.Effect<void>
    readonly remove?: Effect.Effect<void>
  } = {},
) => {
  const persisted = new Map<string, string>()

  if (stored !== null) persisted.set('session', stored)
  const failures = new Set<string>()
  const phases: Array<AuthLifecycle['_tag']> = []
  const mutations: Array<string> = []
  let state: AuthLifecycle = AuthLifecycle.Bootstrapping()

  const setState: SetAuthLifecycle = (update) => {
    const next = Predicate.isFunction(update) ? update(state) : update

    if (next !== state) phases.push(next._tag)
    state = next
  }

  const storage = makeAuthSessionStorage({
    read: Effect.suspend(() =>
      failures.has('read')
        ? Effect.fail(new AuthStorageFailed({ message: 'Read failed' }))
        : Effect.succeed(persisted.get('session') ?? null),
    ),
    write: (session) =>
      Effect.gen(function* () {
        mutations.push(`write:${session.sessionToken}:start`)
        yield* gates.write?.(session) ?? Effect.void

        if (failures.has('write')) yield* new AuthStorageFailed({ message: 'Write failed' })
        persisted.set('session', JSON.stringify(session))
        mutations.push(`write:${session.sessionToken}:committed`)
      }),
    remove: Effect.gen(function* () {
      mutations.push('remove:start')
      yield* gates.remove ?? Effect.void

      if (failures.has('remove')) yield* new AuthStorageFailed({ message: 'Remove failed' })
      persisted.delete('session')
      mutations.push('remove:committed')
    }),
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
    mutations,
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

test('feed identity waits for the initial read but is available during cached-session validation', () => {
  expect(currentAuthIdentity(AuthLifecycle.Bootstrapping())).toBeNull()
  expect(currentAuthIdentity(AuthLifecycle.ValidatingSession({ session: cached }))).toBe(
    cached.user?.id,
  )
  expect(currentAuthIdentity(AuthLifecycle.CachedSession({ session: cached }))).toBe(
    cached.user?.id,
  )
  expect(currentAuthIdentity(AuthLifecycle.Authenticated({ session: cached }))).toBe(
    cached.user?.id,
  )
  expect(currentAuthIdentity(AuthLifecycle.SignedOut())).toBe('anonymous')
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
        const mutations = [...auth.mutations]
        yield* Deferred.succeed(finish, undefined)
        yield* Fiber.join(fiber)
        expect(auth.state()).toBe(newer)
        expect(auth.persisted.get('session')).toBe(persisted)
        expect(auth.mutations).toEqual(mutations)
      }).pipe(Effect.scoped),
    )
  },
)

test.each([
  { restoreResult: 'invalid-cache', newerOperation: 'sign-in' },
  { restoreResult: 'invalid-cache', newerOperation: 'sign-out' },
  { restoreResult: 'expired', newerOperation: 'sign-in' },
  { restoreResult: 'expired', newerOperation: 'sign-out' },
  { restoreResult: 'refreshed', newerOperation: 'sign-in' },
  { restoreResult: 'refreshed', newerOperation: 'sign-out' },
])(
  'a pending $restoreResult storage mutation commits before a newer $newerOperation',
  async ({ restoreResult, newerOperation }) => {
    const release = Deferred.makeUnsafe<void>()
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()

        const gate = Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        )

        const auth = fixture(
          restoreResult === 'invalid-cache' ? '{invalid' : JSON.stringify(cached),
          restoreResult === 'expired' ? new Response(null, { status: 401 }) : undefined,
          restoreResult === 'refreshed' ? { write: () => gate } : { remove: gate },
        )

        const restore = yield* auth.restore.pipe(Effect.forkScoped)
        yield* Deferred.await(started)
        const newer = { ...cached, sessionToken: 'new-login' }

        const newerWork =
          newerOperation === 'sign-in'
            ? acceptAuthSession(newer, auth.setState)
            : clearAuthSession(auth.setState)

        const next = yield* newerWork.pipe(
          Effect.provideService(AuthSessionStorage, auth.storage),
          Effect.forkScoped({ startImmediately: true }),
        )

        if (newerOperation === 'sign-in') expect(auth.session()).toEqual(newer)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(restore)
        yield* Fiber.join(next)
        expect(auth.session()).toEqual(newerOperation === 'sign-in' ? newer : emptyAuthSession)
        expect(auth.persisted.get('session')).toBe(
          newerOperation === 'sign-in' ? JSON.stringify(newer) : undefined,
        )
        const olderMutation = restoreResult === 'refreshed' ? 'write:fixture-token' : 'remove'
        const newerMutation = newerOperation === 'sign-in' ? 'write:new-login' : 'remove'
        expect(auth.mutations).toEqual([
          `${olderMutation}:start`,
          `${olderMutation}:committed`,
          `${newerMutation}:start`,
          `${newerMutation}:committed`,
        ])
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.scoped),
    )
  },
)

test.each(['sign-in', 'sign-out'])(
  'a queued stale %s cannot mutate a replacement account',
  async (queuedOperation) => {
    const release = Deferred.makeUnsafe<void>()
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()

        const auth = fixture(null, undefined, {
          write: () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
        })

        const first = yield* acceptAuthSession(cached, auth.setState).pipe(
          Effect.provideService(AuthSessionStorage, auth.storage),
          Effect.forkScoped({ startImmediately: true }),
        )

        yield* Deferred.await(started)

        const queued = yield* (
          queuedOperation === 'sign-in'
            ? acceptAuthSession({ ...cached, sessionToken: 'superseded-login' }, auth.setState)
            : clearAuthSession(auth.setState)
        ).pipe(
          Effect.provideService(AuthSessionStorage, auth.storage),
          Effect.forkScoped({ startImmediately: true }),
        )

        const newer = { ...cached, sessionToken: 'replacement-account' }

        const last = yield* acceptAuthSession(newer, auth.setState).pipe(
          Effect.provideService(AuthSessionStorage, auth.storage),
          Effect.forkScoped({ startImmediately: true }),
        )

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(queued)
        yield* Fiber.join(last)
        expect(auth.session()).toEqual(newer)
        expect(auth.persisted.get('session')).toBe(JSON.stringify(newer))
        expect(auth.mutations).toEqual([
          'write:fixture-token:start',
          'write:fixture-token:committed',
          'write:replacement-account:start',
          'write:replacement-account:committed',
        ])
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.scoped),
    )
  },
)

test('a pending sign-out removal cannot clear a newer login from memory or storage', async () => {
  const release = Deferred.makeUnsafe<void>()
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()

      const auth = fixture(JSON.stringify(cached), undefined, {
        remove: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      })

      auth.setState(AuthLifecycle.Authenticated({ session: cached }))

      const signOut = yield* clearAuthSession(auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, auth.storage),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Deferred.await(started)
      const newer = { ...cached, sessionToken: 'new-login' }

      const signIn = yield* acceptAuthSession(newer, auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, auth.storage),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(signOut)
      yield* Fiber.join(signIn)
      expect(auth.session()).toEqual(newer)
      expect(auth.persisted.get('session')).toBe(JSON.stringify(newer))
      expect(auth.mutations).toEqual([
        'remove:start',
        'remove:committed',
        'write:new-login:start',
        'write:new-login:committed',
      ])
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.scoped),
  )
})

test('an invalid cached read cannot queue a redundant cleanup behind a newer pending sign-out', async () => {
  const release = Deferred.makeUnsafe<void>()
  await Effect.runPromise(
    Effect.gen(function* () {
      const readStarted = yield* Deferred.make<void>()
      const releaseRead = yield* Deferred.make<void>()
      const removeStarted = yield* Deferred.make<void>()
      const cleanupRequested = yield* Deferred.make<void>()

      const auth = fixture('{invalid', undefined, {
        remove: Deferred.succeed(removeStarted, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      })

      const restore = yield* restoreAuthSession(auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, {
          ...auth.storage,
          persist: (session, options) =>
            Deferred.succeed(cleanupRequested, undefined).pipe(
              Effect.andThen(auth.storage.persist(session, options)),
            ),
          read: Deferred.succeed(readStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseRead)),
            Effect.as('{invalid'),
          ),
        }),
        Effect.provideService(AuthSessionValidation, auth.validation),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Deferred.await(readStarted)

      const signOut = yield* clearAuthSession(auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, auth.storage),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Deferred.await(removeStarted)
      yield* Deferred.succeed(releaseRead, undefined)

      const restored = yield* Effect.raceFirst(
        Fiber.await(restore).pipe(Effect.as('restored')),
        Deferred.await(cleanupRequested).pipe(Effect.as('cleanup-requested')),
      )

      expect(restored).toBe('restored')
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(signOut)
      yield* Fiber.join(restore)
      expect(auth.session()).toEqual(emptyAuthSession)
      expect(auth.mutations).toEqual(['remove:start', 'remove:committed'])
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.scoped),
  )
})

test('cancelling an uncancellable storage write does not release its mutation slot early', async () => {
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const mutations: Array<string> = []
  const auth = fixture(null)
  let persisted: AuthSession | null = null

  const storage = makeAuthSessionStorage({
    read: Effect.succeed(null),
    write: (session) =>
      Effect.promise(async () => {
        mutations.push(`write:${session.sessionToken}:start`)

        if (session.sessionToken === cached.sessionToken) {
          started.resolve()
          await release.promise
        }

        persisted = session
        mutations.push(`write:${session.sessionToken}:committed`)
      }),
    remove: Effect.void,
  })

  const controller = new AbortController()

  const first = Effect.runPromiseExit(
    acceptAuthSession(cached, auth.setState).pipe(
      Effect.provideService(AuthSessionStorage, storage),
    ),
    { signal: controller.signal },
  )

  let second: Promise<Exit.Exit<boolean, AuthStorageFailed>> | undefined

  try {
    await started.promise
    controller.abort()
    const newer = { ...cached, sessionToken: 'new-login' }
    second = Effect.runPromiseExit(
      acceptAuthSession(newer, auth.setState).pipe(
        Effect.provideService(AuthSessionStorage, storage),
      ),
    )
    expect(mutations).toEqual(['write:fixture-token:start'])
    release.resolve()
    expect(Exit.isFailure(await first)).toBe(true)
    expect(Exit.isSuccess(await second)).toBe(true)
    expect(auth.session()).toEqual(newer)
    expect(persisted).toEqual(newer)
    expect(mutations).toEqual([
      'write:fixture-token:start',
      'write:fixture-token:committed',
      'write:new-login:start',
      'write:new-login:committed',
    ])
  } finally {
    release.resolve()
    await Promise.allSettled(second ? [first, second] : [first])
  }
})

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
