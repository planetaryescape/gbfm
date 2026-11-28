import { Subscription } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Stream } from 'effect'

import { PerformSpotify, StartSpotifyClient } from './commands'
import { SpotifyProviderMessage, SpotifyProviderModel, SpotifyProviderProps } from './domain'

interface SpotifyProviderValue {
  readonly identity: string
  readonly interactive: boolean
  readonly revision: number
  readonly busy: boolean
  readonly target: string | null
  readonly notice: string
  readonly recovery?: 'reload'
}

const SpotifyProviderDef = Html.component({
  name: 'SpotifyProvider',
  props: SpotifyProviderProps,
  model: SpotifyProviderModel,
  message: SpotifyProviderMessage,
  restore: false,
  shares: {
    value: ({ model, props }): SpotifyProviderValue => ({
      identity: props.identity,
      interactive: model.interactive && model.identity === props.identity,
      revision: model.revision,
      busy: model.operation !== null,
      target: model.operation?.url ?? model.target,
      notice: model.operation ? 'Working…' : model.notice,
      recovery: model.operation === null ? model.recovery : undefined,
    }),
    receives: [
      'RequestedPlayback',
      'RequestedDisconnect',
      'RequestedCompleteCallback',
      'RequestedRefreshStatus',
      'ChangedConnection',
    ],
  },
})

export const updateSpotifyProvider = SpotifyProviderDef.update({
  StartedClient: ($) => $.evolve({ interactive: true }),
  ChangedIdentity: ($) =>
    $.model.identity === $.props.identity
      ? $.model
      : $.evolve({
          identity: $.props.identity,
          operation: null,
          notice: '',
          recovery: undefined,
          target: null,
          operationId: $.model.operationId + 1,
          revision: $.model.operationId + 1,
        }),
  RequestedRefreshStatus: ($) =>
    $.model.operation &&
    ['connect', 'disconnect', 'callback', 'synchronize'].includes($.model.operation.action)
      ? $.model
      : $.evolve({ revision: $.model.operationId + 1, operationId: $.model.operationId + 1 }),
  ChangedConnection: ($, { status }) => {
    const requestId = $.model.operationId + 1
    const revision = requestId

    return $.evolve({
      operation: {
        action: 'synchronize',
        url: '',
        identity: $.props.identity,
        requestId,
        revision,
      },
      operationId: requestId,
      target: null,
      notice: '',
      recovery: undefined,
    }).run(
      PerformSpotify.make({
        action: 'synchronize',
        url: '',
        identity: $.props.identity,
        requestId,
        revision,
        status,
      }),
    )
  },
  CompletedOperation: ($, message) => {
    if (
      !$.model.operation ||
      message.identity !== $.props.identity ||
      message.requestId !== $.model.operation.requestId
    )
      return $.model

    return $.evolve({
      operation: null,
      notice: message.notice,
      recovery: message.recovery,
      target: $.model.operation.url,
      revision: message.status === null ? $.model.revision : message.revision,
    })
  },
  RequestedPlayback: ($, { action, url }) => {
    if (!$.model.interactive || $.model.operation || $.model.identity !== $.props.identity)
      return $.model

    const operation = {
      action,
      url,
      identity: $.props.identity,
      requestId: $.model.operationId + 1,
      revision: action === 'connect' ? $.model.operationId + 1 : $.model.revision,
    }

    return $.evolve({
      operation,
      operationId: operation.requestId,
      notice: '',
      recovery: undefined,
    }).run(PerformSpotify.make(operation))
  },
  RequestedDisconnect: ($) => {
    if (!$.model.interactive || $.model.identity !== $.props.identity) return $.model

    const operation: NonNullable<(typeof SpotifyProviderModel.Type)['operation']> = {
      action: 'disconnect',
      url: '',
      identity: $.props.identity,
      requestId: $.model.operationId + 1,
      revision: $.model.operationId + 1,
    }

    return $.evolve({
      operation,
      operationId: operation.requestId,
      notice: '',
      recovery: undefined,
    }).run(PerformSpotify.make(operation))
  },
  RequestedCompleteCallback: ($) => {
    if ($.model.operation || $.model.identity !== $.props.identity) return $.model

    const operation: NonNullable<(typeof SpotifyProviderModel.Type)['operation']> = {
      action: 'callback',
      url: '',
      identity: $.props.identity,
      requestId: $.model.operationId + 1,
      revision: $.model.operationId + 1,
    }

    return $.evolve({
      operation,
      operationId: operation.requestId,
      notice: '',
      recovery: undefined,
    }).run(PerformSpotify.make(operation))
  },
})

export const SpotifyProvider = SpotifyProviderDef.make({
  init: ($) =>
    $.set({
      interactive: false,
      identity: $.props.identity,
      revision: 0,
      operationId: 0,
      operation: null,
      target: null,
      notice: '',
    }).run(StartSpotifyClient.make({ identity: $.props.identity, revision: 0 })),
  subscriptions: ({ props }) => [
    Subscription.make('SpotifyIdentity', props.identity, () =>
      Stream.succeed(SpotifyProviderMessage.ChangedIdentity()),
    ),
  ],
  update: updateSpotifyProvider,
})

export { SpotifyProviderMessage, SpotifyProviderMessage as SpotifyMessage } from './domain'

export { spotifyCommandsLayer } from './commands'
