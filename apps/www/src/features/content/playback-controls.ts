import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { QueueTrack } from '@gbfm/player'
import { Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { PlayerProvider, PlayerMessage } from '../player/provider'

export const PlaybackControlsProps = Schema.Struct({
  track: QueueTrack,
  label: Schema.optional(Schema.String),
  compact: Schema.optional(Schema.Boolean),
  enqueue: Schema.optional(Schema.Boolean),
  resumeLabel: Schema.optional(Schema.String),
  episodeNumber: Schema.optional(Schema.Number),
  toggleCurrent: Schema.optional(Schema.Boolean),
})

export const PlaybackControlsMessage = UiSchema.TaggedEnum({
  ClickedPlay: {},
  ClickedEnqueue: {},
})

export const PlaybackControls = Html.component({
  name: 'PlaybackControls',
  props: PlaybackControlsProps,
  model: Schema.Struct({}),
  message: PlaybackControlsMessage,
  reads: { provider: { owner: PlayerProvider, optional: true } },
}).make({
  init: () => ({}),
  update: ($, message) => {
    if (!$.reads.provider?.snapshot.transport.isInitialized) return $.model

    return PlaybackControlsMessage.match(message, {
      ClickedPlay: () =>
        $.send(
          PlayerProvider,
          $.props.toggleCurrent !== false &&
            $.reads.provider?.snapshot.queue.current?.id === $.props.track.id
            ? PlayerMessage.RequestedTogglePlayPause()
            : PlayerMessage.RequestedPlayTrack({ track: $.props.track }),
        ),
      ClickedEnqueue: () =>
        $.send(PlayerProvider, PlayerMessage.RequestedEnqueue({ track: $.props.track })),
    })
  },
  view: (h) => {
    const { track, compact, enqueue, episodeNumber } = h.props
    const snapshot = h.reads.provider?.snapshot
    const current = h.props.toggleCurrent !== false && snapshot?.queue.current?.id === track.id
    const playing = current && snapshot.transport.isPlaying
    let label = h.props.label ?? 'Play'

    if (current && h.props.resumeLabel) label = h.props.resumeLabel

    if (playing) label = 'Pause'

    if (episodeNumber !== undefined)
      label = `${playing ? 'Pause' : 'Play'} episode ${episodeNumber}: ${track.title}`

    let className =
      'inline-flex h-14 w-14 items-center justify-center rounded-sm border-0 bg-highlight p-0 text-highlight-foreground shadow-lg disabled:opacity-50'

    if (compact)
      className =
        'inline-flex h-10 items-center gap-2 rounded-sm border-0 bg-highlight px-4 text-sm font-bold text-highlight-foreground disabled:opacity-50'

    if (episodeNumber !== undefined)
      className =
        'episode-play-control group/play relative -m-1 grid place-items-center rounded-sm border-0 bg-transparent p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

    return h.div.class('inline-flex items-center gap-2').children(
      h.button
        .attr('type', 'button')
        .attr('aria-label', label)
        .attr('title', label)
        .attr('aria-pressed', String(playing))
        .disabled(!snapshot?.transport.isInitialized)
        .class(className)
        .on('click', PlaybackControlsMessage.ClickedPlay())
        .children(
          episodeNumber === undefined &&
            lucide(h, playing ? iconPaths.pause : iconPaths.play, 'size-5 fill-current'),
          episodeNumber === undefined && compact && h.span.children(label),
          episodeNumber !== undefined &&
            h.span
              .attr('aria-hidden', 'true')
              .class(
                `episode-play-number col-start-1 row-start-1 w-[3ch] text-2xl font-black tabular-nums tracking-tighter transition-opacity duration-150 sm:text-4xl group-hover/play:opacity-0 group-focus-visible/play:opacity-0 ${playing ? 'opacity-0' : ''} ${current ? 'text-highlight' : 'episode-tune text-muted-foreground/40'}`,
              )
              .children(String(episodeNumber).padStart(3, '0')),
          episodeNumber !== undefined &&
            playing &&
            h.span
              .attr('aria-hidden', 'true')
              .class(
                'episode-play-equalizer col-start-1 row-start-1 transition-opacity duration-150 group-hover/play:opacity-0 group-focus-visible/play:opacity-0',
              )
              .children(
                h.span
                  .class('flex h-4 items-end gap-[3px]')
                  .children(
                    ['0ms', '160ms', '320ms'].map((delay) =>
                      h.span
                        .key(delay)
                        .class(
                          'h-full w-[3px] origin-bottom bg-highlight motion-safe:animate-[equalizer_900ms_ease-in-out_infinite]',
                        )
                        .style({ animationDelay: delay }),
                    ),
                  ),
              ),
          episodeNumber !== undefined &&
            h.span
              .attr('aria-hidden', 'true')
              .class(
                'episode-play-icon col-start-1 row-start-1 flex h-10 w-10 scale-75 items-center justify-center rounded-sm bg-highlight text-highlight-foreground opacity-0 shadow-lg transition duration-150 group-hover/play:scale-100 group-focus-visible/play:scale-100 group-hover/play:opacity-100 group-focus-visible/play:opacity-100',
              )
              .children(
                lucide(h, playing ? iconPaths.pause : iconPaths.play, 'h-4 w-4 fill-current'),
              ),
        ),
      enqueue &&
        h.button
          .attr('type', 'button')
          .attr('aria-label', 'Add to queue')
          .attr('title', 'Add to queue')
          .disabled(!snapshot?.transport.isInitialized)
          .class(
            'inline-flex h-11 w-11 items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted disabled:opacity-50',
          )
          .on('click', PlaybackControlsMessage.ClickedEnqueue())
          .children(lucide(h, iconPaths.listPlus, 'size-5')),
    )
  },
})

export const PlaylistControlsProps = Schema.Struct({ tracks: Schema.Array(QueueTrack) })

export const PlaylistControlsMessage = UiSchema.TaggedEnum({
  ClickedPlayAll: {},
  ClickedQueueAll: {},
})

export const PlaylistControls = Html.component({
  name: 'PlaylistControls',
  props: PlaylistControlsProps,
  model: Schema.Struct({}),
  message: PlaylistControlsMessage,
  reads: { provider: { owner: PlayerProvider, optional: true } },
}).make({
  init: () => ({}),
  update: ($, message) => {
    if (!$.props.tracks.length || !$.reads.provider?.snapshot.transport.isInitialized)
      return $.model

    return PlaylistControlsMessage.match(message, {
      ClickedPlayAll: () =>
        $.send(PlayerProvider, PlayerMessage.RequestedPlayAll({ tracks: $.props.tracks })),
      ClickedQueueAll: () =>
        $.send(PlayerProvider, PlayerMessage.RequestedEnqueueAll({ tracks: $.props.tracks })),
    })
  },
  view: (h) =>
    h.div.class('flex flex-wrap gap-2').children(
      h.button
        .attr('type', 'button')
        .disabled(!h.props.tracks.length || !h.reads.provider?.snapshot.transport.isInitialized)
        .on('click', PlaylistControlsMessage.ClickedPlayAll())
        .children('Play all'),
      h.button
        .attr('type', 'button')
        .disabled(!h.props.tracks.length || !h.reads.provider?.snapshot.transport.isInitialized)
        .on('click', PlaylistControlsMessage.ClickedQueueAll())
        .children('Queue all'),
    ),
})
