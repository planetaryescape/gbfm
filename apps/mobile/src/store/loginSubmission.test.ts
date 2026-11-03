import { Deferred, Effect, Fiber, Predicate } from 'effect'
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import { expect, test } from 'vitest'

import { loginWithClient } from '@/api/auth'

import {
  acceptAuthSession,
  AuthLifecycle,
  AuthSessionStorage,
  AuthStorageFailed,
  currentAuthSession,
  type AuthSession,
  type SetAuthLifecycle,
} from './authLifecycle'
import { idleLoginSubmission, LoginSubmission, submitLogin } from './loginSubmission'

const user = {
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

const credentials = { email: 'fixture@example.test', password: 'fixture-password' }

const fixture = (response: Response, writeGate: Effect.Effect<void> = Effect.void) => {
  const requests: Array<{ readonly method: string; readonly path: string }> = []

  const httpClient = HttpClient.make((request, url) => {
    requests.push({ method: request.method, path: url.pathname })

    return Effect.succeed(HttpClientResponse.fromWeb(request, response.clone()))
  })

  let submission: LoginSubmission = idleLoginSubmission
  let auth: AuthLifecycle = AuthLifecycle.SignedOut()
  const persisted: Array<AuthSession> = []
  const failures = new Set<string>()
  const navigation: Array<string> = []
  const events: Array<string> = []

  const storage = AuthSessionStorage.of({
    read: Effect.succeed(null),
    write: (session) =>
      Effect.gen(function* () {
        events.push('write-start')
        yield* writeGate

        if (failures.has('write'))
          yield* new AuthStorageFailed({ message: 'Could not save the session.' })
        persisted.push(session)
        events.push('persisted')
      }),
    remove: Effect.void,
  })

  const update = (next: (current: LoginSubmission) => LoginSubmission) => {
    submission = next(submission)
  }

  const setLifecycle: SetAuthLifecycle = (update) => {
    auth = Predicate.isFunction(update) ? update(auth) : update
  }

  const setAuth = (session: AuthSession) => acceptAuthSession(session, setLifecycle)

  const request = loginWithClient(
    { httpClient, baseUrl: 'https://fixture.test' },
    credentials,
  ).pipe(Effect.tap(setAuth))

  const navigate = () => {
    events.push('navigate')
    navigation.push('profile')
  }

  const work = submitLogin(request, update, navigate).pipe(
    Effect.provideService(AuthSessionStorage, storage),
  )

  return {
    requests,
    failures,
    navigation,
    events,
    persisted,
    storage,
    request,
    work,
    update,
    navigate,
    state: () => submission,
    session: () => currentAuthSession(auth),
  }
}

test('login success persists the parsed session before navigating and returns to idle', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))
  await Effect.runPromise(login.work)
  expect(login.requests).toEqual([{ method: 'POST', path: '/auth/sign-in/email' }])
  expect(login.state()).toEqual(LoginSubmission.Idle())
  expect(login.session().user?.role).toBe('creator')
  expect(login.persisted).toEqual([login.session()])
  expect(login.navigation).toEqual(['profile'])
  expect(login.events).toEqual(['write-start', 'persisted', 'navigate'])
})

test('login cannot navigate while session persistence is pending', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()

      const login = fixture(
        Response.json({ user, token: 'fixture-token' }),
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))),
      )

      const fiber = yield* login.work.pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(login.events).toEqual(['write-start'])
      expect(login.persisted).toEqual([])
      expect(login.navigation).toEqual([])
      expect(login.state()).toEqual(LoginSubmission.Submitting())
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(fiber)
      expect(login.events).toEqual(['write-start', 'persisted', 'navigate'])
      expect(login.persisted).toEqual([login.session()])
      expect(login.state()).toEqual(LoginSubmission.Idle())
    }).pipe(Effect.scoped),
  )
})

test.each([401, 403, 500])(
  'HTTP login failure (%s) is displayed without persistence or navigation',
  async (status) => {
    const login = fixture(new Response(null, { status }))
    await Effect.runPromise(login.work)
    expect(login.state()).toEqual(
      LoginSubmission.Failed({ message: `Login failed with status ${status}` }),
    )
    expect(login.persisted).toEqual([])
    expect(login.navigation).toEqual([])
    expect(login.session().user).toBeNull()
  },
)

test('malformed login response becomes a generic failure and does not install a session', async () => {
  const login = fixture(Response.json({ token: 'fixture-token', user: { id: 'incomplete' } }))
  await Effect.runPromise(login.work)
  expect(login.state()).toEqual(LoginSubmission.Failed({ message: 'Unable to sign in right now.' }))
  expect(login.session().user).toBeNull()
  expect(login.navigation).toEqual([])
})

test('transport failure uses the same generic message and does not navigate', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))

  const httpClient = HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request }),
      }),
    ),
  )

  await Effect.runPromise(
    submitLogin(
      loginWithClient({ httpClient, baseUrl: 'https://fixture.test' }, credentials),
      login.update,
      login.navigate,
    ),
  )
  expect(login.state()).toEqual(LoginSubmission.Failed({ message: 'Unable to sign in right now.' }))
  expect(login.navigation).toEqual([])
})

test('session persistence failure leaves memory authenticated but displays failure and skips navigation', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))
  login.failures.add('write')
  await Effect.runPromise(login.work)
  expect(login.state()).toEqual(LoginSubmission.Failed({ message: 'Unable to sign in right now.' }))
  expect(login.session().user?.id).toBe(user.id)
  expect(login.persisted).toEqual([])
  expect(login.navigation).toEqual([])
})

test('repeated login after persistence failure remains a separate network submission', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))
  login.failures.add('write')
  await Effect.runPromise(login.work)
  login.failures.clear()
  await Effect.runPromise(login.work)
  expect(login.requests).toHaveLength(2)
  expect(login.state()).toEqual(LoginSubmission.Idle())
  expect(login.persisted).toHaveLength(1)
  expect(login.navigation).toEqual(['profile'])
})

test('characterizes concurrent login submissions: one completion clears busy while another is pending', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()

      const pending = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(finish)),
        Effect.andThen(login.request),
      )

      const fiber = yield* submitLogin(pending, login.update, login.navigate).pipe(
        Effect.forkScoped,
      )

      yield* Deferred.await(started)
      expect(LoginSubmission.$is('Submitting')(login.state())).toBe(true)
      yield* login.work
      expect(LoginSubmission.$is('Idle')(login.state())).toBe(true)
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(fiber)
      expect(login.requests).toHaveLength(2)
      expect(login.navigation).toEqual(['profile', 'profile'])
    }).pipe(Effect.provideService(AuthSessionStorage, login.storage), Effect.scoped),
  )
})

test('caller interruption finalizes pending submission without navigation or persistence', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const pending = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))

      const fiber = yield* submitLogin(pending, login.update, login.navigate).pipe(
        Effect.forkScoped,
      )

      yield* Deferred.await(started)
      expect(LoginSubmission.$is('Submitting')(login.state())).toBe(true)
      yield* Fiber.interrupt(fiber)
      expect(LoginSubmission.$is('Idle')(login.state())).toBe(true)
      expect(login.persisted).toEqual([])
      expect(login.navigation).toEqual([])
    }).pipe(Effect.scoped),
  )
})

test('a pending successful login does not erase a concurrent failure message', async () => {
  const login = fixture(Response.json({ user, token: 'fixture-token' }))

  const failedClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 401 }))),
  )

  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()

      const pending = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(finish)),
        Effect.andThen(login.request),
      )

      const fiber = yield* submitLogin(pending, login.update, login.navigate).pipe(
        Effect.forkScoped,
      )

      yield* Deferred.await(started)
      yield* submitLogin(
        loginWithClient({ httpClient: failedClient, baseUrl: 'https://fixture.test' }, credentials),
        login.update,
        login.navigate,
      )
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(fiber)
      expect(login.state()).toEqual(
        LoginSubmission.Failed({ message: 'Login failed with status 401' }),
      )
      expect(login.navigation).toEqual(['profile'])
    }).pipe(Effect.provideService(AuthSessionStorage, login.storage), Effect.scoped),
  )
})
