import { Api } from '@gbfm/api/api'
import type { ReadinessCheckFailedError } from '@gbfm/api/errors'
import { Effect, Layer, Match, Result } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import * as Path from 'effect/Path'

import { AdminHandlersLive } from '@/http/admin.handlers'
import { AudioHandlersLive } from '@/http/audio.handlers'
import { DocsLive } from '@/http/docs'
import { EmailHandlersLive } from '@/http/email.handlers'
import { FavoritesHandlersLive } from '@/http/favorites.handlers'
import { FileManagerHandlersLive } from '@/http/file-manager.handlers'
import { CorsLive, RequestLoggerLive, SentryDefectLive } from '@/http/global-middleware'
import { checkDatabase, makeHealthHandlers } from '@/http/health.handlers'
import { InternalHandlersLive } from '@/http/internal.handlers'
import { InviteHandlersLive } from '@/http/invite.handlers'
import { ListeningHandlersLive } from '@/http/listening.handlers'
import { MusicRemindersHandlersLive } from '@/http/music-reminders.handlers'
import { MusicHandlersLive } from '@/http/music.handlers'
import { NavigationHandlersLive } from '@/http/navigation.handlers'
import { NewsletterHandlersLive } from '@/http/newsletter.handlers'
import { keyRequestRejection, privateKeyResponse } from '@/http/personal-access-key-policy'
import { PersonalAccessKeyHandlersLive } from '@/http/personal-access-key.handlers'
import { PostHandlersLive } from '@/http/post.handlers'
import { ProfileHandlersLive } from '@/http/profile.handlers'
import { ReleaseHandlersLive } from '@/http/release.handlers'
import { ResolveHandlersLive } from '@/http/resolve.handlers'
import { SearchHandlersLive } from '@/http/search.handlers'
import { SearchCacheHeaderLive } from '@/http/search.middleware'
import { ShowsHandlersLive } from '@/http/shows.handlers'
import { SiteMetadataHandlersLive } from '@/http/site-metadata.handlers'
import { SiteRoutesLive } from '@/http/site-routes'
import { SpotifyHandlersLive } from '@/http/spotify.handlers'
import { UploadHandlersLive } from '@/http/upload.handlers'
import { UserHandlersLive } from '@/http/user.handlers'
import { Auth } from '@/lib/auth'
import { LocalRouteTracingLive, localRequestMiddleware } from '@/lib/local-request-tracing'
import { ActorMiddlewareLive } from '@/middleware/actor.impl'
import { AuthMiddlewareLive } from '@/middleware/auth.impl'
import { IdentityResolverLive } from '@/middleware/optional-auth.impl'
import { prepareAuthRequest } from '@/routes/user/better-auth.routes'
import type { AppLayer } from '@/runtime/services'
import { AppLoggerLive } from '@/services/logger.service'
import { SignupProtection } from '@/services/signup-protection'

type AppServicesLive = Layer.Layer<Layer.Success<ReturnType<typeof AppLayer>>>

// better-auth owns its own routing; we can't redefine it as HttpApiEndpoints. Kept at
// its own path (not under /api) since its basePath appears in emailed links.
const betterAuthRoute = HttpRouter.add('*', '/auth/*', (request) =>
  Effect.gen(function* () {
    const path = new URL(request.url, 'http://localhost').pathname
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '')

    if (request.method === 'POST' && path === '/auth/sign-up/email') {
      const protection = yield* SignupProtection

      const result = yield* Effect.result(
        protection.authorize({
          token: request.headers['x-captcha-response'] ?? '',
          ip: request.headers['cf-connecting-ip'],
          action: 'account-signup',
        }),
      )

      if (Result.isFailure(result)) {
        return HttpServerResponse.empty({
          status: Match.value(result.failure.reason).pipe(
            Match.when('rate-limit', () => 429),
            Match.when('unavailable', () => 503),
            Match.when('verification', () => 403),
            Match.exhaustive,
          ),
        })
      }
    }

    const auth = yield* Auth
    const webRequest = yield* HttpServerRequest.toWeb(request)

    const webResponse = yield* Effect.promise(() =>
      Promise.resolve(auth.handler(prepareAuthRequest(webRequest))),
    )

    return HttpServerResponse.fromWeb(webResponse)
  }),
)

// Step 3a/3b (docs/migration-effect-http-api.md): real HttpApi groups taking
// over live traffic from the Hono fallback. Test seams accept an alternate
// database check so tests can force the failure/cache paths. `internal` has
// no production client -- it exists to validate AuthMiddleware in isolation
// before any real authed route (step 4+) depends on it.
//
// Step 8: the Hono app is gone entirely -- this function used to take a
// `honoApp: AppType` parameter to build a wildcard fallback route
// (docs/migration-effect-http-api.md's incremental-migration strategy); the
// fallback was removed once app.ts had zero remaining route mounts left to
// forward to, and the parameter itself is gone now that nothing references
// AppType anywhere in this file or its callers.
export const createWebHandler = (options: {
  readonly healthDatabaseCheck?: Effect.Effect<void, ReadinessCheckFailedError>
  readonly appServicesLive: AppServicesLive
  readonly localTracing?: boolean
}) => {
  const appServices = options.appServicesLive

  const ApiLive = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(makeHealthHandlers(options?.healthDatabaseCheck ?? checkDatabase)),
    Layer.provide(InternalHandlersLive),
    Layer.provide(MusicHandlersLive),
    Layer.provide(SearchHandlersLive),
    Layer.provide(SiteMetadataHandlersLive),
    Layer.provide(ProfileHandlersLive),
    Layer.provide(ResolveHandlersLive),
    Layer.provide(AdminHandlersLive),
    Layer.provide(InviteHandlersLive),
    Layer.provide(ListeningHandlersLive),
    Layer.provide(ReleaseHandlersLive),
    Layer.provide(Layer.mergeAll(PostHandlersLive, PersonalAccessKeyHandlersLive)),
    Layer.provide(AudioHandlersLive),
    Layer.provide(EmailHandlersLive),
    Layer.provide(
      Layer.mergeAll(
        FavoritesHandlersLive,
        MusicRemindersHandlersLive,
        NavigationHandlersLive,
        NewsletterHandlersLive,
      ),
    ),
    Layer.provide(FileManagerHandlersLive),
    Layer.provide(SpotifyHandlersLive),
    Layer.provide(ShowsHandlersLive),
    Layer.provide(Layer.mergeAll(UserHandlersLive, UploadHandlersLive)),
    // These middleware services are also yielded directly by built handlers. Keep them in the
    // layer output so toWebHandler can prove no request-time context remains.
    Layer.provideMerge(
      Layer.mergeAll(AuthMiddlewareLive, ActorMiddlewareLive, IdentityResolverLive),
    ),
  )

  const routes =
    // Global-middleware order here is load-bearing but NOT contractually
    // guaranteed by Layer.mergeAll -- each HttpRouter.middleware(fn, {global:
    // true}) registers into a shared Set via Layer.effectDiscard, and
    // mergeAll builds member layers concurrently with no documented ordering.
    // It works today only because none of these middleware bodies suspend
    // before their first yield, so Effect's scheduler happens to run them in
    // array order. Adding a real async gap to any of them, or an Effect
    // version change to mergeAll's build strategy, could silently reorder
    // this.
    Layer.mergeAll(
      ApiLive,
      betterAuthRoute,
      SearchCacheHeaderLive,
      SiteRoutesLive,
      DocsLive,
      CorsLive.pipe(Layer.provide(appServices)),
      RequestLoggerLive,
      SentryDefectLive,
    ).pipe(
      Layer.provide(options.localTracing ? LocalRouteTracingLive : Layer.empty),
      Layer.provideMerge(appServices),
      // RequestLoggerLive is the single structured request event; disable
      // Effect HttpMiddleware.logger to avoid a second response log line.
      Layer.provide(HttpRouter.disableLogger),
      Layer.provideMerge(
        Layer.mergeAll(FileSystem.layerNoop({}), Path.layer).pipe(
          Layer.provideMerge(HttpServer.layerServices),
        ),
      ),
      // Effect.logError inside health handlers must reach the app's real
      // Pino + Sentry logger, not Effect's bare default console logger --
      // otherwise a DB outage's cause is logged nowhere on-call looks.
      Layer.provideMerge(AppLoggerLive.pipe(Layer.provide(appServices))),
    )

  const web = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    ...(options.localTracing ? { middleware: localRequestMiddleware } : undefined),
  })

  const handler: typeof web.handler = async (request, ...args) => {
    const rejection = keyRequestRejection(request)

    if (rejection) return rejection

    return privateKeyResponse(request, await web.handler(request, ...args))
  }

  return { ...web, handler }
}
