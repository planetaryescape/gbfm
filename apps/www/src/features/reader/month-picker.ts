import type { Html } from '@effect/ui/html'
import type { MicroPostTimelineMonth } from '@gbfm/api/navigation'

import type { ReaderPageMessage } from './contracts'
import { monthLabel, timelineMonths } from './timeline'

export const ReaderMonthPicker = (
  h: Html.H<ReaderPageMessage>,
  timeline: ReadonlyArray<MicroPostTimelineMonth>,
  current: string,
) => {
  if (timeline.length === 0) return h.text('')
  const months = timelineMonths(timeline)
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))]

  return h.details.children(
    h.summary.class('btn btn-quiet w-full cursor-pointer').children('Visit a month'),
    h.form
      .attrs({ method: 'get', action: '/tweet' })
      .class('mt-3 space-y-3')
      .children(
        h.label
          .attr('for', 'reader-month')
          .class('block text-xs text-muted-foreground')
          .children('Open a post from another time.'),
        h.select
          .attrs({ id: 'reader-month', name: 'visit', 'aria-label': 'Choose a month' })
          .class('h-11 w-full min-w-0 rounded-sm border border-border bg-background px-3 text-sm')
          .children(
            years.map((year) =>
              h.optgroup.attr('label', year).children(
                months
                  .filter((month) => month.month.startsWith(year))
                  .map((month) =>
                    h.option
                      .attrs({
                        value: month.newestSlug ?? '',
                        disabled: month.newestSlug === null ? '' : undefined,
                        selected: month.month === current ? '' : undefined,
                      })
                      .children(monthLabel(month.month)),
                  ),
              ),
            ),
          ),
        h.button.attr('type', 'submit').class('btn w-full').children('Visit'),
      ),
  )
}
