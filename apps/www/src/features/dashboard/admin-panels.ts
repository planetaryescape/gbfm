import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { ROLES } from '@gbfm/core/roles'
import { Clock, Effect, Layer, Predicate, Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardDocument } from './document'
import { dateFilterHref } from './filters'
import { activeDatePreset, datePresets, daysAgoDate, plural } from './formatting'
import { Field, Notice, Pagination, Rows, telemetryP75 } from './presentation'
import { adminSections, endpointFor, pageOffset, sectionHref } from './sections'
import { DashboardService, DashboardServiceLive, ReadDashboard } from './service'
import { Timestamp } from './timestamp'

type AdminUser = NonNullable<DashboardDocument['users']>['users'][number]

const accountStatus = (user: AdminUser) => {
  if (user.banned) return `Banned: ${user.banReason ?? ''}`

  if (user.emailVerified === false) return 'Unverified'

  return 'Active'
}

export const PanelMessage = UiSchema.TaggedEnum({
  ClickedRefresh: {},
  UpdatedField: { name: Schema.String, value: Schema.String },
  ClickedSaveFeatured: {},
  SucceededSaveFeatured: {},
  FailedSaveFeatured: { message: Schema.String },
  CompletedReadPanelClock: { now: Schema.Number },
  ChangedDocument: {},
})

export class ReadPanelClock extends Command.Service<ReadPanelClock>()('dashboard/ReadPanelClock', {
  args: {},
  success: PanelMessage,
}) {
  static readonly layer = this.toLayer(() =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => PanelMessage.CompletedReadPanelClock({ now })),
    ),
  )
}

export class SaveFeatured extends Command.Service<SaveFeatured>()('dashboard/SaveFeatured', {
  args: { mixId: Schema.NullOr(Schema.String) },
  success: PanelMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return ({ mixId }) =>
        service
          .request({
            path: '/api/admin/featured-mix',
            method: 'PUT',
            body: JSON.stringify({ mixId }),
          })
          .pipe(
            Effect.match({
              onSuccess: () => PanelMessage.SucceededSaveFeatured(),
              onFailure: (error) => PanelMessage.FailedSaveFeatured({ message: error.message }),
            }),
          )
    }),
  )
}

const PanelDef = Html.component({
  name: 'DashboardAdminPanel',
  props: Schema.Struct({
    section: Schema.String,
    principal: Principal,
    url: Schema.String,
    initialDocument: DashboardDocument,
  }),
  model: Schema.Struct({
    revision: Schema.Number,
    fields: Schema.Record(Schema.String, Schema.String),
    busy: Schema.Boolean,
    now: Schema.NullOr(Schema.Number),
    error: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
  }),
  message: PanelMessage,
  restore: false,
  queries: {
    document: {
      query: ReadDashboard,
      args: ({ model, props }) => {
        const path = endpointFor(props.section, new URL(props.url, 'http://localhost').searchParams)

        return model.revision > 0 && path
          ? { path, principalId: props.principal.id, revision: model.revision }
          : undefined
      },
      onChange: () => PanelMessage.ChangedDocument(),
    },
  },
})

export const DashboardAdminPanelNoDeps = PanelDef.make({
  init: ($) =>
    $.set({
      revision: 0,
      fields: $.props.initialDocument.fields,
      busy: false,
      now: null,
      error: null,
      notice: null,
    }).run(...($.props.section === 'email-logs' ? [ReadPanelClock.make({})] : [])),
  update: {
    ClickedRefresh: ($) =>
      $.model.busy ? $.model : $.evolve({ revision: $.model.revision + 1, error: null }),
    UpdatedField: ($, { name, value }) =>
      $.model.busy ? $.model : $.evolve({ fields: { ...$.model.fields, [name]: value } }),
    ChangedDocument: ($) =>
      $.props.section !== 'featured-mix' ||
      $.model.busy ||
      $.queries.document.waiting ||
      !Predicate.isTagged($.queries.document, 'Success')
        ? $.model
        : $.evolve({ fields: $.queries.document.value.fields }),
    ClickedSaveFeatured: ($) =>
      $.model.busy || $.props.principal.role !== 'admin'
        ? $.model
        : $.evolve({ busy: true, error: null, notice: null }).run(
            SaveFeatured.make({ mixId: $.model.fields.mixId || null }),
          ),
    SucceededSaveFeatured: ($) =>
      $.evolve({ busy: false, revision: $.model.revision + 1, notice: 'Featured mix saved.' }),
    FailedSaveFeatured: ($, { message }) => $.evolve({ busy: false, error: message }),
    CompletedReadPanelClock: ($, { now }) => $.evolve({ now }),
  },
  view: (h, model) => {
    const document = Predicate.isTagged(h.queries.document, 'Success')
      ? h.queries.document.value
      : h.props.initialDocument

    const url = new URL(h.props.url, 'http://localhost')
    const now = model.now

    const preset =
      now === null
        ? 'custom'
        : activeDatePreset(
            url.searchParams.get('dateFrom') ?? '',
            url.searchParams.get('dateTo') ?? '',
            now,
          )

    const connectionQuery = h.queries.document
    const connectionsLoading = h.props.section === 'connections' && connectionQuery.waiting

    const connectionsUnavailable =
      h.props.section === 'connections' &&
      !connectionsLoading &&
      !Predicate.isTagged(connectionQuery, 'Failure') &&
      document.connections === undefined

    const hidden = (name: string, value: string) =>
      h.input.attr('type', 'hidden').attr('name', name).attr('value', value)

    const input = (name: string, label: string, type = 'text') =>
      h.label.children(label, h.input.attr('name', name).attr('type', type))

    const roleSelect = (role: string) =>
      h.select.attr('name', 'role').children(
        ROLES.map((value) =>
          h.option
            .attr('value', value)
            .attr('selected', value === role ? '' : undefined)
            .children(value),
        ),
      )

    const action = (name: string) =>
      h.form.attr('method', 'post').attr(
        'action',
        `/actions/admin/${name}?${new URLSearchParams({
          search: url.searchParams.get('search') ?? '',
          offset: String(pageOffset(url.searchParams)),
        })}`,
      )

    const body = () => {
      switch (h.props.section) {
        case 'admin':
          return h.div.children(
            Rows(h, document.rows),
            h.nav.children(
              adminSections.map(([section, label]) =>
                h.a.attr('href', sectionHref(section)).children(label),
              ),
            ),
          )
        case 'featured-mix':
          return h.div.class('dashboard-form').children(
            h.p(
              document.fields.unavailableTitle
                ? `Current selection: ${document.fields.unavailableTitle} (unpublished). The newest published mix is shown until you choose another.`
                : 'Choose a published mix, or automatic selection.',
            ),
            h.label.children(
              'Featured mix',
              h.select
                .disabled(model.busy)
                .value(model.fields.mixId ?? '')
                .on('change', ({ value }) => PanelMessage.UpdatedField({ name: 'mixId', value }))
                .children(
                  h.option.attr('value', '').children('Automatic (newest mix)'),
                  document.fields.unavailableTitle && document.fields.savedMixId
                    ? h.option
                        .attr('value', document.fields.savedMixId)
                        .disabled(true)
                        .children(`${document.fields.unavailableTitle} (unpublished)`)
                    : undefined,
                  document.rows.map((row) => h.option.attr('value', row.id).children(row.title)),
                ),
            ),
            h.button
              .disabled(model.busy || model.fields.mixId === document.fields.savedMixId)
              .on('click', PanelMessage.ClickedSaveFeatured())
              .children('Save featured mix'),
          )
        case 'users':
          return h.div.children(
            h.details.children(
              h.summary('New user'),
              action('create-user')
                .class('dashboard-form')
                .children(
                  input('name', 'Display name'),
                  input('username', 'Username'),
                  input('email', 'Email', 'email'),
                  input('password', 'Password (optional)', 'password'),
                  h.label.children('Role', roleSelect('user')),
                  h.p(
                    'Provide an email or username. A blank password is generated securely. Use Invite to send access instructions.',
                  ),
                  h.button.attr('type', 'submit').children('Create account'),
                ),
            ),
            h.form
              .attr('method', 'get')
              .attr('action', '/dashboard/users')
              .attr('role', 'search')
              .children(
                h.input
                  .attr('name', 'search')
                  .attr('type', 'search')
                  .attr('aria-label', 'Search by email')
                  .attr('value', url.searchParams.get('search') ?? ''),
                h.button.attr('type', 'submit').children('Search users'),
              ),
            document.users
              ? h.ul.children(
                  document.users.users.map((user) =>
                    h.li
                      .key(user.id)
                      .class('dashboard-panel')
                      .children(
                        h.strong(user.name),
                        h.p(user.email),
                        user.username
                          ? h.a
                              .attr('href', `/profile/${encodeURIComponent(user.username)}`)
                              .children(`@${user.username}`)
                          : undefined,
                        h.p(accountStatus(user)),
                        action('set-role').children(
                          hidden('userId', user.id),
                          roleSelect(user.role ?? 'user'),
                          h.button.attr('type', 'submit').children('Save role'),
                        ),
                        action('invite').children(
                          hidden('userId', user.id),
                          h.button.attr('type', 'submit').children('Invite'),
                        ),
                        user.banned
                          ? action('unban-user').children(
                              hidden('userId', user.id),
                              h.button.attr('type', 'submit').children('Unban'),
                            )
                          : h.details.children(
                              h.summary('Ban'),
                              action('ban-user').children(
                                hidden('userId', user.id),
                                input('banReason', 'Ban reason (optional)'),
                                h.button.attr('type', 'submit').children('Confirm ban'),
                              ),
                            ),
                        h.details.children(
                          h.summary('Delete'),
                          action('remove-user').children(
                            hidden('userId', user.id),
                            h.p(`Permanently delete ${user.name}? This cannot be undone.`),
                            h.button.attr('type', 'submit').children('Confirm delete'),
                          ),
                        ),
                      ),
                  ),
                )
              : h.p.attr('role', 'alert').children('Could not load user accounts.'),
            document.users
              ? Pagination(
                  h,
                  {
                    ...document,
                    pagination: {
                      total: document.users.total,
                      limit: document.users.limit,
                      offset: pageOffset(url.searchParams),
                      hasMore:
                        pageOffset(url.searchParams) + document.users.users.length <
                        document.users.total,
                    },
                  },
                  h.props.url,
                )
              : undefined,
          )
        case 'connections':
          return h.div.children(
            h.p(
              'Apps with approved access to your posts and drafts. Disconnecting removes access and requires new authorization to reconnect.',
            ),
            h.p(
              'To add permissions, request them in your app and check the new consent screen. Token refresh does not expand granted access.',
            ),
            document.connections?.length === 0 ? h.p('No connected apps.') : undefined,
            connectionsLoading
              ? h.p.attr('role', 'status').children('Loading connections…')
              : undefined,
            connectionsUnavailable
              ? h.p
                  .attr('role', 'status')
                  .children('App connections are not available for this account or environment.')
              : undefined,
            document.connections?.map((connection) =>
              h.article
                .key(connection.clientId)
                .class('dashboard-panel')
                .children(
                  h.h2(connection.name),
                  h.p(connection.scopes.join(', ')),
                  h.p.children(
                    'Connected ',
                    Timestamp(h, {
                      key: `connection/${connection.clientId}`,
                      props: { iso: connection.createdAt },
                    }),
                  ),
                  h.form
                    .attr('method', 'post')
                    .attr('action', '/actions/connections/revoke')
                    .children(
                      hidden('clientId', connection.clientId),
                      h.button.attr('type', 'submit').children('Disconnect'),
                    ),
                ),
            ),
          )
        case 'newsletter': {
          const search = (model.fields.subscriberSearch ?? '').trim().toLowerCase()
          const status = model.fields.subscriberStatus ?? 'all'
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
              'Search email or name',
              model.fields.subscriberSearch ?? '',
              (value) => PanelMessage.UpdatedField({ name: 'subscriberSearch', value }),
              'search',
            ),
            h.select
              .attr('aria-label', 'Subscription status')
              .value(status)
              .on('change', ({ value }) =>
                PanelMessage.UpdatedField({ name: 'subscriberStatus', value }),
              )
              .children(
                ['all', 'subscribed', 'unsubscribed'].map((value) =>
                  h.option.attr('value', value).children(value),
                ),
              ),
            filtered.length === 0
              ? h.p(
                  subscribers.length
                    ? 'No subscribers match these filters.'
                    : 'No newsletter subscribers yet.',
                )
              : undefined,
            h.ul.children(
              filtered.map((item) =>
                h.li.key(item.id).children(
                  h.strong(item.email),
                  h.p(item.name ?? 'No name'),
                  h.p(item.source ?? 'Unknown source'),
                  h.p.children(
                    Timestamp(h, {
                      key: `subscriber/${item.id}`,
                      props: { iso: item.createdAt },
                    }),
                  ),
                  h.span(item.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'),
                ),
              ),
            ),
            h.p(`${filtered.length} of ${plural(subscribers.length, 'subscriber')}`),
          )
        }

        case 'email-logs':
          return h.div.children(
            h.p('Accepted means the provider took the email, not that it reached an inbox.'),
            h.nav.attr('aria-label', 'Email date range').children(
              datePresets
                .filter((option) => now !== null || option.days === null)
                .map((option) =>
                  h.a
                    .attr(
                      'href',
                      dateFilterHref(
                        h.props.url,
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
                    `${url.searchParams.get('dateFrom') || 'Start'} to ${url.searchParams.get('dateTo') || 'today'}`,
                    h.a.attr('href', dateFilterHref(h.props.url, null)).children('Clear dates'),
                  )
              : undefined,
            h.form
              .attr('method', 'get')
              .attr('action', '/dashboard/email-logs')
              .children(
                ['status', 'recipientEmail', 'dateFrom', 'dateTo'].map((name) =>
                  h.label.children(
                    name,
                    h.input
                      .attr('name', name)
                      .attr('type', name.startsWith('date') ? 'date' : 'text')
                      .attr('value', url.searchParams.get(name) ?? ''),
                  ),
                ),
                h.button.attr('type', 'submit').children('Filter'),
                h.a.attr('href', '/dashboard/email-logs').children('Clear filters'),
              ),
            h.ul.children(
              document.emailLogs?.data.map((item) =>
                h.li
                  .key(item.id)
                  .children(
                    h.strong(item.subject),
                    h.p(item.recipientEmail),
                    h.p(item.status === 'SENT' ? 'Accepted' : item.status),
                    h.p.children(
                      Timestamp(h, { key: `email/${item.id}`, props: { iso: item.createdAt } }),
                    ),
                    h.details.children(
                      h.summary('Delivery details'),
                      h.dl.children(
                        Object.entries(item).map(([name, value]) =>
                          h.div.children(h.dt(name), h.dd(value ?? 'n/a')),
                        ),
                      ),
                    ),
                  ),
              ),
            ),
            document.emailLogs
              ? Pagination(
                  h,
                  { ...document, pagination: document.emailLogs.pagination },
                  h.props.url,
                )
              : undefined,
          )
        case 'frontend-errors': {
          const data = document.telemetry

          if (!data) return h.p.attr('role', 'alert').children('Telemetry could not be loaded.')

          return h.div.children(
            h.p.children(
              `Last ${plural(data.windowHours, 'hour')}, generated `,
              Timestamp(h, { key: 'telemetry/generated', props: { iso: data.generatedAt } }),
              `. ${data.retentionNotice}`,
            ),
            data.state === 'partial'
              ? h.p
                  .attr('role', 'status')
                  .children(
                    'Some telemetry queries are unavailable. Available sections remain current.',
                  )
              : undefined,
            data.state === 'empty'
              ? h.p(
                  `No sampled browser telemetry was recorded in the last ${data.windowHours} hours.`,
                )
              : undefined,
            Object.entries(data.sections).map(([name, section]) =>
              h.article
                .key(name)
                .children(
                  h.h2(name),
                  !section.available
                    ? h.p('Unavailable')
                    : h.table.children(
                        h.thead.children(
                          h.tr.children(
                            ['Event', 'Route', 'Release', 'Browser', 'Samples', 'p75'].map(
                              (label) => h.th(label),
                            ),
                          ),
                        ),
                        h.tbody.children(
                          section.rows.map((row, index) =>
                            h.tr
                              .key(String(index))
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
                      ),
                ),
            ),
          )
        }

        case 'search':
          return h.div.children(
            h.form
              .attr('method', 'get')
              .attr('action', '/dashboard/search')
              .attr('role', 'search')
              .children(
                h.input
                  .attr('name', 'q')
                  .attr('type', 'search')
                  .attr('aria-label', 'Search content')
                  .attr('value', url.searchParams.get('q') ?? ''),
                h.button.attr('type', 'submit').children('Search'),
              ),
            Rows(h, document.rows),
          )
        default:
          return Rows(h, document.rows)
      }
    }

    const notice = url.searchParams.get('notice')

    return h.section
      .class('admin-page')
      .children(
        connectionsUnavailable
          ? undefined
          : h.button
              .disabled(model.busy)
              .on('click', PanelMessage.ClickedRefresh())
              .children('Refresh'),
        Notice(h, model.error, true),
        Notice(h, model.notice),
        notice
          ? Notice(
              h,
              notice === 'failed'
                ? 'The action failed. Check your access and submitted values.'
                : 'Action completed.',
              notice === 'failed',
            )
          : undefined,
        Predicate.isTagged(h.queries.document, 'Failure')
          ? h.p.attr('role', 'alert').children('Could not refresh this section.')
          : undefined,
        body(),
      )
  },
})

export const DashboardAdminPanel = DashboardAdminPanelNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ReadDashboard.layer, SaveFeatured.layer, ReadPanelClock.layer).pipe(
      Layer.provide(DashboardServiceLive),
    ),
  ),
)
