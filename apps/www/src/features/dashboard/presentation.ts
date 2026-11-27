import type { Html } from '@effect/ui/html'

import type { DashboardDocument, Row } from './document'
import { pageRange } from './formatting'

export const telemetryP75 = (section: string, name: string, value: number | null) => {
  if (value === null) return 'n/a'

  if (section === 'webVitals' && name.toLowerCase() === 'cls')
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 })

  return `${Math.round(value).toLocaleString('en-US')} ms`
}

export const Field = <M>(
  h: Html.H<M>,
  name: string,
  label: string,
  value: string,
  changed: (value: string) => M,
  type = 'text',
  disabled = false,
) =>
  h.label.children(
    label,
    h.input
      .attr('type', type)
      .attr('name', name)
      .disabled(disabled)
      .value(value)
      .on('input', (event) => changed(event.value)),
  )

export const Notice = <M>(h: Html.H<M>, message: string | null, error = false) =>
  message ? h.p.attr('role', error ? 'alert' : 'status').children(message) : undefined

export const Rows = <M>(h: Html.H<M>, rows: ReadonlyArray<typeof Row.Type>) =>
  rows.length
    ? h.ul
        .class('dashboard-collection')
        .children(
          rows.map((row) =>
            h.li
              .key(row.id)
              .children(
                row.thumbnailUrl ? h.img.attr('src', row.thumbnailUrl).attr('alt', '') : undefined,
                row.href ? h.a.attr('href', row.href).children(row.title) : h.strong(row.title),
                h.p(row.detail),
                row.status ? h.span.class('admin-badge').children(row.status) : undefined,
              ),
          ),
        )
    : h.p.class('dashboard-state').children('Nothing here yet.')

export const Pagination = <M>(h: Html.H<M>, document: DashboardDocument, url: string) => {
  const pagination = document.pagination

  if (!pagination) return undefined

  const href = (offset: number) => {
    const target = new URL(url, 'http://localhost')
    target.searchParams.set('offset', String(offset))

    return `${target.pathname}${target.search}`
  }

  return h.nav
    .attr('aria-label', 'Pagination')
    .children(
      h.span(
        pageRange(
          pagination.offset,
          Math.max(0, Math.min(pagination.limit, pagination.total - pagination.offset)),
          pagination.total,
        ),
      ),
      pagination.offset > 0
        ? h.a
            .attr('href', href(Math.max(0, pagination.offset - pagination.limit)))
            .children('Previous')
        : undefined,
      pagination.hasMore
        ? h.a.attr('href', href(pagination.offset + pagination.limit)).children('Next')
        : undefined,
    )
}
