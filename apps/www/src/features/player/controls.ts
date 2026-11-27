import { Html } from '@effect/ui/html'
import { QueueTrack } from '@gbfm/player'
import { Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { PlayerControlMessage, PlayerProviderMessage } from './domain'
import { PlayerProvider } from './provider'

export const PlaybackControlsProps = Schema.Struct({
  track: Schema.optional(QueueTrack),
  tracks: Schema.optional(Schema.Array(QueueTrack)),
  compact: Schema.optional(Schema.Boolean),
})

export const PlaybackControls = Html.component({
  name: 'PlaybackControls',
  props: PlaybackControlsProps,
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) => {
    const snapshot = h.reads.provider.snapshot
    const current = snapshot.queue.current
    const track = h.props.track
    const tracks = h.props.tracks
    const matching = track ? current?.id === track.id : current !== null
    const playing = matching && snapshot.transport.isPlaying
    const play = PlayerProviderMessage.RequestedTogglePlayPause()

    const button = h.button
      .attr('type', 'button')
      .class('btn btn-primary')
      .attr('aria-label', playing ? 'Pause' : 'Play')

    if (track && !matching) {
      return h.div.class('flex items-center gap-2').children(
        button
          .on('click', PlayerProviderMessage.RequestedPlayTrack({ track }))
          .children(lucide(h, iconPaths.play, 'size-5 fill-current'), 'Play'),
        h.button
          .attr('type', 'button')
          .class('btn')
          .attr('aria-label', 'Add to queue')
          .on('click', PlayerProviderMessage.RequestedEnqueue({ track }))
          .children(lucide(h, iconPaths.listPlus, 'size-5'), 'Add to queue'),
      )
    }

    if (tracks)
      return h.div.class('flex items-center gap-2').children(
        button
          .disabled(tracks.length === 0)
          .on('click', PlayerProviderMessage.RequestedPlayAll({ tracks }))
          .children(lucide(h, iconPaths.play, 'size-5 fill-current'), 'Play all'),
        h.button
          .attr('type', 'button')
          .class('btn')
          .disabled(tracks.length === 0)
          .on('click', PlayerProviderMessage.RequestedEnqueueAll({ tracks }))
          .children(lucide(h, iconPaths.listPlus, 'size-5'), 'Add all to queue'),
      )

    return h.div.class('flex items-center justify-center gap-8').children(
      !h.props.compact &&
        h.button
          .attr('type', 'button')
          .class('btn btn-quiet btn-icon')
          .attr('aria-label', 'Previous track')
          .disabled(!current)
          .on('click', PlayerProviderMessage.RequestedPrevious())
          .children(lucide(h, iconPaths.skipBack, 'size-6 fill-current')),
      button
        .class('player-primary-control')
        .disabled(!current)
        .on('click', play)
        .children(
          lucide(h, playing ? iconPaths.pause : iconPaths.play, 'size-[30px] fill-current'),
        ),
      !h.props.compact &&
        h.button
          .attr('type', 'button')
          .class('btn btn-quiet btn-icon')
          .attr('aria-label', 'Next track')
          .disabled(!current)
          .on('click', PlayerProviderMessage.RequestedNext())
          .children(lucide(h, iconPaths.skipForward, 'size-6 fill-current')),
      track &&
        h.button
          .attr('type', 'button')
          .class('btn')
          .attr('aria-label', 'Add to queue')
          .on('click', PlayerProviderMessage.RequestedEnqueue({ track }))
          .children(lucide(h, iconPaths.listPlus, 'size-5')),
    )
  },
})
