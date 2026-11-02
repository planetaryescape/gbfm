import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as SecureStore from 'expo-secure-store'
import { type PropsWithChildren, useMemo } from 'react'

import { getSession, SessionExpired, type SessionUser } from '@/api/auth'

export type AuthSession = {
  readonly user: SessionUser | null
  readonly sessionToken: string | null
}

const emptyAuthState: AuthSession = { user: null, sessionToken: null }

const PersistedAuthSession = Schema.Struct({
  user: Schema.Struct({
    role: Schema.optionalKey(Schema.NullOr(Schema.String)),
    id: Schema.String,
    name: Schema.String,
    username: Schema.NullOr(Schema.String),
    email: Schema.String,
    avatarUrl: Schema.NullOr(Schema.String),
    verified: Schema.Boolean,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
  sessionToken: Schema.String,
})

const storageKey = 'gbfm.auth-session'

export const authState = Atom.make<AuthSession>(emptyAuthState).pipe(Atom.keepAlive)

const authReady = Atom.make(false).pipe(Atom.keepAlive)

export const useAuthReady = () => useAtomValue(authReady)

const persistAuth = (session: AuthSession) =>
  session.user && session.sessionToken
    ? Effect.tryPromise(() => SecureStore.setItemAsync(storageKey, JSON.stringify(session)))
    : Effect.tryPromise(() => SecureStore.deleteItemAsync(storageKey))

const makeRestoreAuth = (setState: (session: AuthSession) => void) =>
  Effect.gen(function* () {
    const stored = yield* Effect.tryPromise(() => SecureStore.getItemAsync(storageKey)).pipe(
      Effect.catch(() => Effect.succeed(null)),
    )

    if (!stored) return

    const cached = yield* Effect.try({ try: () => JSON.parse(stored), catch: () => null }).pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(PersistedAuthSession)(value)),
      Effect.catch(() => Effect.succeed(null)),
    )

    if (!cached) {
      yield* Effect.tryPromise(() => SecureStore.deleteItemAsync(storageKey)).pipe(Effect.ignore)

      return
    }

    setState(cached)

    yield* getSession(cached.sessionToken).pipe(
      Effect.tap((user) =>
        Effect.gen(function* () {
          const refreshed = { user, sessionToken: cached.sessionToken }
          setState(refreshed)
          yield* persistAuth(refreshed)
        }),
      ),
      Effect.catch((error) =>
        error instanceof SessionExpired
          ? Effect.gen(function* () {
              setState(emptyAuthState)
              yield* persistAuth(emptyAuthState)
            })
          : Effect.void,
      ),
    )
  })

const makeRestoreAuthAtom = (
  setState: (session: AuthSession) => void,
  setReady: (ready: boolean) => void,
) => Atom.make(makeRestoreAuth(setState).pipe(Effect.ensuring(Effect.sync(() => setReady(true)))))

export const useAuthStore = <T>(selector: (state: AuthSession) => T) =>
  useAtomValue(authState, selector)

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const setState = useAtomSet(authState)
  const setReady = useAtomSet(authReady)
  const restoreAtom = useMemo(() => makeRestoreAuthAtom(setState, setReady), [setState, setReady])
  useAtomMount(restoreAtom)

  return children
}

export const useSetAuth = () => {
  const setState = useAtomSet(authState)

  return (session: AuthSession) => {
    setState(session)

    return persistAuth(session)
  }
}

export const useClearAuth = () => {
  const setState = useAtomSet(authState)

  return () => {
    return persistAuth(emptyAuthState).pipe(
      Effect.tap(() => Effect.sync(() => setState(emptyAuthState))),
    )
  }
}
