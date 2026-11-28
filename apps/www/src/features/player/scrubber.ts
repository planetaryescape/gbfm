import type { Html } from '@effect/ui/html'
import {
  formatScrubberDelta,
  formatScrubberTime,
  scrubberCurve,
  scrubberProgress,
} from '@gbfm/player'

import { type PlayerControlMessage, PlayerProviderMessage, type SeekPreview } from './domain'
import { TrackScrubberGesture } from './gestures'
import { progressRangeClass, time } from './presentation'

export const Scrubber = (
  h: Html.H<PlayerControlMessage>,
  options: {
    readonly currentTime: number
    readonly duration: number
    readonly trackId: string
    readonly preview: SeekPreview | null
    readonly isOpen: boolean
  },
) => {
  const { currentTime, duration, trackId, preview, isOpen } = options
  const enabled = Number.isFinite(duration) && duration > 0
  const position = scrubberProgress(currentTime, duration)
  const curve = scrubberCurve(position)

  const path = (d: string, className: string) =>
    h
      .el('path')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke-linecap', 'round')
      .attr('class', className)

  const hill = h.div
    .key(`${trackId}:${String(isOpen)}`)
    .class('hill-scrubber sm:hidden')
    .attr('data-disabled', String(!enabled))
    .style({ '--scrub-x': `${(preview?.pointerRatio ?? curve.x / 320) * 100}%` })

  const mounted = isOpen ? hill.onMount(TrackScrubberGesture({ trackId })) : hill

  return h.div.class('mb-4 shrink-0 sm:mb-8').children(
    mounted.children(
      preview &&
        h.div
          .class('hill-scrubber-preview')
          .attr('aria-hidden', 'true')
          .children(
            h.span
              .class('hill-scrubber-preview-time')
              .children(formatScrubberTime(preview.seconds, duration)),
            h.span
              .class('hill-scrubber-preview-delta')
              .children(formatScrubberDelta(preview.seconds, preview.referenceSeconds, duration)),
            h.span
              .class('hill-scrubber-preview-mode')
              .children(preview.fine ? 'Fine seeking' : 'Hold to fine-seek'),
          ),
      h
        .el('svg')
        .attr('class', 'hill-scrubber-art')
        .attr('viewBox', '0 0 320 64')
        .attr('preserveAspectRatio', 'none')
        .attr('aria-hidden', 'true')
        .children(
          path(curve.track, 'hill-scrubber-track'),
          path(curve.played, 'hill-scrubber-played'),
          h
            .el('circle')
            .attr('cx', String(curve.x))
            .attr('cy', '44')
            .attr('r', '6')
            .attr('class', 'hill-scrubber-thumb'),
        ),
      h.input
        .attr('type', 'range')
        .attr('min', '0')
        .attr('max', String(enabled ? duration : 0))
        .attr('step', '0.1')
        .value(String(position * (enabled ? duration : 0)))
        .disabled(!enabled)
        .on('input', ({ value }) => PlayerProviderMessage.RequestedSeek({ seconds: Number(value) }))
        .attr('aria-label', 'Playback position')
        .attr(
          'aria-valuetext',
          `${formatScrubberTime(currentTime, duration)} of ${formatScrubberTime(duration, duration)}`,
        )
        .class('hill-scrubber-input'),
    ),
    h.input
      .attr('type', 'range')
      .attr('min', '0')
      .attr('max', String(enabled ? duration : 0))
      .attr('step', '0.1')
      .value(String(currentTime))
      .disabled(!enabled)
      .on('input', ({ value }) => PlayerProviderMessage.RequestedSeek({ seconds: Number(value) }))
      .attr('aria-label', 'Playback position')
      .class(`${progressRangeClass} hidden sm:block`),
    h.div
      .class('mt-2 flex justify-between text-xs tabular-nums text-muted-foreground')
      .children(h.span(time(currentTime)), h.span(`-${time(duration - currentTime)}`)),
  )
}
