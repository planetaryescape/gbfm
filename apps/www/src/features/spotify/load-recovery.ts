import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Effect, Schema } from 'effect'

export const ReloadSpotifyPage = Command.make('ReloadSpotifyPage', { args: {} }, () =>
  Effect.sync(() => location.replace(location.href)).pipe(Effect.as(Component.noop)),
)

export const SpotifyLoadRecoveryMessage = UiSchema.TaggedEnum({ ClickedReload: {} })

export const SpotifyLoadRecovery = Html.component({
  name: 'SpotifyLoadRecovery',
  props: Schema.Struct({
    interactive: Schema.Boolean,
    busy: Schema.Boolean,
  }),
  model: Schema.Null,
  message: SpotifyLoadRecoveryMessage,
}).make({
  init: () => null,
  update: ($) => ($.props.interactive && !$.props.busy ? $.run(ReloadSpotifyPage.make()) : $.model),
  view: (h) =>
    h.button
      .attr('type', 'button')
      .class('btn')
      .disabled(!h.props.interactive || h.props.busy)
      .on('click', SpotifyLoadRecoveryMessage.ClickedReload())
      .children('Reload page for Spotify'),
})
