import { Html } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { PerformSpotify } from './commands'
import { SpotifyProviderMessage, SpotifyProviderModel, SpotifyProviderProps } from './domain'
import { updateSpotifyProvider } from './provider'

const SpotifyState = Html.component({
  name: 'SpotifyState',
  props: SpotifyProviderProps,
  model: SpotifyProviderModel,
  message: SpotifyProviderMessage,
}).make({
  init: ($) => ({
    interactive: true,
    identity: $.props.identity,
    revision: 0,
    operationId: 0,
    operation: null,
    target: null,
    notice: '',
  }),
  update: updateSpotifyProvider,
  view: (h) => h.text(''),
})

describe('native Spotify acknowledgement guards', () => {
  it('ignores unsolicited, obsolete and wrong-identity acknowledgements', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(SpotifyState, { identity: 'A' })
          const initial = s.model
          s.send(
            SpotifyProviderMessage.CompletedOperation({
              requestId: 1,
              identity: 'A',
              revision: 1,
              notice: 'unsolicited',
              status: null,
            }),
          )
          expect(s.model).toEqual(initial)
          s.send(SpotifyProviderMessage.RequestedPlayback({ action: 'play', url: 'fixture' }))
          const operation = s.model.operation!
          s.expectExact(PerformSpotify.make(operation)).keepPending(PerformSpotify.make(operation))
          s.send(
            SpotifyProviderMessage.CompletedOperation({
              requestId: operation.requestId,
              identity: 'B',
              revision: 1,
              notice: 'wrong user',
              status: null,
            }),
          )
          expect(s.model.operation).toEqual(operation)
          s.send(SpotifyProviderMessage.RequestedDisconnect())
          const disconnect = s.model.operation!
          s.expectExact(
            PerformSpotify.make(operation),
            PerformSpotify.make(disconnect),
          ).keepPending(PerformSpotify.make(disconnect))
          s.resolve(
            PerformSpotify.make(operation),
            SpotifyProviderMessage.CompletedOperation({
              requestId: operation.requestId,
              identity: 'A',
              revision: 0,
              notice: 'obsolete',
              status: null,
            }),
          )
          expect(s.model.operation).toEqual(disconnect)
          s.resolve(
            PerformSpotify.make(disconnect),
            SpotifyProviderMessage.CompletedOperation({
              requestId: disconnect.requestId,
              identity: 'A',
              revision: disconnect.revision,
              notice: 'Disconnected',
              status: { connected: false, name: '' },
            }),
          )
          expect(s.model).toMatchObject({ operation: null, notice: 'Disconnected' })
        }),
      ),
    ))

  it('preserves pending ownership for unchanged identity and refresh, but resets for a verified new identity', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(SpotifyState, { identity: 'A' })
          s.send(SpotifyProviderMessage.RequestedPlayback({ action: 'connect', url: 'fixture' }))
          const operation = s.model.operation!
          s.expectExact(PerformSpotify.make(operation)).keepPending(PerformSpotify.make(operation))
          const pending = s.model
          s.send(SpotifyProviderMessage.ChangedIdentity())
          s.send(SpotifyProviderMessage.RequestedRefreshStatus())
          expect(s.model).toEqual(pending)
          s.props({ identity: 'B' })
          s.send(SpotifyProviderMessage.ChangedIdentity())
          expect(s.model).toMatchObject({
            identity: 'B',
            operation: null,
            notice: '',
            target: null,
          })
          s.resolve(
            PerformSpotify,
            SpotifyProviderMessage.CompletedOperation({
              requestId: operation.requestId,
              identity: 'A',
              revision: operation.revision,
              notice: 'old identity',
              status: { connected: true, name: 'A' },
            }),
          )
          expect(s.model.notice).toBe('')
        }),
      ),
    ))
})
