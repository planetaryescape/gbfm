import { BrowserRouter, HtmlHydrate } from '@effect/ui/html'
import { Effect, Fiber, Function, Layer, Schema } from 'effect'

import './styles/main.css'
import { BootstrapJson } from './app/bootstrap'
import { makeBrowserSupportLayer } from './app/browser-runtime'
import { CredentialApplication, readCredentialProps } from './app/credential-application'
import { siteHttpClientLayer } from './app/http-client'
import { HydrationState, jsonScript } from './app/hydration'
import { browserPageLayer } from './app/page-query'
import { AppRoute, PatchPageSearch } from './app/route'
import { RoutedApplication } from './app/routed-application'
import { nativePlayerClientLayer } from './features/player/provider'
import {
  makeSpotifyCallbackProps,
  SpotifyCallbackApplication,
  spotifyCallbackLayer,
} from './features/spotify/callback-application'

const container = document.getElementById('root')

if (!container) throw new Error('Missing application root')

const bootstrap = Schema.decodeUnknownSync(Schema.fromJsonString(BootstrapJson))(
  jsonScript(document, 'gbfm-ui-props'),
)

const state = Schema.decodeUnknownSync(Schema.fromJsonString(HydrationState))(
  jsonScript(document, 'gbfm-ui-state'),
)

const markHydrated = Effect.sync(() => {
  document.documentElement.dataset.gbfmHydrated = 'true'
})

const applicationLayer = () => {
  switch (bootstrap.kind) {
    case 'credential':
      return Layer.effectDiscard(
        Effect.gen(function* () {
          const root = yield* HtmlHydrate.hydrateEffect(
            CredentialApplication,
            readCredentialProps(bootstrap, document),
            container,
            state,
          )

          yield* root.adopted
        }).pipe(Effect.tap(markHydrated)),
      )
    case 'spotify-callback':
      return Layer.effectDiscard(
        Effect.gen(function* () {
          const root = yield* HtmlHydrate.hydrateEffect(
            SpotifyCallbackApplication,
            makeSpotifyCallbackProps(bootstrap),
            container,
            state,
          )

          yield* root.adopted
        }).pipe(Effect.tap(markHydrated)),
      ).pipe(Layer.provide(spotifyCallbackLayer))
    case 'routed': {
      const router = BrowserRouter.layer({ routes: AppRoute })

      return Layer.effectDiscard(
        Effect.gen(function* () {
          const root = yield* HtmlHydrate.hydrateEffect(
            RoutedApplication,
            bootstrap,
            container,
            state,
          )

          yield* root.adopted
        }).pipe(Effect.tap(markHydrated)),
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            router,
            PatchPageSearch.layer.pipe(Layer.provide(router)),
            browserPageLayer(bootstrap.url, bootstrap.realm),
            siteHttpClientLayer(bootstrap.url),
            nativePlayerClientLayer,
          ),
        ),
      )
    }

    default:
      return Function.absurd<never>(bootstrap)
  }
}

const application = applicationLayer().pipe(
  Layer.provide(
    makeBrowserSupportLayer({
      release: import.meta.env.PROD ? import.meta.env.GBFM_BUILD_ID : 'local',
    }),
  ),
)

const fiber = Effect.runFork(Layer.launch(application))

const dispose = () => {
  window.removeEventListener('pagehide', onPageHide)
  Effect.runFork(Fiber.interrupt(fiber))
}

const onPageHide = (event: PageTransitionEvent) => {
  if (!event.persisted) dispose()
}

window.addEventListener('pagehide', onPageHide)

import.meta.hot?.dispose(dispose)
