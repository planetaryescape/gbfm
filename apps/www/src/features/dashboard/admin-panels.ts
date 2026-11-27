import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Clock, Effect, Layer, Predicate, Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardDocument } from './document'
import { EmailHistoryView } from './email-history-view'
import { NewsletterView } from './newsletter-view'
import { Notice, Rows } from './presentation'
import { adminSections, endpointFor, sectionHref } from './sections'
import { DashboardService, DashboardServiceLive, ReadDashboard } from './service'
import { TelemetryView } from './telemetry-view'
import { Timestamp } from './timestamp'
import { UsersView } from './users-view'

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
      $.evolve({ busy: false, revision: $.model.revision + 1, notice: null }),
    FailedSaveFeatured: ($, { message }) => $.evolve({ busy: false, error: message }),
    CompletedReadPanelClock: ($, { now }) => $.evolve({ now }),
  },
  view: (h, model) => {
    const document = Predicate.isTagged(h.queries.document, 'Success')
      ? h.queries.document.value
      : h.props.initialDocument

    const url = new URL(h.props.url, 'http://localhost')
    const now = model.now

    const connectionQuery = h.queries.document
    const connectionsLoading = h.props.section === 'connections' && connectionQuery.waiting

    const connectionsUnavailable =
      h.props.section === 'connections' &&
      !connectionsLoading &&
      !Predicate.isTagged(connectionQuery, 'Failure') &&
      document.connections === undefined

    const hidden = (name: string, value: string) =>
      h.input.attr('type', 'hidden').attr('name', name).attr('value', value)

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
            h.p
              .attr('role', 'status')
              .children(
                document.fields.unavailableTitle
                  ? `Current selection: ${document.fields.unavailableTitle} (unpublished). The newest published mix is shown until you choose another.`
                  : `Current selection: ${document.rows.find((row) => row.id === document.fields.savedMixId)?.title ?? 'Automatic, newest published mix'}`,
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
          return UsersView(h, document, h.props.url)
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
                      h.button
                        .attr('type', 'submit')
                        .attr('aria-label', `Disconnect ${connection.name}`)
                        .children('Disconnect'),
                    ),
                ),
            ),
          )
        case 'newsletter':
          return NewsletterView(h, document, model.fields, (name, value) =>
            PanelMessage.UpdatedField({ name, value }),
          )
        case 'email-logs':
          return EmailHistoryView(h, document, h.props.url, now)
        case 'frontend-errors':
          return Predicate.isTagged(h.queries.document, 'Failure')
            ? undefined
            : TelemetryView(h, document.telemetry)
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

    const actionNotice = () => {
      if (notice === 'failed') return 'The action failed. Check your access and submitted values.'

      if (h.props.section === 'users') return 'Account action completed.'

      if (h.props.section === 'connections' && notice === 'disconnected') return 'App disconnected.'

      return 'Action completed.'
    }

    const refreshLabel = () => {
      if (h.props.section !== 'frontend-errors') return 'Refresh'

      return Predicate.isTagged(h.queries.document, 'Failure') ? 'Try again' : 'Refresh telemetry'
    }

    return h.section
      .class('admin-page')
      .children(
        connectionsUnavailable
          ? undefined
          : h.button
              .disabled(model.busy)
              .on('click', PanelMessage.ClickedRefresh())
              .children(refreshLabel()),
        Notice(h, model.error, true),
        Notice(h, model.notice),
        notice ? Notice(h, actionNotice(), notice === 'failed') : undefined,
        Predicate.isTagged(h.queries.document, 'Failure')
          ? h.p
              .attr('role', 'alert')
              .children(
                h.props.section === 'frontend-errors'
                  ? 'Request failed.'
                  : 'Could not refresh this section.',
              )
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
