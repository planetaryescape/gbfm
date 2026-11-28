import { Command } from '@effect/ui'
import { Html, HtmlSubscription } from '@effect/ui/html'
import { Effect, Schema } from 'effect'

import { SpotifyCallback, SpotifyConnectionControls } from '../spotify/actions'
import { SpotifyControlMessage } from '../spotify/domain'
import { SpotifyMessage, SpotifyProvider } from '../spotify/provider'

export const RefreshSpotifyStatus = Command.make('RefreshSpotifyStatus', { args: {} }, () =>
  Effect.succeed(SpotifyMessage.RequestedRefreshStatus()),
)

export const DashboardIntegrationsNoDeps = Html.component({
  name: 'DashboardIntegrations',
  props: Schema.Struct({ callback: Schema.Boolean }),
  model: Schema.Null,
  message: SpotifyControlMessage,
  reads: { provider: SpotifyProvider },
}).make({
  init: ($) => $.set(null).run(...($.props.callback ? [] : [RefreshSpotifyStatus.make()])),
  subscriptions: ({ props }) =>
    props.callback
      ? []
      : [HtmlSubscription.onWindow('focus', SpotifyMessage.RequestedRefreshStatus())],
  update: ($, message) => $.send(SpotifyProvider, message),
  view: (h) =>
    h.section
      .class('dashboard-panel')
      .children(h.props.callback ? SpotifyCallback(h, {}) : SpotifyConnectionControls(h, {})),
})

export const DashboardIntegrations = DashboardIntegrationsNoDeps
