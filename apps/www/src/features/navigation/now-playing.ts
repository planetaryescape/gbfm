import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { iconPaths, pixelIcon, pixelPlayPath } from '../../ui/icons'
import { PlayerControlMessage, PlayerProviderMessage } from '../player/domain'
import { PlayerProvider } from '../player/provider'

export const DesktopNowPlaying = Html.component({
  name: 'NavigationNowPlaying',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { player: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const { snapshot } = h.reads.player
    const current = snapshot.queue.current

    if (!current) return h.text('')
    const playing = snapshot.transport.isPlaying

    const progress =
      snapshot.transport.duration > 0
        ? Math.max(
            0,
            Math.min(100, (snapshot.transport.currentTime / snapshot.transport.duration) * 100),
          )
        : 0

    return h.div.class('contents').children(
      h.div
        .class('absolute inset-x-0 top-0 h-[3px] bg-border/60')
        .attr('aria-hidden', 'true')
        .children(
          h.div
            .class(
              'h-full bg-highlight shadow-[0_0_6px_var(--highlight)] transition-[width] duration-300 ease-linear',
            )
            .style({ width: `${progress}%` }),
        ),
      h.div
        .class('flex min-w-0 max-w-56 shrink items-center gap-2 border-r border-border pr-3')
        .children(
          h.button
            .attr('type', 'button')
            .attr('aria-label', playing ? 'Pause' : 'Play')
            .on('click', PlayerProviderMessage.RequestedTogglePlayPause())
            .class(
              'flex size-11 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-foreground hover:text-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )
            .children(pixelIcon(h, playing ? iconPaths.pause : pixelPlayPath, 'size-6', true)),
          h.button
            .attr('type', 'button')
            .attr('aria-label', `Now playing: ${current.title}`)
            .on('click', PlayerProviderMessage.RequestedToggleFullscreen())
            .class(
              'min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )
            .children(current.title),
        ),
    )
  },
})
