import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { PlayerControlMessage, PlayerProviderMessage } from './domain'
import { FullscreenPlayer } from './fullscreen'
import { MiniPlayer } from './mini-player'
import { PlayerProvider } from './provider'
import { QueuePlayer } from './queue'

const PendingQueue = Html.component({
  name: 'PendingQueue',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const { snapshot, fullscreenOpen } = h.reads.provider

    if (fullscreenOpen || snapshot.queue.current || !snapshot.queue.tracks.length) return h.text('')

    return h.div
      .attr('aria-label', 'Audio player')
      .class(
        'fixed bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-2 rounded-sm border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur-sm lg:bottom-16',
      )
      .children(
        h.span(`${snapshot.queue.tracks.length} queued`),
        h.button
          .attr('type', 'button')
          .class('btn btn-quiet')
          .on('click', PlayerProviderMessage.RequestedPlayIndex({ index: 0 }))
          .children(lucide(h, iconPaths.play, 'h-3 w-3 fill-current'), 'Play queue'),
        h.button
          .attr('type', 'button')
          .class('btn btn-quiet')
          .attr('aria-label', 'Open queue')
          .on('click', PlayerProviderMessage.RequestedToggleQueue())
          .children(lucide(h, iconPaths.list, 'h-3.5 w-3.5')),
      )
  },
})

export const PersistentPlayer = Html.component({
  name: 'PersistentPlayer',
  props: Schema.Struct({
    renderMini: Schema.optional(Schema.Boolean),
    dockMinimized: Schema.optional(Schema.Boolean),
  }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    h.div.children(
      h
        .el('style')
        .children(
          '.native-player-dialog{margin:0;overflow:clip;color:var(--foreground)}.native-player-panel{position:fixed;inset:0}.native-player-panel[data-starting-style]{transform:translateY(100%)}.native-player-panel[data-ending-style]{transition-duration:240ms;transition-timing-function:cubic-bezier(.4,0,1,1)}',
        ),
      FullscreenPlayer(h, {}),
      QueuePlayer(h, {}),
      PendingQueue(h, {}),
      h.props.renderMini !== false &&
        h.div
          .class('mobile-dock')
          .attr('data-minimized', h.props.dockMinimized ? '' : undefined)
          .children(MiniPlayer(h, {})),
    ),
})
