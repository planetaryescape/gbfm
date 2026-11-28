import { Query } from '@effect/ui'
import { MusicWriteHeaders } from '@gbfm/api/music'
import type { PlayerPreferences } from '@gbfm/player'
import { Context, Effect, Layer, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { preferencesKey, readPlayerPreferences } from '../../player/preferences'
import { DashboardDocument, emptyDocument } from './document'
import { parseDashboardDocument } from './projection'

export class DashboardRequestError extends Schema.TaggedError<DashboardRequestError>()(
  'DashboardRequestError',
  {
    status: Schema.NullOr(Schema.Number),
    message: Schema.String,
  },
) {}

export const DashboardRequest = Schema.Struct({
  path: Schema.String,
  method: Schema.optional(Schema.Literals(['GET', 'PATCH', 'PUT', 'POST', 'DELETE'])),
  body: Schema.optional(Schema.String),
  headers: Schema.optional(MusicWriteHeaders),
})

export type DashboardRequest = typeof DashboardRequest.Type

export class DashboardService extends Context.Service<
  DashboardService,
  {
    readonly request: (
      request: DashboardRequest,
    ) => Effect.Effect<DashboardDocument, DashboardRequestError>
    readonly readPlayerPreferences: Effect.Effect<PlayerPreferences>
    readonly writePlayerPreferences: (
      preferences: PlayerPreferences,
    ) => Effect.Effect<void, DashboardRequestError>
  }
>()('@gbfm/www/native/DashboardService') {}

export const makeDashboardServiceLayer = (fetchImplementation: typeof fetch = globalThis.fetch) =>
  Layer.succeed(DashboardService, {
    request: ({ path, method = 'GET', body, headers }) =>
      Effect.tryPromise({
        try: async (signal) => {
          const origin = globalThis.location?.origin ?? 'http://localhost'
          const url = new URL(path, origin)

          if (url.origin !== origin)
            throw new DashboardRequestError({
              status: null,
              message: 'Cross-origin dashboard request blocked.',
            })

          const requestHeaders = new Headers()

          for (const [name, value] of Object.entries(headers ?? {})) {
            if (value !== undefined) requestHeaders.set(name, value)
          }

          if (body !== undefined) requestHeaders.set('content-type', 'application/json')

          const response = await fetchImplementation(url, {
            signal,
            method,
            credentials: 'include',
            cache: 'no-store',
            headers: requestHeaders,
            body,
          })

          if (!response.ok)
            throw new DashboardRequestError({
              status: response.status,
              message:
                response.status === 403
                  ? 'You do not have access to this operation.'
                  : 'Request failed.',
            })

          if (response.status === 204) return null

          return response.json()
        },
        catch: (cause) =>
          cause instanceof DashboardRequestError
            ? cause
            : new DashboardRequestError({
                status: null,
                message: 'Could not reach the dashboard API.',
              }),
      }).pipe(
        Effect.flatMap((input) => {
          const pathname = new URL(path, 'http://localhost').pathname

          if (
            method === 'GET' ||
            (method === 'POST' &&
              (pathname === '/api/email/send-mix-notification' ||
                pathname === '/api/music/playlists/import/spotify' ||
                /^\/api\/music\/playlists\/[^/]+\/sync-links$/.test(pathname)))
          )
            return parseDashboardDocument(path, input)

          return Effect.succeed(emptyDocument)
        }),
        Effect.mapError((cause) =>
          cause instanceof DashboardRequestError
            ? cause
            : new DashboardRequestError({ status: null, message: 'Invalid dashboard response.' }),
        ),
      ),
    readPlayerPreferences: Effect.sync(() => readPlayerPreferences(() => globalThis.localStorage)),
    writePlayerPreferences: (preferences) =>
      Effect.try({
        try: () => globalThis.localStorage.setItem(preferencesKey, JSON.stringify(preferences)),
        catch: () =>
          new DashboardRequestError({ status: null, message: 'Could not save player settings.' }),
      }),
  })

export const DashboardServiceLive = Layer.unwrap(
  Effect.gen(function* () {
    const fetch = yield* FetchHttpClient.Fetch

    return makeDashboardServiceLayer(fetch)
  }),
)

export class ReadDashboard extends Query.Service<ReadDashboard>()('dashboard/ReadDashboard', {
  args: { path: Schema.String, principalId: Schema.String, revision: Schema.Number },
  success: DashboardDocument,
  error: DashboardRequestError,
  staleTime: 0,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return ({ path }) =>
        service
          .request({ path })
          .pipe(
            Effect.catch((error) =>
              new URL(path, 'http://localhost').pathname === '/api/user/mcp-connections' &&
              (error.status === 403 || error.status === 503)
                ? Effect.succeed(emptyDocument)
                : Effect.fail(error),
            ),
          )
    }),
  )
}
