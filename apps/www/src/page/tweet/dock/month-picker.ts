import type { MicroPostTimelineMonth } from '@gbfm/api/navigation'
import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from '../../../message'
import { monthLabel } from '../timeline'

export const monthPicker = (
  h: HtmlBuilder<Message>,
  timeline: ReadonlyArray<MicroPostTimelineMonth>,
  current: string,
) => {
  if (!timeline.length) return h.empty
  const months = [...timeline].sort((a, b) => b.month.localeCompare(a.month))
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))]

  return h.details(
    [],
    [
      h.summary([h.Class('btn btn-quiet w-full cursor-pointer')], ['Visit a month']),
      h.form(
        [h.Method('get'), h.Action('/tweet'), h.Class('mt-3 space-y-3')],
        [
          h.label(
            [h.For('reader-month'), h.Class('block text-xs text-muted-foreground')],
            ['Open a post from another time.'],
          ),
          h.select(
            [
              h.Id('reader-month'),
              h.Name('visit'),
              h.AriaLabel('Choose a month'),
              h.Class(
                'h-11 w-full min-w-0 rounded-sm border border-border bg-background px-3 text-sm',
              ),
            ],
            years.map((year) =>
              h.optgroup(
                [h.Attribute('label', year)],
                months
                  .filter((month) => month.month.startsWith(year))
                  .map((month) =>
                    h.option(
                      [h.Value(month.newestSlug), h.Selected(month.month === current)],
                      [monthLabel(month.month)],
                    ),
                  ),
              ),
            ),
          ),
          h.button([h.Type('submit'), h.Class('btn w-full')], ['Visit']),
        ],
      ),
    ],
  )
}
