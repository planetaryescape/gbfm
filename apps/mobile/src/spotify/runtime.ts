import { SpotifyBrowser } from '@spotify-effect/browser'
import { SpotifyConfigurationError } from '@spotify-effect/core'
import { type Context, Effect, Layer, Scope } from 'effect'

import { env } from '@/env'

import { spotifyConnectionLifecycle } from './connectionLifecycle'
import { SPOTIFY_CONFIGURATION_MESSAGE, SPOTIFY_REDIRECT_URI } from './constants'
import { installSpotifyCryptoPolyfill } from './cryptoPolyfill'
import {
  hydrateSpotifyTokensFromSecureStore,
  guardSpotifyTokenWrites,
  invalidateSpotifyTokens,
  spotifyHistoryStub,
  spotifyLocalStorage,
  spotifySessionStorage,
} from './storage'
import { installSpotifyWindowShim } from './windowShim'

const buildSpotifyContext = () => {
  installSpotifyCryptoPolyfill()
  installSpotifyWindowShim()

  const clientId = env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID

  if (!clientId?.trim()) {
    return Promise.reject(new SpotifyConfigurationError({ message: SPOTIFY_CONFIGURATION_MESSAGE }))
  }

  return buildAfterHydration(hydrateSpotifyTokensFromSecureStore, () =>
    SpotifyBrowser.layer({
      clientId,
      redirectUri: SPOTIFY_REDIRECT_URI,
      session: {
        sessionStorage: spotifySessionStorage,
        localStorage: spotifyLocalStorage,
        history: spotifyHistoryStub,
      },
    }),
  )
}

/** SpotifyBrowser.layer snapshots stored tokens when called, so it must run after hydration. */
export const buildAfterHydration = async <ROut, E>(
  hydrate: () => Promise<void>,
  makeLayer: () => Layer.Layer<ROut, E>,
) => {
  await hydrate()

  return Effect.runPromise(Layer.buildWithScope(makeLayer(), Scope.makeUnsafe()))
}

export const makeSpotifyEffectRunner = <Requirements>(
  buildContext: () => Promise<Context.Context<Requirements>>,
) => {
  let contextPromise: Promise<Context.Context<Requirements>> | null = null

  const getSpotifyContext = () => {
    if (!contextPromise) {
      contextPromise = buildContext().catch((error) => {
        contextPromise = null
        throw error
      })
    }

    return contextPromise
  }

  return <A, E>(effect: Effect.Effect<A, E, Requirements>) =>
    getSpotifyContext().then((context) => Effect.runPromiseWith(context)(effect))
}

export const runSpotifyEffect = makeSpotifyEffectRunner(buildSpotifyContext)

export const spotifyLifecycle = spotifyConnectionLifecycle(async (work, options) => {
  guardSpotifyTokenWrites(options?.isCurrent ?? (() => true))

  try {
    return await runSpotifyEffect(work)
  } finally {
    guardSpotifyTokenWrites(() => true)
  }
}, invalidateSpotifyTokens)
