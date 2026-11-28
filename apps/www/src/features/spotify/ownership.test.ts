import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Deferred, Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  disconnected,
  SpotifyConnection,
  SpotifyConnectionError,
  type SpotifyStatus,
} from '../../spotify/connection'
import { runWithLayer } from '../player/testing'
import { SpotifyConnectionControls } from './actions'
import { PerformSpotify, ReadSpotifyStatus } from './commands'
import { SpotifyControlMessage, SpotifyProviderMessage } from './domain'
import { SpotifyProvider } from './provider'

const track = 'https://open.spotify.com/track/1234567890123456789012'

const newStatus = { connected: true, name: 'New session' }

const OwnershipProbe = Html.component({
  name: 'SpotifyOwnershipProbe',
  model: Schema.Null,
  message: SpotifyControlMessage,
  reads: { provider: SpotifyProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(SpotifyProvider, message),
  view: (h) =>
    h.div.children(
      h.button
        .attr('aria-label', 'play')
        .on('click', SpotifyProviderMessage.RequestedPlayback({ action: 'play', url: track })),
      h.button
        .attr('aria-label', 'queue')
        .on('click', SpotifyProviderMessage.RequestedPlayback({ action: 'queue', url: track })),
      h.button
        .attr('aria-label', 'connect')
        .on('click', SpotifyProviderMessage.RequestedPlayback({ action: 'connect', url: track })),
      h.button
        .attr('aria-label', 'disconnect')
        .on('click', SpotifyProviderMessage.RequestedDisconnect()),
      h.button
        .attr('aria-label', 'callback')
        .on('click', SpotifyProviderMessage.RequestedCompleteCallback()),
      h.button
        .attr('aria-label', 'refresh')
        .on('click', SpotifyProviderMessage.RequestedRefreshStatus()),
      h.button
        .attr('aria-label', 'connection change')
        .on('click', SpotifyProviderMessage.ChangedConnection({ status: newStatus })),
      h.output.attr('data-testid', 'spotify-owner').children(JSON.stringify(h.reads.provider)),
    ),
})

const OwnershipApp = Html.component({
  name: 'SpotifyOwnershipApp',
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotifyProvider(h, {
      key: 'persistent',
      props: { identity: 'fixture' },
      view: () => h.main.children(OwnershipProbe(h, {}), SpotifyConnectionControls(h, {})),
    }),
})

const service = (
  overrides: Partial<SpotifyConnection['Service']> = {},
): SpotifyConnection['Service'] => ({
  status: Effect.succeed(disconnected),
  connect: Effect.void,
  disconnect: Effect.succeed(disconnected),
  completeCallback: Effect.void,
  playback: () => Effect.succeed('fixture completed'),
  ...overrides,
})

const layers = (connection: SpotifyConnection['Service']) =>
  Layer.merge(
    TestHost.layer(),
    Layer.merge(ReadSpotifyStatus.layer, PerformSpotify.layer).pipe(
      Layer.provide(Layer.succeed(SpotifyConnection, connection)),
    ),
  )

const OwnerState = Schema.Struct({
  busy: Schema.Boolean,
  revision: Schema.Number,
  notice: Schema.String,
  target: Schema.NullOr(Schema.String),
})

describe('native Spotify legacy ownership parity', () => {
  it.each(['play', 'queue', 'connect'])(
    'serializes repeated %s actions and retains their target after completion',
    async (action) => {
      const gate = Deferred.makeUnsafe<string>()
      const calls: Array<string> = []

      const connection = service({
        connect: Effect.sync(() => {
          calls.push('connect')
        }).pipe(Effect.andThen(Deferred.await(gate)), Effect.asVoid),
        playback: ({ action }) =>
          Effect.sync(() => {
            calls.push(action)
          }).pipe(Effect.andThen(Deferred.await(gate))),
      })

      await runWithLayer(
        layers(connection),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(OwnershipApp, {})
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', action)), 'click')
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', 'queue')), 'click')
          yield* TestHost.settle
          expect(calls).toEqual([action])
          yield* Deferred.succeed(gate, 'fixture completed')
          yield* TestHost.settle

          const state = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OwnerState))(
            Locator.textOf(root.get(Locator.attr('data-testid', 'spotify-owner'))),
          )

          expect(state).toMatchObject({
            busy: false,
            target: track,
            notice: action === 'connect' ? '' : 'fixture completed',
          })
          Locator.fire(root.get(Locator.attr('aria-label', action)), 'click')
          yield* TestHost.settle
          expect(calls).toEqual([action, action])
        }),
      )
    },
  )

  it('releases connect ownership on error, keeps disconnected status, and allows another connect', async () => {
    let calls = 0
    await runWithLayer(
      layers(
        service({
          connect: Effect.sync(() => {
            calls++
          }).pipe(
            Effect.andThen(
              Effect.fail(new SpotifyConnectionError({ message: 'fixture login failed' })),
            ),
          ),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'connect')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain('fixture login failed')
        expect(root.text()).toContain('"busy":false')
        expect(root.text()).toContain('Connect Spotify')
        Locator.fire(root.get(Locator.attr('aria-label', 'connect')), 'click')
        yield* TestHost.settle
        expect(calls).toBe(2)
      }),
    )
  })

  it('retains partial queue failure notices and allows the next operation', async () => {
    const notice = 'Queue actions may have partially completed.'
    await runWithLayer(
      layers(
        service({
          playback: ({ action }) =>
            action === 'queue'
              ? Effect.fail(new SpotifyConnectionError({ message: notice }))
              : Effect.succeed('next operation'),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'queue')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain(notice)
        expect(root.text()).toContain('"busy":false')
        Locator.fire(root.get(Locator.attr('aria-label', 'play')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain('next operation')
      }),
    )
  })

  it('preserves the disconnected fallback when a status refresh fails', async () => {
    await runWithLayer(
      layers(
        service({
          status: Effect.fail(new SpotifyConnectionError({ message: 'fixture offline' })),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        expect(root.text()).toContain('Connect Spotify')
        expect(root.text()).not.toContain('Connected as')
        expect(root.text()).toContain('"busy":false')
      }),
    )
  })

  it('does not release accepted playback ownership when an ordinary refresh reports disconnected', async () => {
    const gate = Deferred.makeUnsafe<string>()
    let status = { connected: true, name: 'Fixture' }
    let calls = 0
    await runWithLayer(
      layers(
        service({
          status: Effect.sync(() => status),
          playback: () =>
            Effect.sync(() => {
              calls++
            }).pipe(Effect.andThen(Deferred.await(gate))),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'play')), 'click')
        yield* TestHost.settle
        status = disconnected
        Locator.fire(root.get(Locator.attr('aria-label', 'refresh')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain('"busy":true')
        Locator.fire(root.get(Locator.attr('aria-label', 'queue')), 'click')
        yield* TestHost.settle
        expect(calls).toBe(1)
        yield* Deferred.succeed(gate, 'late completion')
        yield* TestHost.settle
        expect(root.text()).toContain('late completion')
        expect(root.text()).not.toContain('Connected as')
      }),
    )
  })

  it('lets disconnect supersede accepted playback and ignores its stale acknowledgement', async () => {
    const gate = Deferred.makeUnsafe<string>()
    let finished = 0
    await runWithLayer(
      layers(
        service({
          status: Effect.succeed({ connected: true, name: 'Fixture' }),
          playback: () =>
            Deferred.await(gate).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  finished++
                }),
              ),
            ),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'play')), 'click')
        yield* TestHost.settle
        Locator.fire(root.get(Locator.text('Disconnect Spotify')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain('Disconnected from Spotify.')
        expect(root.text()).toContain('"busy":false')
        expect(root.text()).not.toContain('Connected as')
        yield* Deferred.succeed(gate, 'old provider accepted')
        yield* TestHost.settle
        expect(finished).toBe(1)
        expect(root.text()).not.toContain('old provider accepted')
        expect(root.text()).not.toContain('Connected as')
      }),
    )
  })

  it('releases a failed superseding disconnect and does not accept the old completion', async () => {
    const gate = Deferred.makeUnsafe<string>()
    await runWithLayer(
      layers(
        service({
          playback: () => Deferred.await(gate),
          disconnect: Effect.fail(new SpotifyConnectionError({ message: 'Disconnect failed' })),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'play')), 'click')
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'disconnect')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain('Disconnect failed')
        expect(root.text()).toContain('"busy":false')
        yield* Deferred.succeed(gate, 'obsolete success')
        yield* TestHost.settle
        expect(root.text()).not.toContain('obsolete success')
        expect(root.text()).toContain('Disconnect failed')
      }),
    )
  })

  it.each(['success', 'failure'])(
    'fences a real delayed status %s after disconnect',
    async (outcome) => {
      const gate = Deferred.makeUnsafe<typeof SpotifyStatus.Type, SpotifyConnectionError>()
      await runWithLayer(
        layers(service({ status: Deferred.await(gate) })),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(OwnershipApp, {})
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', 'disconnect')), 'click')
          yield* TestHost.settle
          expect(root.text()).toContain('Disconnected from Spotify.')

          if (outcome === 'success')
            yield* Deferred.succeed(gate, { connected: true, name: 'Old account' })
          else yield* Deferred.fail(gate, new SpotifyConnectionError({ message: 'Old failure' }))
          yield* TestHost.settle
          expect(root.text()).not.toContain('Old account')
          expect(root.text()).not.toContain('Old failure')
          expect(root.text()).not.toContain('Connected as')
          expect(root.text()).toContain('"busy":false')
        }),
      )
    },
  )

  it('allocates a fresh refresh generation and rejects an obsolete read', async () => {
    const gate = Deferred.makeUnsafe<typeof SpotifyStatus.Type>()
    let reads = 0
    await runWithLayer(
      layers(
        service({
          status: Effect.suspend(() =>
            ++reads === 1 ? Deferred.await(gate) : Effect.succeed(disconnected),
          ),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'refresh')), 'click')
        yield* TestHost.settle
        expect(reads).toBe(2)
        expect(root.text()).toContain('"revision":1')
        yield* Deferred.succeed(gate, { connected: true, name: 'Obsolete load' })
        yield* TestHost.settle
        expect(root.text()).not.toContain('Obsolete load')
        expect(root.text()).not.toContain('Connected as')
      }),
    )
  })

  it('accepts a same-identity connection change, lets old provider work finish, and fences its completion', async () => {
    const gate = Deferred.makeUnsafe<string>()
    let finished = 0
    await runWithLayer(
      layers(
        service({
          status: Effect.succeed({ connected: true, name: 'Previous session' }),
          playback: ({ action }) =>
            action === 'play'
              ? Deferred.await(gate).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      finished++
                    }),
                  ),
                )
              : Effect.succeed('new queue completed'),
        }),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(OwnershipApp, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'play')), 'click')
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'connection change')), 'click')
        yield* TestHost.settle
        expect(root.text()).toContain('Connected as New session')
        Locator.fire(root.get(Locator.attr('aria-label', 'queue')), 'click')
        yield* TestHost.settle
        yield* Deferred.succeed(gate, 'old provider accepted')
        yield* TestHost.settle
        expect(finished).toBe(1)
        expect(root.text()).toContain('new queue completed')
        expect(root.text()).not.toContain('old provider accepted')
        expect(root.text()).toContain('Connected as New session')
      }),
    )
  })

  it.each(['connect', 'callback'])(
    'reads and shares the actual connected status after %s',
    async (action) => {
      let connected = false
      await runWithLayer(
        layers(
          service({
            status: Effect.sync(() => (connected ? newStatus : disconnected)),
            connect: Effect.sync(() => {
              connected = true
            }),
            completeCallback: Effect.sync(() => {
              connected = true
            }),
          }),
        ),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(OwnershipApp, {})
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', action)), 'click')
          yield* TestHost.settle
          expect(root.text()).toContain('Connected as New session')
          expect(root.text()).toContain('"busy":false')
        }),
      )
    },
  )
})
