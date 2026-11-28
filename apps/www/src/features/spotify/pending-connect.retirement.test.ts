import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Deferred, Effect, Layer, Schema } from 'effect'
import { expect, it } from 'vitest'

import { disconnected, SpotifyConnection } from '../../spotify/connection'
import { runWithLayer } from '../player/testing'
import { SpotifyConnectionControls } from './actions'
import { PerformSpotify, ReadSpotifyStatus } from './commands'
import { SpotifyControlMessage, SpotifyProviderMessage } from './domain'
import { SpotifyProvider } from './provider'

const Probe = Html.component({
  name: 'DashboardSpotifyPendingProbe',
  model: Schema.Null,
  message: SpotifyControlMessage,
  reads: { provider: SpotifyProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(SpotifyProvider, message),
  view: (h) =>
    h.div.children(
      h.button
        .attr('aria-label', 'duplicate Connect')
        .on('click', SpotifyProviderMessage.RequestedPlayback({ action: 'connect', url: '' })),
      h.button
        .attr('aria-label', 'status during Connect')
        .on('click', SpotifyProviderMessage.RequestedRefreshStatus()),
      h.button
        .attr('aria-label', 'callback during Connect')
        .on('click', SpotifyProviderMessage.RequestedCompleteCallback()),
      h.output.attr('data-owner-state', '').children(JSON.stringify(h.reads.provider)),
    ),
})

const App = Html.component({
  name: 'DashboardSpotifyPendingFixture',
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotifyProvider(h, {
      key: 'owner',
      props: { identity: 'fixture' },
      view: () => h.main.children(Probe(h, {}), SpotifyConnectionControls(h, {})),
    }),
})

it('pending Connect explicitly blocks duplicate Connect, status and callback, but admits disconnect', async () => {
  const connect = Deferred.makeUnsafe<void>()
  let connects = 0
  let callbacks = 0
  let statuses = 0
  let disconnects = 0

  const connection = Layer.succeed(SpotifyConnection, {
    status: Effect.sync(() => {
      statuses++

      return disconnected
    }),
    connect: Effect.sync(() => {
      connects++
    }).pipe(Effect.andThen(Deferred.await(connect))),
    completeCallback: Effect.sync(() => {
      callbacks++
    }),
    disconnect: Effect.sync(() => {
      disconnects++

      return disconnected
    }),
    playback: () => Effect.succeed('unused'),
  })

  await runWithLayer(
    Layer.merge(
      TestHost.layer(),
      Layer.merge(ReadSpotifyStatus.layer, PerformSpotify.layer).pipe(Layer.provide(connection)),
    ),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(App, {})
      yield* TestHost.settle
      expect(statuses).toBe(1)
      Locator.fire(root.get(Locator.text('Connect Spotify', { exact: true })), 'click')
      yield* TestHost.settle
      expect(connects).toBe(1)
      const pending = root.text()
      expect(pending).toContain('"busy":true')

      for (const label of [
        'duplicate Connect',
        'status during Connect',
        'callback during Connect',
      ]) {
        Locator.fire(root.get(Locator.attr('aria-label', label)), 'click')
        yield* TestHost.settle
        expect(connects).toBe(1)
        expect(statuses).toBe(1)
        expect(callbacks).toBe(0)
        expect(disconnects).toBe(0)
        expect(root.text()).toBe(pending)
      }

      Locator.fire(root.get(Locator.text('Disconnect Spotify', { exact: true })), 'click')
      yield* TestHost.settle
      expect(disconnects).toBe(1)
      expect(root.text()).toContain('Disconnected from Spotify.')
      expect(root.text()).toContain('"busy":false')
      yield* Deferred.succeed(connect, undefined)
      yield* TestHost.settle
      expect(root.text()).not.toContain('Connected as')
      expect(root.text()).toContain('Disconnected from Spotify.')
    }),
  )
})
