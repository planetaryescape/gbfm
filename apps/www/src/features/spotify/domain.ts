import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { SpotifyStatus } from '../../spotify/connection'

export const SpotifyAction = Schema.Literals(['connect', 'play', 'queue', 'save'])

export const SpotifyProviderProps = Schema.Struct({ identity: Schema.String })

export const SpotifyProviderModel = Schema.Struct({
  interactive: Schema.Boolean,
  identity: Schema.String,
  revision: Schema.Number,
  operationId: Schema.Number,
  operation: Schema.NullOr(
    Schema.Struct({
      action: Schema.Literals([
        'connect',
        'play',
        'queue',
        'save',
        'disconnect',
        'callback',
        'synchronize',
      ]),
      url: Schema.String,
      requestId: Schema.Number,
      identity: Schema.String,
      revision: Schema.Number,
    }),
  ),
  target: Schema.NullOr(Schema.String),
  notice: Schema.String,
  recovery: Schema.optional(Schema.Literal('reload')),
})

export const SpotifyProviderMessage = UiSchema.TaggedEnum({
  StartedClient: {},
  ChangedIdentity: {},
  RequestedPlayback: { action: SpotifyAction, url: Schema.String },
  RequestedDisconnect: {},
  RequestedCompleteCallback: {},
  RequestedRefreshStatus: {},
  ChangedConnection: { status: SpotifyStatus },
  CompletedOperation: {
    requestId: Schema.Number,
    identity: Schema.String,
    notice: Schema.String,
    revision: Schema.Number,
    status: Schema.NullOr(SpotifyStatus),
    recovery: Schema.optional(Schema.Literal('reload')),
  },
})

export type SpotifyProviderMessage = typeof SpotifyProviderMessage.Type

export const SpotifyControlMessage = Schema.Union([
  SpotifyProviderMessage.cases.RequestedPlayback,
  SpotifyProviderMessage.cases.RequestedDisconnect,
  SpotifyProviderMessage.cases.RequestedCompleteCallback,
  SpotifyProviderMessage.cases.RequestedRefreshStatus,
  SpotifyProviderMessage.cases.ChangedConnection,
])
