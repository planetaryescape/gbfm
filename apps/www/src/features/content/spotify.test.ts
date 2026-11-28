import { UiSchema } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { Deferred, Effect, Layer, Predicate, Schema } from 'effect'

import { SpotifyConnection } from '../../spotify/connection'
import { runWithLayer } from '../player/testing'
import { PerformSpotify, ReadSpotifyStatus } from '../spotify/commands'
import { SpotifyProvider } from '../spotify/provider'
import { SpotlightSpotify } from './spotify'

const identity = 'listener'

const album = 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy'

const nextAlbum = 'https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX'

const lastAlbum = 'https://open.spotify.com/album/6PW3yWJxFLjST7iwylj8Fs'

const AppMessage = UiSchema.TaggedEnum({
  Navigated: {},
  ChangedIdentity: { identity: Schema.String },
})

const App = Html.component({
  name: 'SpotlightSpotifyTestApp',
  props: Schema.Struct({ url: Schema.String, onboarding: Schema.Boolean }),
  model: Schema.Struct({ identity: Schema.String, next: Schema.Boolean }),
  message: AppMessage,
}).make({
  init: () => ({ identity, next: false }),
  update: {
    Navigated: ($) => $.evolve({ next: true }),
    ChangedIdentity: ($, message) => $.evolve({ identity: message.identity }),
  },
  view: (h, model) =>
    SpotifyProvider(h, {
      props: { identity: model.identity },
      view: () =>
        h.main.children(
          h.h1.children(model.next ? 'Next editorial' : 'Current editorial'),
          h.props.onboarding
            ? SpotlightSpotify(h, {
                key: 'onboarding',
                props: { identity: model.identity, url: 'spotify:onboarding', onboarding: true },
              })
            : [
                h.section.attr('data-record', 'first').children(
                  SpotlightSpotify(h, {
                    key: `${model.next}:first`,
                    props: {
                      identity: model.identity,
                      url: model.next ? nextAlbum : h.props.url,
                      onboarding: false,
                    },
                  }),
                ),
                h.section.attr('data-record', 'second').children(
                  SpotlightSpotify(h, {
                    key: `${model.next}:second`,
                    props: {
                      identity: model.identity,
                      url: model.next ? lastAlbum : nextAlbum,
                      onboarding: false,
                    },
                  }),
                ),
              ],
        ),
    }),
})

const layers = (connection: SpotifyConnection['Service']) =>
  Layer.mergeAll(ReadSpotifyStatus.layer, PerformSpotify.layer).pipe(
    Layer.provide(Layer.succeed(SpotifyConnection, connection)),
  )

const button = (record: string, name: string) =>
  Locator.inside(Locator.attr('data-record', record), HtmlLocator.role('button', { name }))

it('offers optional Spotify onboarding and refreshes the shared connection after consent', async () => {
  let connected = false
  let reads = 0
  let connections = 0

  const live = layers({
    status: Effect.sync(() => {
      reads++

      return { connected, name: connected ? 'Listener' : '' }
    }),
    connect: Effect.sync(() => {
      connected = true
      connections++
    }),
    disconnect: Effect.succeed({ connected: false, name: '' }),
    completeCallback: Effect.void,
    playback: () => Effect.succeed(''),
  })

  await runWithLayer(
    Layer.merge(live, TestHost.layer()),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(App, { url: album, onboarding: true })
      yield* TestHost.settle
      assert.include(root.text(), 'Listen as you read')
      Locator.fire(root.get(HtmlLocator.role('button', { name: 'Connect Spotify' })), 'click')
      yield* TestHost.settle
      assert.strictEqual(connections, 1)
      assert.strictEqual(reads, 2)
      assert.include(root.text(), 'Spotify connected')
      assert.include(root.text(), 'Listening as Listener.')
      assert.isUndefined(root.query(HtmlLocator.role('button', { name: 'Connect Spotify' })))
      assert.isDefined(root.entry(ReadSpotifyStatus, { identity, revision: 1 }))
    }),
  )
})

it('plays, queues and saves through the shared provider with URL-scoped notices', async () => {
  const actions: Array<string> = []

  const live = layers({
    status: Effect.succeed({ connected: true, name: 'Listener' }),
    connect: Effect.void,
    disconnect: Effect.succeed({ connected: false, name: '' }),
    completeCallback: Effect.void,
    playback: ({ action, url }) =>
      Effect.sync(() => {
        actions.push(`${action}:${url}`)

        return `${action} completed`
      }),
  })

  await runWithLayer(
    Layer.merge(live, TestHost.layer()),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(App, { url: album, onboarding: false })
      yield* TestHost.settle

      for (const [name, action] of [
        ['Play', 'play'],
        ['Queue', 'queue'],
        ['Save', 'save'],
      ]) {
        Locator.fire(root.get(button('first', name)), 'click')
        yield* TestHost.settle
        assert.include(root.text(), `${action} completed`)
        assert.isDefined(
          root.query(
            Locator.inside(Locator.attr('data-record', 'first'), HtmlLocator.role('status')),
          ),
        )
        assert.isUndefined(
          root.query(
            Locator.inside(Locator.attr('data-record', 'second'), HtmlLocator.role('status')),
          ),
        )
      }

      assert.deepStrictEqual(actions, [`play:${album}`, `queue:${album}`, `save:${album}`])
    }),
  )
})

it('does not offer the unsupported save action for playlists', async () => {
  const live = layers({
    status: Effect.succeed({ connected: true, name: 'Listener' }),
    connect: Effect.void,
    disconnect: Effect.succeed({ connected: false, name: '' }),
    completeCallback: Effect.void,
    playback: () => Effect.succeed(''),
  })

  await runWithLayer(
    Layer.merge(live, TestHost.layer()),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(App, {
        url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
        onboarding: false,
      })

      yield* TestHost.settle
      assert.isDefined(root.query(button('first', 'Play')))
      assert.isDefined(root.query(button('first', 'Queue')))
      assert.isUndefined(root.query(button('first', 'Save')))
      assert.deepStrictEqual(root.pending(), [])
    }),
  )
})

it('shares one busy operation and one status query across cards and route remounts', async () => {
  const completion = await Effect.runPromise(Deferred.make<string>())
  let reads = 0
  const actions: Array<string> = []

  const live = layers({
    status: Effect.sync(() => {
      reads++

      return { connected: true, name: 'Listener' }
    }),
    connect: Effect.void,
    disconnect: Effect.succeed({ connected: false, name: '' }),
    completeCallback: Effect.void,
    playback: ({ action, url }) =>
      Effect.sync(() => actions.push(`${action}:${url}`)).pipe(
        Effect.andThen(Deferred.await(completion)),
      ),
  })

  await runWithLayer(
    Layer.merge(live, TestHost.layer()),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(App, { url: album, onboarding: false })
      yield* TestHost.settle
      assert.strictEqual(reads, 1)
      Locator.fire(root.get(button('first', 'Play')), 'click')
      Locator.fire(root.get(button('second', 'Play')), 'click')
      yield* TestHost.settle
      root.send(AppMessage.Navigated())
      yield* TestHost.settle
      assert.include(root.text(), 'Next editorial')

      for (const record of ['first', 'second']) {
        const control = root.get(button(record, 'Queue'))

        if (!Predicate.isTagged(control, 'Element')) throw new Error('Expected a Spotify button')
        assert.strictEqual(control.attrs.disabled, '')
      }

      assert.strictEqual(reads, 1)
      assert.deepStrictEqual(actions, [`play:${album}`])
      yield* Deferred.succeed(completion, 'Old record completed')
      yield* TestHost.settle
      assert.notInclude(root.text(), 'Old record completed')
      const queue = root.get(button('first', 'Queue'))

      if (!Predicate.isTagged(queue, 'Element')) throw new Error('Expected a Spotify button')
      assert.isUndefined(queue.attrs.disabled)
      Locator.fire(queue, 'click')
      yield* TestHost.settle
      assert.deepStrictEqual(actions, [`play:${album}`, `queue:${nextAlbum}`])
    }),
  )
})

it('keeps no-JavaScript onboarding readable without acquiring browser Spotify services', async () => {
  let acquired = 0

  const unavailable = Effect.sync(() => {
    acquired++
  }).pipe(Effect.andThen(Effect.die(new Error('Browser Spotify ran during SSR'))))

  const live = layers({
    status: unavailable,
    connect: unavailable,
    disconnect: unavailable,
    completeCallback: unavailable,
    playback: () => unavailable,
  })

  const rendered = await runWithLayer(
    live,
    HtmlServer.renderToHtml(App, {
      url: album,
      onboarding: true,
    }),
  )

  assert.include(rendered.html, 'Current editorial')
  assert.include(rendered.html, 'Listen as you read')
  assert.include(rendered.html, 'Connect Spotify')
  assert.strictEqual(acquired, 0)
})
