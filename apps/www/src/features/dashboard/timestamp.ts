import { Command, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Clock, Effect, Schema } from 'effect'

import { absoluteTime, relativeTimeLabel } from './formatting'

export const TimestampMessage = UiSchema.TaggedEnum({
  CompletedClock: { now: Schema.Number },
})

export const ReadTimestampClock = Command.make('ReadTimestampClock', { args: {} }, () =>
  Clock.currentTimeMillis.pipe(Effect.map((now) => TimestampMessage.CompletedClock({ now }))),
)

export const Timestamp = Html.component({
  name: 'DashboardTimestamp',
  props: Schema.Struct({ iso: Schema.String }),
  model: Schema.NullOr(Schema.Number),
  message: TimestampMessage,
  restore: false,
}).make({
  init: ($) => $.set(null).run(ReadTimestampClock.make()),
  update: ($, { now }) => $.set(now),
  view: (h, now) =>
    h.time
      .attr('datetime', h.props.iso)
      .attr('title', absoluteTime(h.props.iso))
      .children(now === null ? absoluteTime(h.props.iso) : relativeTimeLabel(h.props.iso, now)),
})
