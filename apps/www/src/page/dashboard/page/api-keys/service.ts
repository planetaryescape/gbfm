import { type IssueKeyInput, KeyMetadata } from '@gbfm/api/personal-access-keys'
import type { KeyId } from '@gbfm/core/personal-access-keys'
import { Context, Effect, Layer, Redacted, Schema } from 'effect'

export const KeyPage = Schema.Struct({
  data: Schema.Array(KeyMetadata),
  pagination: Schema.Struct({
    total: Schema.Number,
    limit: Schema.Number,
    offset: Schema.Number,
    hasMore: Schema.Boolean,
  }),
})

const IssuedKey = Schema.Struct({ key: KeyMetadata, secret: Schema.Redacted(Schema.String) })

const CurrentSession = Schema.Struct({
  user: Schema.Struct({ id: Schema.String, email: Schema.String }),
  session: Schema.Struct({ impersonatedBy: Schema.optional(Schema.NullOr(Schema.String)) }),
})

export class KeyRequestError extends Schema.TaggedError<KeyRequestError>()('KeyRequestError', {
  message: Schema.String,
}) {}

export class KeyService extends Context.Service<
  KeyService,
  {
    readonly list: (offset: number) => Effect.Effect<typeof KeyPage.Type, KeyRequestError>
    readonly issue: (input: IssueKeyInput) => Effect.Effect<typeof IssuedKey.Type, KeyRequestError>
    readonly revoke: (id: typeof KeyId.Type) => Effect.Effect<void, KeyRequestError>
    readonly confirmPassword: (
      userId: string,
      password: Redacted.Redacted,
    ) => Effect.Effect<void, KeyRequestError>
  }
>()('@gbfm/www/PersonalAccessKeys') {}

const failureMessage = (status: number) => {
  if (status === 401) return 'Sign in again to manage your API keys.'

  if (status === 403)
    return 'Key creation was denied. Check your authoring permissions and confirm your password again.'

  if (status === 409)
    return 'The active-key limit was reached, or this request already issued a key. Refresh the list and revoke an unused key before trying again.'

  if (status === 400 || status === 422) return 'Check the key name, permissions and expiry.'

  if (status === 429) return 'Too many requests. Wait a minute before trying again.'

  return 'The API key request failed. Try refreshing the list.'
}

export const makeKeyServiceLayer = (fetchImplementation: typeof fetch = globalThis.fetch) => {
  const request = (path: string, method = 'GET', body?: string) =>
    Effect.tryPromise({
      try: (signal) =>
        fetchImplementation(path, {
          method,
          signal,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body,
        }),
      catch: () =>
        new KeyRequestError({
          message:
            'Could not reach the API. Refresh the key list before retrying creation; a key may have been issued.',
        }),
    }).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.succeed(response)
          : Effect.fail(new KeyRequestError({ message: failureMessage(response.status) })),
      ),
    )

  const decode = <A>(response: Response, schema: Schema.Codec<A, unknown, never, unknown>) =>
    Effect.tryPromise({
      try: () => response.json(),
      catch: () =>
        new KeyRequestError({
          message: 'Could not read the response. Refresh the key list before retrying.',
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError(
        () =>
          new KeyRequestError({
            message: 'Could not read the response. Refresh the key list before retrying.',
          }),
      ),
    )

  return Layer.succeed(KeyService, {
    confirmPassword: (userId, password) =>
      Effect.gen(function* () {
        const current = yield* request('/auth/get-session').pipe(
          Effect.flatMap((response) => decode(response, CurrentSession)),
        )

        if (current.user.id !== userId || current.session.impersonatedBy)
          return yield* new KeyRequestError({
            message: 'Your account session changed. Reload this page before creating a key.',
          })

        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetchImplementation('/auth/sign-in/email', {
              method: 'POST',
              signal,
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                email: current.user.email,
                password: Redacted.value(password),
              }),
            }),
          catch: () =>
            new KeyRequestError({ message: 'Could not verify your password. Try again.' }),
        })

        if (!response.ok)
          return yield* new KeyRequestError({
            message:
              response.status === 401 || response.status === 400
                ? 'Incorrect password. Try again.'
                : response.status === 429
                  ? 'Too many attempts. Wait a minute before trying again.'
                  : 'Could not verify your password. Try again.',
          })

        const refreshed = yield* request('/auth/get-session').pipe(
          Effect.flatMap((response) => decode(response, CurrentSession)),
        )

        if (refreshed.user.id !== userId || refreshed.session.impersonatedBy)
          return yield* new KeyRequestError({
            message: 'Your account session changed. Reload this page before creating a key.',
          })

        return undefined
      }),
    list: (offset) =>
      request(`/api/user/api-keys?limit=20&offset=${offset}`).pipe(
        Effect.flatMap((response) => decode(response, KeyPage)),
      ),
    issue: (input) =>
      request('/api/user/api-keys', 'POST', JSON.stringify(input)).pipe(
        Effect.flatMap((response) =>
          decode(response, Schema.Struct({ key: KeyMetadata, secret: Schema.String })),
        ),
        Effect.map(({ key, secret }) => ({ key, secret: Redacted.make(secret) })),
      ),
    revoke: (id) =>
      request(`/api/user/api-keys/${encodeURIComponent(id)}`, 'DELETE').pipe(Effect.asVoid),
  })
}

export const KeyServiceLive = makeKeyServiceLayer()
