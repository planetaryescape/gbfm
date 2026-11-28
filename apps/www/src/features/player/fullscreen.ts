import { Dialog } from '@effect/ui-kit'
import { Html } from '@effect/ui/html'
import type { QueueTrackType } from '@gbfm/player'
import { Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { PlaybackControls } from './controls'
import { PlayerControlMessage, PlayerProviderMessage } from './domain'
import { PlayerFavorite } from './favorite-control'
import { TrackPlayerDrag } from './gestures'
import { Artwork, ghostButton, volumeRangeClass } from './presentation'
import { PlayerProvider } from './provider'
import { Scrubber } from './scrubber'

const CreatorLinks = (h: Html.H<PlayerControlMessage>, track: QueueTrackType) => {
  const creators = track.creators ?? []

  if (!creators.length) return h.span('Unknown creator')

  return h.p.class('mt-1 truncate text-base text-muted-foreground').children(
    creators.flatMap((creator, index) => [
      creator.username
        ? h.a
            .key(creator.id)
            .attr('href', `/profile/${encodeURIComponent(creator.username)}`)
            .class('no-underline hover:text-foreground hover:underline')
            .children(creator.name)
        : h.span.key(creator.id).children(creator.name),
      index < creators.length - 1 ? ', ' : '',
    ]),
  )
}

export const FullscreenPlayer = Html.component({
  name: 'FullscreenPlayer',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const model = h.reads.provider
    const { snapshot, fullscreenOpen, playerOffset, playerDrag, seekPreview } = model
    const current = snapshot.queue.current
    const { transport, volume, queue } = snapshot
    const muted = volume.isMuted || volume.volume === 0

    return Dialog(h, {
      props: { open: fullscreenOpen, keepMounted: true, id: 'fullscreen-player' },
      onEmit: {
        RequestedOpen: () => undefined,
        RequestedClose: () => PlayerProviderMessage.RequestedCloseFullscreen(),
        Settled: ({ open }) => PlayerProviderMessage.SettledFullscreen({ open }),
      },
      view: (dialog) =>
        dialog
          .portal(
            h.dialog
              .class('native-player-dialog player-dialog')
              .style({ minWidth: '100vw', minHeight: '100dvh' }),
          )
          ?.children(
            dialog.title(h.h2.class('sr-only')).children('Now playing'),
            dialog
              .popup(h.div.class('player-panel native-player-panel'))
              .style({ '--player-drag-y': `${playerOffset}px` })
              .attr('data-dragging', playerDrag ? '' : undefined)
              .children(
                current
                  ? h.section
                      .attr('aria-label', 'Now playing')
                      .class(
                        'absolute inset-0 isolate flex flex-col overflow-hidden bg-background text-foreground',
                      )
                      .children(
                        h.div
                          .attr('aria-hidden', 'true')
                          .class('pointer-events-none absolute inset-0 -z-10 overflow-hidden')
                          .children(
                            Artwork(
                              h,
                              current.thumbnailUrl,
                              '',
                              96,
                              'size-full scale-150 object-cover opacity-60 blur-3xl saturate-150',
                            ),
                            h.div.class(
                              'absolute inset-0 bg-gradient-to-b from-background/50 via-background/75 to-background',
                            ),
                          ),
                        h.div
                          .onMount(TrackPlayerDrag({ allowControls: false }))
                          .class(
                            'player-drag-surface flex shrink-0 items-center justify-center px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-4',
                          )
                          .children(
                            h.button
                              .attr('type', 'button')
                              .attr('aria-label', 'Collapse player')
                              .onMount(TrackPlayerDrag({ allowControls: true }))
                              .on('click', PlayerProviderMessage.RequestedCloseFullscreen())
                              .class(`${ghostButton} player-drag-handle`)
                              .children(
                                h.span.class('player-drag-grip').attr('aria-hidden', 'true'),
                              ),
                          ),
                        h.div
                          .class(
                            'flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:justify-center sm:px-8 sm:pb-8',
                          )
                          .children(
                            h.div.class('flex min-h-0 w-full max-w-2xl flex-1 flex-col').children(
                              h.div
                                .onMount(TrackPlayerDrag({ allowControls: false }))
                                .class(
                                  'player-drag-surface mb-6 flex min-h-0 flex-1 items-center justify-center sm:mb-8',
                                )
                                .children(
                                  Artwork(
                                    h,
                                    current.thumbnailUrl,
                                    current.title,
                                    1280,
                                    'player-artwork max-h-full max-w-full rounded-none object-contain shadow-2xl',
                                  ).attr('data-paused', transport.isPlaying ? undefined : ''),
                                ),
                              h.div.class('relative mb-5 min-w-0 shrink-0 sm:mb-8').children(
                                h.div.class('flex items-center gap-3').children(
                                  h.div.class('min-w-0 flex-1').children(
                                    current.slug
                                      ? h.a
                                          .attr(
                                            'href',
                                            `/${current.type === 'track' ? 'tracks' : 'mixes'}/${encodeURIComponent(current.slug)}`,
                                          )
                                          .class(
                                            'block truncate text-xl font-semibold leading-tight text-foreground no-underline hover:underline sm:text-2xl',
                                          )
                                          .children(current.title)
                                      : h.span
                                          .class(
                                            'block truncate text-xl font-semibold leading-tight text-foreground sm:text-2xl',
                                          )
                                          .children(current.title),
                                    CreatorLinks(h, current),
                                  ),
                                  PlayerFavorite(h, {}),
                                ),
                              ),
                              Scrubber(h, {
                                currentTime: seekPreview?.seconds ?? transport.currentTime,
                                duration: transport.duration,
                                trackId: current.id,
                                preview: seekPreview,
                                isOpen: fullscreenOpen,
                              }),
                              h.div
                                .class('mb-5 shrink-0 sm:mb-8')
                                .children(PlaybackControls(h, { props: {} })),
                              h.div.class('flex shrink-0 items-center gap-4').children(
                                h.div
                                  .class('hidden min-w-0 flex-1 items-center gap-4 sm:flex')
                                  .children(
                                    h.button
                                      .attr('type', 'button')
                                      .attr('aria-label', volume.isMuted ? 'Unmute' : 'Mute')
                                      .class(
                                        `${ghostButton} h-9 px-3 text-muted-foreground hover:bg-muted hover:text-foreground`,
                                      )
                                      .on('click', PlayerProviderMessage.RequestedToggleMute())
                                      .children(
                                        lucide(
                                          h,
                                          muted ? iconPaths.volumeOff : iconPaths.volume,
                                          'h-5 w-5',
                                        ),
                                      ),
                                    h.input
                                      .attr('type', 'range')
                                      .attr('min', '0')
                                      .attr('max', '100')
                                      .value(String(volume.isMuted ? 0 : volume.volume))
                                      .attr('aria-label', 'Volume')
                                      .attr('title', `Volume: ${volume.volume}%`)
                                      .class(volumeRangeClass)
                                      .on('input', ({ value }) =>
                                        PlayerProviderMessage.RequestedVolume({
                                          volume: Number(value),
                                        }),
                                      ),
                                    lucide(h, iconPaths.volume, 'h-5 w-5 text-muted-foreground'),
                                  ),
                                h.button
                                  .attr('type', 'button')
                                  .attr('title', 'Toggle queue')
                                  .attr('aria-label', `Queue (${queue.tracks.length})`)
                                  .class(
                                    `${ghostButton} relative ml-auto size-11 shrink-0 rounded-[0.75rem] text-muted-foreground hover:bg-foreground/10 hover:text-foreground`,
                                  )
                                  .on('click', PlayerProviderMessage.RequestedToggleQueue())
                                  .children(
                                    lucide(h, iconPaths.list, 'h-6 w-6'),
                                    queue.tracks.length > 0 &&
                                      h.span
                                        .class(
                                          'absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary px-0.5 text-[10px] font-bold text-primary-foreground',
                                        )
                                        .children(String(queue.tracks.length)),
                                  ),
                              ),
                            ),
                          ),
                      )
                  : h.p.class('player-loading').attr('role', 'status').children('Loading player…'),
              ),
          ) ?? h.text(''),
    })
  },
})
