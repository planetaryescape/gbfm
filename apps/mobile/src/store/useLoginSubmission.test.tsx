import { Effect, Predicate } from 'effect'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'test-renderer'
import { expect, test } from 'vitest'

import {
  acceptAuthSession,
  AuthLifecycle,
  AuthSessionStorage,
  AuthStorageFailed,
  currentAuthSession,
  emptyAuthSession,
  makeAuthSessionStorage,
  type AuthSession,
} from './authLifecycle'
import { LoginSubmission } from './loginSubmission'
import { useLoginSubmission } from './useLoginSubmission'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('the login hook gates two submissions from the same render and cancels on unmount', async () => {
  let current: ReturnType<typeof useLoginSubmission> | undefined
  const signals: Array<AbortSignal> = []
  let finish: (() => void) | undefined
  const navigations: Array<string> = []

  const request = Effect.promise((signal) => {
    signals.push(signal)

    return new Promise<typeof emptyAuthSession>((resolve) => {
      finish = () => resolve(emptyAuthSession)
    })
  })

  function LoginHarness() {
    const login = useLoginSubmission()
    useEffect(() => {
      current = login
    })

    return null
  }

  const mounted = createRoot()
  await act(async () => {
    mounted.render(createElement(LoginHarness))
  })

  if (!current) throw new Error('login not mounted')
  const sameRender = current
  let first: ReturnType<typeof sameRender.submit> | undefined
  let duplicate: ReturnType<typeof sameRender.submit> | undefined
  await act(async () => {
    first = sameRender.submit(request, () => navigations.push('profile'))
    duplicate = sameRender.submit(request, () => navigations.push('profile'))
  })
  expect(signals).toHaveLength(1)
  expect(duplicate).toBeNull()
  expect(current.submission).toEqual(LoginSubmission.Submitting())
  await act(async () => mounted.unmount())
  expect(signals[0]?.aborted).toBe(true)
  finish?.()
  await first
  expect(navigations).toEqual([])
  expect(sameRender.submit(request, () => navigations.push('profile'))).toBeNull()
  expect(signals).toHaveLength(1)
})

test('the login hook retains authenticated memory on storage failure and permits a fresh retry', async () => {
  let current: ReturnType<typeof useLoginSubmission> | undefined
  let auth: AuthLifecycle = AuthLifecycle.SignedOut()
  let failWrite = true
  const navigations: Array<string> = []

  const session: AuthSession = {
    user: {
      id: 'fixture-user',
      name: 'Fixture',
      username: null,
      email: 'fixture@example.test',
      avatarUrl: null,
      verified: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    sessionToken: 'fixture-token',
  }

  const request = Effect.succeed(session).pipe(
    Effect.tap((session) =>
      acceptAuthSession(session, (update) => {
        auth = Predicate.isFunction(update) ? update(auth) : update
      }),
    ),
    Effect.provideService(
      AuthSessionStorage,
      makeAuthSessionStorage({
        read: Effect.succeed(null),
        remove: Effect.void,
        write: () =>
          Effect.suspend(() =>
            failWrite
              ? Effect.fail(new AuthStorageFailed({ message: 'Write failed' }))
              : Effect.void,
          ),
      }),
    ),
  )

  function LoginHarness() {
    const login = useLoginSubmission()
    useEffect(() => {
      current = login
    })

    return null
  }

  const mounted = createRoot()
  await act(async () => {
    mounted.render(createElement(LoginHarness))
  })

  if (!current) throw new Error('login not mounted')
  const initialRender = current
  await act(async () => {
    await initialRender.submit(request, () => navigations.push('profile'))
  })
  expect(current.submission).toEqual(
    LoginSubmission.Failed({ message: 'Unable to sign in right now.' }),
  )
  expect(currentAuthSession(auth)).toEqual(session)
  expect(navigations).toEqual([])
  failWrite = false
  await act(async () => {
    await initialRender.submit(request, () => navigations.push('profile'))
  })
  expect(current.submission).toEqual(LoginSubmission.Idle())
  expect(navigations).toEqual(['profile'])
  await act(async () => mounted.unmount())
})
