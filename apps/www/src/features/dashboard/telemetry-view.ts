import type { Html } from '@effect/ui/html'

import type { DashboardDocument } from './document'
import { plural } from './formatting'
import { DataTable, telemetryP75 } from './presentation'
import { Timestamp } from './timestamp'

export const TelemetryView = <M>(h: Html.H<M>, data: DashboardDocument['telemetry']) => {
  if (!data) return h.p.attr('role', 'alert').children('Telemetry could not be loaded.')

  const labels = new Map([
    ['webVitals', 'Web vitals'],
    ['navigation', 'Navigation'],
    ['errors', 'Errors'],
    ['player', 'Player'],
  ])

  return h.section.attr('aria-label', 'Browser and player health').children(
    h.p.children(
      `Last ${plural(data.windowHours, 'hour')}, generated `,
      Timestamp(h, { key: 'telemetry/generated', props: { iso: data.generatedAt } }),
      `. ${data.retentionNotice}`,
    ),
    data.state === 'partial'
      ? h.p
          .attr('role', 'status')
          .children('Some telemetry queries are unavailable. Available sections remain current.')
      : undefined,
    data.state === 'empty'
      ? h.p(`No sampled browser telemetry was recorded in the last ${data.windowHours} hours.`)
      : undefined,
    Object.entries(data.sections).map(([name, section]) => {
      const label = labels.get(name) ?? name

      const content = () => {
        if (!section.available) return h.p('Unavailable')

        if (section.rows.length === 0) return h.p('No events in this window.')

        return DataTable(h, label, [
          'Event',
          'Route',
          'Release',
          'Browser',
          'Samples',
          'p75',
        ]).children(
          h.tbody.children(
            section.rows.map((row, index) =>
              h.tr
                .key(String(index))
                .class('admin-row')
                .children(
                  h.td(row.name),
                  h.td(row.route),
                  h.td(row.release),
                  h.td(row.browser),
                  h.td(String(row.samples)),
                  h.td(telemetryP75(name, row.name, row.p75)),
                ),
            ),
          ),
        )
      }

      return h.article.key(name).attr('aria-label', label).children(h.h2(label), content())
    }),
  )
}
