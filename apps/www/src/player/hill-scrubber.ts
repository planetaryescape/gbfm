import {
  formatScrubberDelta,
  formatScrubberTime,
  scrubberCurve,
  scrubberProgress,
} from '@gbfm/player'
import type { HtmlBuilder } from 'foldkit/html'

import { Message, type SeekPreview } from './model'
import { ScrubberGesture } from './scrubber-gesture'

export const hillScrubber = (
  h: HtmlBuilder<typeof Message.Type>,
  {
    currentTime,
    duration,
    trackId,
    preview,
  }: {
    readonly currentTime: number
    readonly duration: number
    readonly trackId: string
    readonly preview: SeekPreview | null
  },
) => {
  const enabled = Number.isFinite(duration) && duration > 0
  const position = scrubberProgress(currentTime, duration)
  const curve = scrubberCurve(position)

  const path = (d: string, className: string) =>
    h.path([h.D(d), h.Class(className), h.Fill('none'), h.StrokeLinecap('round')])

  return h.div(
    [
      h.Class('hill-scrubber sm:hidden'),
      h.Key(trackId),
      h.DataAttribute('disabled', String(!enabled)),
      h.Style({ '--scrub-x': `${(preview?.pointerRatio ?? curve.x / 320) * 100}%` }),
      h.OnMount(ScrubberGesture({ trackId })),
    ],
    [
      preview
        ? h.div(
            [h.Class('hill-scrubber-preview'), h.AriaHidden(true)],
            [
              h.span(
                [h.Class('hill-scrubber-preview-time')],
                [formatScrubberTime(preview.seconds, duration)],
              ),
              h.span(
                [h.Class('hill-scrubber-preview-delta')],
                [formatScrubberDelta(preview.seconds, preview.referenceSeconds, duration)],
              ),
              h.span(
                [h.Class('hill-scrubber-preview-mode')],
                [preview.fine ? 'Fine seeking' : 'Hold to fine-seek'],
              ),
            ],
          )
        : h.empty,
      h.svg(
        [
          h.Class('hill-scrubber-art'),
          h.ViewBox('0 0 320 64'),
          h.PreserveAspectRatio('none'),
          h.AriaHidden(true),
        ],
        [
          path(curve.track, 'hill-scrubber-track'),
          path(curve.played, 'hill-scrubber-played'),
          h.circle([h.Cx(String(curve.x)), h.Cy('44'), h.R('6'), h.Class('hill-scrubber-thumb')]),
        ],
      ),
      h.input([
        h.Type('range'),
        h.Min('0'),
        h.Max(String(enabled ? duration : 0)),
        h.Step('0.1'),
        h.Value(String(position * (enabled ? duration : 0))),
        h.Disabled(!enabled),
        h.OnInput((value) => Message.SeekTo({ seconds: Number(value) })),
        h.AriaLabel('Playback position'),
        h.AriaValuetext(
          `${formatScrubberTime(currentTime, duration)} of ${formatScrubberTime(duration, duration)}`,
        ),
        h.Class('hill-scrubber-input'),
      ]),
    ],
  )
}
