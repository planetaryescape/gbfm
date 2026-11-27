import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { PlayerControlMessage, PlayerProviderMessage } from '../../src/features/player/domain'
import { PlayerProvider } from '../../src/features/player/provider'
import { Scrubber } from '../../src/features/player/scrubber'

const HomeTouchControls = Html.component({
  name: 'HomeTouchControls',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const { snapshot, seekPreview, fullscreenOpen } = h.reads.provider

    return h.main.children(
      h.button
        .on('click', PlayerProviderMessage.RequestedToggleFullscreen())
        .children('Open scrubber'),
      h.output
        .attr('aria-label', 'Provider transport')
        .children(String(snapshot.transport.currentTime)),
      Scrubber(h, {
        currentTime: seekPreview?.seconds ?? snapshot.transport.currentTime,
        duration: snapshot.transport.duration,
        trackId: snapshot.queue.current?.id ?? 'loading',
        preview: seekPreview,
        isOpen: fullscreenOpen,
      }),
    )
  },
})

export const HomeTouchApp = Html.component({
  name: 'HomeTouchApp',
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    PlayerProvider(h, {
      key: 'synthetic-player',
      props: { principalId: null, principalKnown: true, returnTo: '/mixes' },
      view: () => HomeTouchControls(h, {}),
    }),
})
