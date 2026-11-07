import { SpotifyBrowser } from '@gbfm/spotify'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpClient } from 'effect/http'

const memoryStorage = (): Storage => {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

export const spotifyFixture = async (
  configure: (service: SpotifyBrowser['Service']) => SpotifyBrowser['Service'],
  localStorage: Storage = memoryStorage(),
) => {
  const runtime = ManagedRuntime.make(
    SpotifyBrowser.layer({
      clientId: 'fixture',
      redirectUri: 'gbfm://spotify',
      httpClientLayer: Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die(new Error('Unexpected provider request'))),
      ),
      session: {
        localStorage,
        sessionStorage: memoryStorage(),
        history: {
          length: 0,
          scrollRestoration: 'auto',
          state: null,
          back: () => {},
          forward: () => {},
          go: () => {},
          pushState: () => {},
          replaceState: () => {},
        },
      },
    }),
  )

  const service = configure(await runtime.runPromise(SpotifyBrowser))

  return {
    tokens: () => service.auth.getTokens(),
    run: <A, E>(work: Effect.Effect<A, E, SpotifyBrowser>) =>
      runtime.runPromise(work.pipe(Effect.provideService(SpotifyBrowser, service))),
    dispose: () => runtime.dispose(),
  }
}
