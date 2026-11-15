import { scrubberCurve, scrubberProgress } from '@gbfm/player'
import type { HtmlBuilder } from 'foldkit/html'

import { Message } from './model'
import { ScrubberGesture } from './scrubber-gesture'

export const hillScrubber = (
  h: HtmlBuilder<typeof Message.Type>,
  currentTime: number,
  duration: number,
) => {
  const enabled = Number.isFinite(duration) && duration > 0
  const position = scrubberProgress(currentTime, duration)
  const curve = scrubberCurve(position)

  const path = (d: string, className: string) =>
    h.path([h.D(d), h.Class(className), h.Fill('none'), h.StrokeLinecap('round')])

  return h.div(
    [
      h.Class('hill-scrubber sm:hidden'),
      h.DataAttribute('disabled', String(!enabled)),
      h.OnMount(ScrubberGesture({})),
    ],
    [
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
        h.Class('hill-scrubber-input'),
      ]),
    ],
  )
}
