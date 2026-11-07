/* oxlint-disable effecttsgo/strict-effect-provide -- Auth hooks compose the shared SecureStore value layer, which has no scoped resources. */
import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as SecureStore from 'expo-secure-store'
import { type PropsWithChildren, useMemo } from 'react'

import { getSession, SessionExpired, SessionUnavailable } from '@/api/auth'

import {
  acceptAuthSession,
  AuthLifecycle,
  AuthSessionStorageLayer,
  AuthSessionValidation,
  AuthStorageFailed,
  clearAuthSession,
  currentAuthIdentity,
  currentAuthSession,
  restoreAuthSession,
  type AuthSession,
} from './authLifecycle'

export type { AuthSession } from './authLifecycle'

const storageKey = 'gbfm.auth-session'

const storage = AuthSessionStorageLayer({
  read: Effect.tryPromise({
    try: () => SecureStore.getItemAsync(storageKey),
    catch: () => new AuthStorageFailed({ message: 'Could not read the saved session.' }),
  }),
  write: (session) =>
    Effect.tryPromise({
      try: () => SecureStore.setItemAsync(storageKey, JSON.stringify(session)),
      catch: () => new AuthStorageFailed({ message: 'Could not save the session.' }),
    }),
  remove: Effect.tryPromise({
    try: () => SecureStore.deleteItemAsync(storageKey),
    catch: () => new AuthStorageFailed({ message: 'Could not remove the saved session.' }),
  }),
})

const lifecycle = Atom.make<AuthLifecycle>(AuthLifecycle.Bootstrapping()).pipe(Atom.keepAlive)

export const authState = Atom.make((get) => currentAuthSession(get(lifecycle))).pipe(Atom.keepAlive)

const authReady = Atom.make(false).pipe(Atom.keepAlive)

export const useAuthReady = () => useAtomValue(authReady)

export const useAuthIdentity = () => useAtomValue(lifecycle, currentAuthIdentity)

const makeRestoreAuthAtom = (
  setState: (state: AuthLifecycle | ((current: AuthLifecycle) => AuthLifecycle)) => void,
  setReady: (ready: boolean) => void,
) =>
  Atom.make(
    restoreAuthSession(setState).pipe(
      Effect.provide(storage),
      Effect.provideService(AuthSessionValidation, {
        validate: (token) =>
          getSession(token).pipe(
            Effect.mapError((error) =>
              error instanceof SessionUnavailable || error instanceof SessionExpired
                ? error
                : new SessionUnavailable({ message: 'Unable to refresh session.' }),
            ),
          ),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          setState((current) =>
            AuthLifecycle.$is('Bootstrapping')(current) ? AuthLifecycle.SignedOut() : current,
          )
          setReady(true)
        }),
      ),
    ),
  )

export const useAuthStore = <T>(selector: (state: AuthSession) => T) =>
  useAtomValue(authState, selector)

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const setState = useAtomSet(lifecycle)
  const setReady = useAtomSet(authReady)
  const restoreAtom = useMemo(() => makeRestoreAuthAtom(setState, setReady), [setState, setReady])
  useAtomMount(restoreAtom)

  return children
}

export const useSetAuth = () => {
  const setState = useAtomSet(lifecycle)

  return (session: AuthSession) =>
    acceptAuthSession(session, setState).pipe(Effect.provide(storage))
}

export const useClearAuth = () => {
  const setState = useAtomSet(lifecycle)

  return () => clearAuthSession(setState).pipe(Effect.provide(storage))
}
