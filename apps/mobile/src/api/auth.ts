import type { FullUser, LoginRequest } from '@gbfm/core/api'
import { Data, Effect, Redacted, Schema } from 'effect'
import { HttpClientRequest, type HttpClient } from 'effect/http'

import { getHttpClient } from '@/api/client'
import { env } from '@/env'

export class LoginFailed extends Data.TaggedError('LoginFailed')<{
  readonly message: string
}> {}

export class SessionUnavailable extends Data.TaggedError('SessionUnavailable')<{
  readonly message: string
}> {}

export class SessionExpired extends Data.TaggedError('SessionExpired') {}

const BetterAuthUser = Schema.Struct({
  role: Schema.optional(Schema.NullOr(Schema.String)),
  id: Schema.String,
  name: Schema.String,
  username: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

const BetterAuthLoginResponse = Schema.Struct({
  user: BetterAuthUser,
  token: Schema.String,
})

const BetterAuthSessionResponse = Schema.Struct({ user: BetterAuthUser })

export type SessionUser = FullUser & { readonly role?: string | null }

const toFullUser = (user: typeof BetterAuthUser.Type): SessionUser => ({
  role: user.role ?? 'user',
  id: user.id,
  name: user.name,
  username: user.username ?? user.name,
  email: user.email,
  avatarUrl: user.image ?? null,
  verified: user.emailVerified,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
})

export const login = (credentials: LoginRequest) =>
  Effect.gen(function* () {
    const client = yield* getHttpClient

    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(`${env.EXPO_PUBLIC_API_URL}/auth/sign-in/email`),
      credentials,
    )

    const response = yield* client.execute(request)

    if (response.status < 200 || response.status >= 300) {
      return yield* new LoginFailed({ message: `Login failed with status ${response.status}` })
    }

    const data = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(BetterAuthLoginResponse)),
    )

    return { user: toFullUser(data.user), sessionToken: data.token }
  })

export const getSessionWithClient = Effect.fn('getSessionWithClient')(function* (connection: {
  readonly httpClient: HttpClient.HttpClient
  readonly baseUrl: string
  readonly sessionToken: Redacted.Redacted
}) {
  const request = HttpClientRequest.get(`${connection.baseUrl}/auth/get-session`).pipe(
    HttpClientRequest.bearerToken(connection.sessionToken),
  )

  const response = yield* connection.httpClient
    .execute(request)
    .pipe(Effect.mapError(() => new SessionUnavailable({ message: 'Unable to refresh session.' })))

  if (response.status === 401) return yield* new SessionExpired()

  if (response.status < 200 || response.status >= 300) {
    return yield* new SessionUnavailable({ message: `Session check failed: ${response.status}` })
  }

  const data = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.NullOr(BetterAuthSessionResponse))),
    Effect.mapError(() => new SessionUnavailable({ message: 'Unable to read session.' })),
  )

  if (data === null) return yield* new SessionExpired()

  return toFullUser(data.user)
})

export const getSession = (sessionToken: string) =>
  Effect.gen(function* () {
    const httpClient = yield* getHttpClient

    return yield* getSessionWithClient({
      httpClient,
      baseUrl: env.EXPO_PUBLIC_API_URL,
      sessionToken: Redacted.make(sessionToken),
    })
  })
