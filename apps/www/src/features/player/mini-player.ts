import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { PlayerControlMessage, PlayerProviderMessage } from './domain'
import { Artwork } from './presentation'
import { PlayerProvider } from './provider'

export const MiniPlayer = Html.component({
  name: 'MiniPlayer',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const { snapshot } = h.reads.provider
    const current = snapshot.queue.current

    if (!current && snapshot.transport.isInitialized) return h.text('')
    const playing = snapshot.transport.isPlaying

    const progress =
      snapshot.transport.duration > 0
        ? Math.max(
            0,
            Math.min(100, (snapshot.transport.currentTime / snapshot.transport.duration) * 100),
          )
        : 0

    return h.section
      .attr('aria-label', 'Mini player')
      .class(`dock-platter dock-player ${current ? 'mobile-player' : 'mobile-player-pending'}`)
      .children(
        h.button
          .attr('type', 'button')
          .attr('aria-label', 'Now playing')
          .disabled(!current)
          .on('click', PlayerProviderMessage.RequestedToggleFullscreen())
          .class(
            'flex h-full min-w-0 flex-1 items-center gap-3 rounded-sm border-0 bg-transparent py-0 pl-2 pr-1 text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )
          .children(
            current
              ? Artwork(
                  h,
                  current.thumbnailUrl,
                  '',
                  96,
                  'size-10 shrink-0 rounded-none object-cover shadow-sm',
                )
              : h.span.class(
                  'size-10 shrink-0 rounded-none bg-muted bg-cover bg-center [background-image:var(--queued-art)]',
                ),
            h.span
              .class('min-w-0 flex-1 leading-tight')
              .children(
                h.span
                  .class('block truncate text-[13px] font-semibold')
                  .children(current?.title ?? 'Loading…'),
                Boolean(current?.creators?.length) &&
                  h.span
                    .class('mt-0.5 block truncate text-xs text-muted-foreground')
                    .children(current?.creators?.map(({ name }) => name).join(', ') ?? ''),
              ),
          ),
        h.button
          .attr('type', 'button')
          .attr('aria-label', playing ? 'Pause' : 'Play')
          .disabled(!current)
          .on('click', PlayerProviderMessage.RequestedTogglePlayPause())
          .class('btn btn-quiet btn-icon shrink-0 text-foreground')
          .children(lucide(h, playing ? iconPaths.pause : iconPaths.play, 'size-6 fill-current')),
        current &&
          h.div
            .attr('aria-hidden', 'true')
            .class('absolute inset-x-4 bottom-0 h-0.5 bg-foreground/10')
            .children(h.div.class('h-full bg-highlight').style({ width: `${progress}%` })),
      )
  },
})
