import { UiSchema } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Deferred, Effect, Layer, Predicate, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { SpotifyConnection } from '../../spotify/connection'
import { runWithLayer } from '../player/testing'
import { SpotifyActions, SpotifyConnectionControls, SpotifyOnboarding } from './actions'
import { PerformSpotify, ReadSpotifyStatus } from './commands'
import { SpotifyProvider } from './provider'

const AppMessage = UiSchema.TaggedEnum({ ChangedIdentity: { identity: Schema.String } })

const App = Html.component({
  name: 'SpotifyTestApp',
  model: Schema.Struct({ identity: Schema.String }),
  message: AppMessage,
}).make({
  init: () => ({ identity: 'listener-a' }),
  update: ($, message) => $.evolve({ identity: message.identity }),
  view: (h, model) =>
    SpotifyProvider(h, {
      props: { identity: model.identity },
      view: () =>
        h.main.children(
          h.h1('Music to read'),
          SpotifyOnboarding(h, {}),
          SpotifyActions(h, {
            props: { url: 'https://open.spotify.com/track/1234567890123456789012' },
          }),
          SpotifyConnectionControls(h, {}),
        ),
    }),
})

const layers = (connection: SpotifyConnection['Service']) =>
  Layer.mergeAll(ReadSpotifyStatus.layer, PerformSpotify.layer).pipe(
    Layer.provide(Layer.succeed(SpotifyConnection, connection)),
  )

describe('native Spotify ownership', () => {
  it('server-renders the page and controls without querying browser storage, connecting, or acquiring the SDK', async () => {
    let acquired = 0

    const unavailable = Effect.sync(() => {
      acquired++
    }).pipe(Effect.andThen(Effect.die(new Error('Browser Spotify ran on the server'))))

    const result = await runWithLayer(
      layers({
        status: unavailable,
        connect: unavailable,
        disconnect: unavailable,
        completeCallback: unavailable,
        playback: () => unavailable,
      }),
      HtmlServer.renderToHtml(App, {}),
    )

    expect(result.html).toContain('Music to read')
    expect(result.html).toContain('Connect Spotify')
    expect(result.state['~deferred']).toEqual([])
    expect(acquired).toBe(0)
  })

  it('shares one status query across controls and completes actions through the actual service seam', async () => {
    let reads = 0
    const actions: Array<string> = []

    const live = layers({
      status: Effect.sync(() => {
        reads++

        return { connected: true, name: 'Fixture listener' }
      }),
      connect: Effect.void,
      disconnect: Effect.succeed({ connected: false, name: '' }),
      completeCallback: Effect.void,
      playback: ({ action, url }) =>
        Effect.sync(() => {
          actions.push(`${action}:${url}`)

          return 'Playing on your active Spotify device.'
        }),
    })

    await runWithLayer(
      Layer.merge(live, TestHost.layer()),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(App, {})
        yield* TestHost.settle
        expect(reads).toBe(1)
        expect(root.text()).toContain('Fixture listener')
        Locator.fire(root.get(Locator.text('Play on Spotify')), 'click')
        yield* TestHost.settle
        expect(actions).toEqual(['play:https://open.spotify.com/track/1234567890123456789012'])
        expect(root.text()).toContain('Playing on your active Spotify device.')
        expect(reads).toBe(1)
      }),
    )
  })

  it('ignores a previous identity completion rather than leaking its notice into the new account', async () => {
    const completed = await Effect.runPromise(Deferred.make<string>())

    const live = layers({
      status: Effect.succeed({ connected: true, name: 'Fixture listener' }),
      connect: Effect.void,
      disconnect: Effect.succeed({ connected: false, name: '' }),
      completeCallback: Effect.void,
      playback: () => Deferred.await(completed),
    })

    await runWithLayer(
      Layer.merge(live, TestHost.layer()),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(App, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.text('Play on Spotify')), 'click')
        yield* TestHost.settle
        const disconnect = root.get(Locator.text('Disconnect Spotify'))

        if (!Predicate.isTagged(disconnect, 'Element'))
          throw new Error('Expected the disconnect control')
        expect(disconnect.attrs.disabled).toBeUndefined()
        root.send(AppMessage.ChangedIdentity({ identity: 'listener-b' }))
        yield* TestHost.settle
        yield* Deferred.succeed(completed, 'Private notice from the old identity')
        yield* TestHost.settle
        expect(root.text()).not.toContain('Private notice from the old identity')
      }),
    )
  })
})
