import type { Html } from '@effect/ui/html'

import type { DashboardDocument } from './document'
import { dateFilterHref } from './filters'
import { activeDatePreset, datePresets, daysAgoDate } from './formatting'
import { DataTable, Pagination } from './presentation'
import { Timestamp } from './timestamp'

export const EmailHistoryView = <M>(
  h: Html.H<M>,
  document: DashboardDocument,
  href: string,
  now: number | null,
) => {
  const url = new URL(href, 'http://localhost')
  const status = url.searchParams.get('status') ?? ''
  const dateFrom = url.searchParams.get('dateFrom') ?? ''
  const dateTo = url.searchParams.get('dateTo') ?? ''
  const preset = now === null ? 'custom' : activeDatePreset(dateFrom, dateTo, now)

  const filter = (value: string) => {
    const target = new URL(href, 'http://localhost')
    target.searchParams.delete('offset')

    if (value) target.searchParams.set('status', value)
    else target.searchParams.delete('status')

    return `${target.pathname}${target.search}`
  }

  const labels = new Map([
    ['SENT', 'Accepted'],
    ['FAILED', 'Failed'],
    ['SKIPPED', 'Skipped'],
    ['PENDING', 'Pending'],
  ])

  const logs = document.emailLogs

  return h.div.children(
    h.p('Accepted means the provider took the email, not that it reached an inbox.'),
    h.div
      .attr('role', 'group')
      .attr('aria-label', 'Delivery status')
      .children(
        ['', 'SENT', 'FAILED', 'SKIPPED', 'PENDING'].map((value) =>
          h.a
            .attr('href', filter(value))
            .attr('aria-current', status === value ? 'true' : undefined)
            .children(labels.get(value) ?? 'All'),
        ),
      ),
    h.nav.attr('aria-label', 'Email date range').children(
      datePresets
        .filter((option) => now !== null || option.days === null)
        .map((option) =>
          h.a
            .attr(
              'href',
              dateFilterHref(
                href,
                option.days === null || now === null ? null : daysAgoDate(option.days, now),
              ),
            )
            .attr('aria-current', option.days === preset ? 'true' : undefined)
            .children(option.label),
        ),
    ),
    preset === 'custom' && now !== null
      ? h.span
          .class('admin-toolbar-range')
          .children(
            h.span(`${dateFrom || 'Start'} to ${dateTo || 'today'}`),
            h.a.attr('href', dateFilterHref(href, null)).children('Clear dates'),
          )
      : undefined,
    h.form
      .attr('method', 'get')
      .attr('action', '/dashboard/email-logs')
      .attr('role', 'search')
      .children(
        h.input
          .attr('name', 'recipientEmail')
          .attr('type', 'search')
          .attr('aria-label', 'Recipient email')
          .attr('value', url.searchParams.get('recipientEmail') ?? ''),
        ['status', 'dateFrom', 'dateTo'].map((name) =>
          h.input
            .attr('type', 'hidden')
            .attr('name', name)
            .attr('value', url.searchParams.get(name) ?? ''),
        ),
        h.button.attr('type', 'submit').children('Search'),
        h.a.attr('href', '/dashboard/email-logs').children('Clear filters'),
      ),
    logs?.data.length === 0 ? h.p('No emails match these filters.') : undefined,
    DataTable(h, 'Delivery history', [
      'Status',
      'Subject',
      'Recipient',
      'Template',
      'Sent',
    ]).children(
      h.tbody.children(
        logs?.data.map((item) =>
          h.tr
            .key(item.id)
            .class('admin-row')
            .children(
              h.td(labels.get(item.status) ?? item.status),
              h.td.children(
                h.strong(item.subject),
                h.details.children(
                  h.summary('Delivery details'),
                  h.dl.children(
                    Object.entries(item).map(([name, value]) =>
                      h.div.children(h.dt(name), h.dd(value ?? 'n/a')),
                    ),
                  ),
                ),
              ),
              h.td(item.recipientEmail),
              h.td(item.templateName),
              h.td.children(
                Timestamp(h, { key: `email/${item.id}`, props: { iso: item.createdAt } }),
              ),
            ),
        ),
      ),
    ),
    logs
      ? Pagination(h, { ...document, pagination: logs.pagination }, href, 'Delivery history pages')
      : undefined,
  )
}
