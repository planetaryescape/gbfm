import { Context, Data, Effect, Schema } from 'effect'

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

export class AuthStorageFailed extends Schema.TaggedError<AuthStorageFailed>()(
  'AuthStorageFailed',
  {
    message: Schema.String,
  },
) {}

export class AuthSessionStorage extends Context.Service<
  AuthSessionStorage,
  {
    readonly read: Effect.Effect<string | null, AuthStorageFailed>
    readonly write: (session: AuthSession) => Effect.Effect<void, AuthStorageFailed>
    readonly remove: Effect.Effect<void, AuthStorageFailed>
  }
>()('mobile/AuthSessionStorage') {}

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

export const persistAuthSession = Effect.fn('persistAuthSession')(function* (session: AuthSession) {
  const storage = yield* AuthSessionStorage
  yield* session.user && session.sessionToken ? storage.write(session) : storage.remove
})

export const restoreAuthSession = Effect.fn('restoreAuthSession')(function* (
  setState: SetAuthLifecycle,
) {
  const storage = yield* AuthSessionStorage
  const stored = yield* storage.read.pipe(Effect.orElseSucceed(() => null))

  if (!stored) return

  const cached = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedAuthSession))(
    stored,
  ).pipe(Effect.orElseSucceed(() => null))

  if (!cached) {
    yield* storage.remove.pipe(Effect.ignore)

    return
  }

  setState(AuthLifecycle.ValidatingSession({ session: cached }))
  const validation = yield* AuthSessionValidation

  yield* validation.validate(cached.sessionToken).pipe(
    Effect.matchEffect({
      onSuccess: (user) =>
        Effect.gen(function* () {
          const refreshed = { user, sessionToken: cached.sessionToken }
          setState(AuthLifecycle.Authenticated({ session: refreshed }))
          yield* persistAuthSession(refreshed).pipe(Effect.ignore)
        }),
      onFailure: (error) =>
        error instanceof SessionExpired
          ? Effect.gen(function* () {
              setState(AuthLifecycle.SignedOut())
              yield* persistAuthSession(emptyAuthSession)
            })
          : Effect.sync(() =>
              setState((current) =>
                AuthLifecycle.$is('ValidatingSession')(current) && current.session === cached
                  ? AuthLifecycle.CachedSession({ session: cached })
                  : current,
              ),
            ),
    }),
  )
})

export const acceptAuthSession = (session: AuthSession, setState: SetAuthLifecycle) => {
  setState(
    session.user !== null || session.sessionToken !== null
      ? AuthLifecycle.Authenticated({ session })
      : AuthLifecycle.SignedOut(),
  )

  return persistAuthSession(session)
}

export const clearAuthSession = (setState: SetAuthLifecycle) =>
  persistAuthSession(emptyAuthSession).pipe(
    Effect.tap(() => Effect.sync(() => setState(AuthLifecycle.SignedOut()))),
  )
