import type { Html } from '@effect/ui/html'

import type { DashboardDocument } from './document'
import { plural } from './formatting'
import { DataTable, Field } from './presentation'
import { Timestamp } from './timestamp'

export const NewsletterView = <M>(
  h: Html.H<M>,
  document: DashboardDocument,
  fields: Readonly<Record<string, string>>,
  changed: (name: string, value: string) => M,
) => {
  const search = (fields.subscriberSearch ?? '').trim().toLowerCase()
  const status = fields.subscriberStatus ?? 'all'
  const subscribers = document.subscribers ?? []
  const active = subscribers.filter((item) => !item.unsubscribedAt).length

  const filtered = subscribers.filter(
    (item) =>
      `${item.email} ${item.name ?? ''}`.toLowerCase().includes(search) &&
      (status === 'all' ||
        (status === 'subscribed' ? !item.unsubscribedAt : Boolean(item.unsubscribedAt))),
  )

  return h.div.children(
    h.p(
      `${subscribers.length} subscribers · ${active} subscribed · ${subscribers.length - active} unsubscribed`,
    ),
    Field(
      h,
      'subscriberSearch',
      'Search subscribers',
      fields.subscriberSearch ?? '',
      (value) => changed('subscriberSearch', value),
      'search',
    ),
    h.div
      .attr('role', 'group')
      .attr('aria-label', 'Subscription status')
      .children(
        [
          { value: 'all', label: 'All' },
          { value: 'subscribed', label: 'Subscribed' },
          { value: 'unsubscribed', label: 'Unsubscribed' },
        ].map((option) =>
          h.button
            .attr('type', 'button')
            .attr('aria-pressed', option.value === status ? 'true' : 'false')
            .on('click', changed('subscriberStatus', option.value))
            .children(option.label),
        ),
      ),
    filtered.length === 0
      ? h.p(
          subscribers.length
            ? 'No subscribers match these filters.'
            : 'No newsletter subscribers yet.',
        )
      : undefined,
    DataTable(h, 'Newsletter subscribers', [
      'Email',
      'Name',
      'Source',
      'Joined',
      'Status',
    ]).children(
      h.tbody.children(
        filtered.map((item) =>
          h.tr
            .key(item.id)
            .class('admin-row')
            .children(
              h.td(item.email),
              h.td(item.name ?? 'No name'),
              h.td(item.source ?? 'Unknown'),
              h.td.children(
                Timestamp(h, { key: `subscriber/${item.id}`, props: { iso: item.createdAt } }),
              ),
              h.td(item.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'),
            ),
        ),
      ),
    ),
    h.p(`${filtered.length} of ${plural(subscribers.length, 'subscriber')}`),
  )
}
