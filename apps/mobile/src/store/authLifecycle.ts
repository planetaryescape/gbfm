import { Context, Data, Effect, Layer, Schema, Semaphore } from 'effect'

import { SessionExpired, type SessionUnavailable, type SessionUser } from '@/api/auth'

export type AuthSession = {
  readonly user: SessionUser | null
  readonly sessionToken: string | null
}

export const emptyAuthSession: AuthSession = { user: null, sessionToken: null }

export type AuthLifecycle =
  | { readonly _tag: 'Bootstrapping' }
  | { readonly _tag: 'SignedOut' }
  | Data.TaggedEnum<{
      ValidatingSession: { readonly session: AuthSession }
      CachedSession: { readonly session: AuthSession }
      Authenticated: { readonly session: AuthSession }
    }>

export const AuthLifecycle = Data.taggedEnum<AuthLifecycle>()

export type SetAuthLifecycle = (
  update: AuthLifecycle | ((current: AuthLifecycle) => AuthLifecycle),
) => void

export const currentAuthSession = (state: AuthLifecycle): AuthSession =>
  AuthLifecycle.$match(state, {
    Bootstrapping: () => emptyAuthSession,
    SignedOut: () => emptyAuthSession,
    ValidatingSession: ({ session }) => session,
    CachedSession: ({ session }) => session,
    Authenticated: ({ session }) => session,
  })

export const currentAuthIdentity = (state: AuthLifecycle): string | null =>
  AuthLifecycle.$is('Bootstrapping')(state)
    ? null
    : (currentAuthSession(state).user?.id ?? 'anonymous')

export class AuthStorageFailed extends Schema.TaggedError<AuthStorageFailed>()(
  'AuthStorageFailed',
  {
    message: Schema.String,
  },
) {}

type AuthSessionPersistence = {
  readonly read: Effect.Effect<string | null, AuthStorageFailed>
  readonly write: (session: AuthSession) => Effect.Effect<void, AuthStorageFailed>
  readonly remove: Effect.Effect<void, AuthStorageFailed>
}

export class AuthSessionStorage extends Context.Service<
  AuthSessionStorage,
  {
    readonly read: AuthSessionPersistence['read']
    readonly persist: (
      session: AuthSession,
      options: { readonly owns: () => boolean },
    ) => Effect.Effect<boolean, AuthStorageFailed>
  }
>()('mobile/AuthSessionStorage') {}

export const makeAuthSessionStorage = (persistence: AuthSessionPersistence) => {
  const mutations = Semaphore.makeUnsafe(1)

  return AuthSessionStorage.of({
    read: persistence.read,
    persist: (session, { owns }) =>
      Effect.suspend(() => {
        if (!owns()) return Effect.succeed(false)

        return (
          session.user && session.sessionToken ? persistence.write(session) : persistence.remove
        ).pipe(Effect.as(true))
      }).pipe(Effect.uninterruptible, (mutation) => mutations.withPermit(mutation)),
  })
}

export const AuthSessionStorageLayer = (persistence: AuthSessionPersistence) =>
  Layer.succeed(AuthSessionStorage, makeAuthSessionStorage(persistence))

const ownsAuthLifecycle = (setState: SetAuthLifecycle, owner: AuthLifecycle | null) => {
  let owned = false
  setState((current) => {
    owned = current === owner

    return current
  })

  return owned
}

export class AuthSessionValidation extends Context.Service<
  AuthSessionValidation,
  {
    readonly validate: (
      token: string,
    ) => Effect.Effect<SessionUser, SessionExpired | SessionUnavailable>
  }
>()('mobile/AuthSessionValidation') {}

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

export const persistAuthSession = Effect.fn('persistAuthSession')(function* (
  session: AuthSession,
  owns: () => boolean,
) {
  const storage = yield* AuthSessionStorage

  return yield* storage.persist(session, { owns })
})

export const restoreAuthSession = Effect.fn('restoreAuthSession')(function* (
  setState: SetAuthLifecycle,
) {
  const storage = yield* AuthSessionStorage
  let owner: AuthLifecycle | null = null
  setState((current) => {
    owner = current

    return current
  })

  const ownsRestore = () => ownsAuthLifecycle(setState, owner)

  const stored = yield* storage.read.pipe(Effect.orElseSucceed(() => null))

  if (!stored || !ownsRestore()) return

  const cached = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedAuthSession))(
    stored,
  ).pipe(Effect.orElseSucceed(() => null))

  if (!ownsRestore()) return

  if (!cached) {
    yield* storage.persist(emptyAuthSession, { owns: ownsRestore }).pipe(Effect.ignore)

    return
  }

  const validating = AuthLifecycle.ValidatingSession({ session: cached })
  setState(validating)

  const transition = (next: AuthLifecycle) => {
    let owned = false
    setState((current) => {
      if (current !== validating) return current
      owned = true

      return next
    })

    return owned
  }

  const validation = yield* AuthSessionValidation

  yield* validation.validate(cached.sessionToken).pipe(
    Effect.matchEffect({
      onSuccess: (user) =>
        Effect.gen(function* () {
          const refreshed = { user, sessionToken: cached.sessionToken }
          const authenticated = AuthLifecycle.Authenticated({ session: refreshed })

          if (transition(authenticated))
            yield* persistAuthSession(refreshed, () =>
              ownsAuthLifecycle(setState, authenticated),
            ).pipe(Effect.ignore)
        }),
      onFailure: (error) =>
        error instanceof SessionExpired
          ? Effect.gen(function* () {
              const signedOut = AuthLifecycle.SignedOut()

              if (transition(signedOut))
                yield* persistAuthSession(emptyAuthSession, () =>
                  ownsAuthLifecycle(setState, signedOut),
                )
            })
          : Effect.sync(() => transition(AuthLifecycle.CachedSession({ session: cached }))),
    }),
  )
})

export const acceptAuthSession = (session: AuthSession, setState: SetAuthLifecycle) => {
  const authenticated =
    session.user !== null || session.sessionToken !== null
      ? AuthLifecycle.Authenticated({ session })
      : AuthLifecycle.SignedOut()

  setState(authenticated)

  return persistAuthSession(session, () => ownsAuthLifecycle(setState, authenticated))
}

export const clearAuthSession = (setState: SetAuthLifecycle) =>
  Effect.gen(function* () {
    let signOutOwner: AuthLifecycle | null = null
    setState((current) => {
      signOutOwner = { ...current }

      return signOutOwner
    })

    const removed = yield* persistAuthSession(emptyAuthSession, () =>
      ownsAuthLifecycle(setState, signOutOwner),
    )

    if (removed)
      setState((current) => (current === signOutOwner ? AuthLifecycle.SignedOut() : current))
  })
