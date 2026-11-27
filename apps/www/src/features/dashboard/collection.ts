import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Effect, Layer, Predicate, Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardDocument } from './document'
import { Notice, Pagination } from './presentation'
import { endpointFor } from './sections'
import { DashboardService, DashboardServiceLive, ReadDashboard } from './service'

const DeleteIntent = Schema.Struct({
  principalId: Schema.String,
  section: Schema.String,
  rowId: Schema.String,
  path: Schema.String,
  expectedRevision: Schema.Number,
  requestId: Schema.NullOr(Schema.String),
})

export const CollectionMessage = UiSchema.TaggedEnum({
  ClickedRefresh: {},
  ClickedRemove: { id: Schema.String },
  SucceededRemove: { intent: DeleteIntent },
  FailedRemove: {
    intent: DeleteIntent,
    message: Schema.String,
    status: Schema.NullOr(Schema.Number),
  },
})

export class RemoveSavedItem extends Command.Service<RemoveSavedItem>()(
  'dashboard/RemoveSavedItem',
  {
    args: { intent: DeleteIntent },
    success: CollectionMessage,
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return ({ intent }) =>
        Effect.gen(function* () {
          const requestId = intent.requestId ?? (yield* Effect.sync(() => crypto.randomUUID()))
          const pinned = { ...intent, requestId }

          return yield* service
            .request({
              path: intent.path,
              method: 'DELETE',
              body: JSON.stringify({ requestId, expectedRevision: intent.expectedRevision }),
            })
            .pipe(
              Effect.match({
                onSuccess: () => CollectionMessage.SucceededRemove({ intent: pinned }),
                onFailure: (error) =>
                  CollectionMessage.FailedRemove({
                    intent: pinned,
                    message: error.message,
                    status: error.status,
                  }),
              }),
            )
        })
    }),
  )
}

const CollectionDef = Html.component({
  name: 'DashboardCollection',
  props: Schema.Struct({
    section: Schema.String,
    principal: Principal,
    initialDocument: DashboardDocument,
    url: Schema.String,
  }),
  model: Schema.Struct({
    revision: Schema.Number,
    pending: Schema.NullOr(DeleteIntent),
    busy: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
  }),
  message: CollectionMessage,
  restore: false,
  queries: {
    document: {
      query: ReadDashboard,
      args: ({ model, props }) => {
        const path = endpointFor(props.section, new URL(props.url, 'http://localhost').searchParams)

        return path && model.revision > 0
          ? { path, principalId: props.principal.id, revision: model.revision }
          : undefined
      },
    },
  },
})

export const DashboardCollectionNoDeps = CollectionDef.make({
  init: () => ({ revision: 0, pending: null, busy: false, error: null }),
  update: {
    ClickedRefresh: ($) =>
      $.model.busy ? $.model : $.evolve({ revision: $.model.revision + 1, error: null }),
    ClickedRemove: ($, { id }) => {
      if ($.model.busy || !['favorites', 'reminders'].includes($.props.section)) return $.model

      if ($.model.pending) {
        if ($.model.pending.rowId !== id) return $.model

        return $.evolve({ busy: true, error: null }).run(
          RemoveSavedItem.make({ intent: $.model.pending }),
        )
      }

      if ($.model.error !== null) return $.model

      if (
        $.model.revision > 0 &&
        (!Predicate.isTagged($.queries.document, 'Success') || $.queries.document.waiting)
      )
        return $.model

      const document = Predicate.isTagged($.queries.document, 'Success')
        ? $.queries.document.value
        : $.props.initialDocument

      const row = document.rows.find((item) => item.id === id)

      if (!row?.actionId) return $.model

      const expectedRevision =
        $.props.section === 'reminders' ? row.commandRevision : row.membershipRevision

      if (expectedRevision === undefined)
        return $.evolve({ error: 'Reload to observe the saved item before removing it.' })

      const intent = {
        principalId: $.props.principal.id,
        section: $.props.section,
        rowId: id,
        expectedRevision,
        requestId: null,
        path:
          $.props.section === 'reminders'
            ? `/api/music-reminders/${encodeURIComponent(row.actionId)}`
            : `/api/favorites/${row.actionId.split('/').map(encodeURIComponent).join('/')}`,
      }

      return $.evolve({ busy: true, pending: intent, error: null }).run(
        RemoveSavedItem.make({ intent }),
      )
    },
    SucceededRemove: ($, { intent }) => {
      if (
        !$.model.pending ||
        !$.model.busy ||
        $.model.pending.rowId !== intent.rowId ||
        $.model.pending.path !== intent.path ||
        $.model.pending.expectedRevision !== intent.expectedRevision ||
        intent.principalId !== $.props.principal.id ||
        intent.section !== $.props.section ||
        ($.model.pending.requestId !== null && $.model.pending.requestId !== intent.requestId)
      )
        return $.model

      return $.evolve({ busy: false, pending: null, revision: $.model.revision + 1, error: null })
    },
    FailedRemove: ($, { intent, message, status }) => {
      if (
        !$.model.pending ||
        !$.model.busy ||
        $.model.pending.rowId !== intent.rowId ||
        $.model.pending.path !== intent.path ||
        $.model.pending.expectedRevision !== intent.expectedRevision ||
        intent.principalId !== $.props.principal.id ||
        intent.section !== $.props.section ||
        ($.model.pending.requestId !== null && $.model.pending.requestId !== intent.requestId)
      )
        return $.model
      let error = message

      if (status === 409) error = 'This saved item changed. Reload before choosing another removal.'

      if (status === 410)
        error = 'This removal request expired. Reload before choosing another removal.'

      return $.evolve({
        busy: false,
        error,
        pending: status !== null && status >= 400 && status < 500 && status !== 408 ? null : intent,
      })
    },
  },
  view: (h, model) => {
    const document = Predicate.isTagged(h.queries.document, 'Success')
      ? h.queries.document.value
      : h.props.initialDocument

    let createHref = '/new/editorial'

    if (h.props.section.endsWith('/mixes')) createHref = '/mix-upload'
    else if (h.props.section.endsWith('/tweets')) createHref = '/new/tweet'

    return h.section.class('dashboard-stack').children(
      h.button
        .disabled(model.busy)
        .on('click', CollectionMessage.ClickedRefresh())
        .children('Refresh'),
      Notice(h, model.error, true),
      Predicate.isTagged(h.queries.document, 'Failure')
        ? h.p.attr('role', 'alert').children('Could not refresh this section.')
        : undefined,
      h.props.section.includes('/')
        ? h.a.attr('href', createHref).children('Create content')
        : undefined,
      document.rows.length === 0
        ? h.p.children('Nothing here yet. ', h.a.attr('href', '/shows').children('Browse shows'))
        : h.ul.class('dashboard-collection').children(
            document.rows.map((row) =>
              h.li.key(row.id).children(
                row.thumbnailUrl ? h.img.attr('src', row.thumbnailUrl).attr('alt', '') : undefined,
                row.href ? h.a.attr('href', row.href).children(row.title) : h.strong(row.title),
                h.p(row.detail),
                row.actionId && ['favorites', 'reminders'].includes(h.props.section)
                  ? h.button
                      .disabled(
                        model.busy || (model.pending !== null && model.pending.rowId !== row.id),
                      )
                      .on('click', CollectionMessage.ClickedRemove({ id: row.id }))
                      .children(
                        model.pending?.rowId === row.id && !model.busy ? 'Retry removal' : 'Remove',
                      )
                  : undefined,
              ),
            ),
          ),
      Pagination(h, document, h.props.url),
      model.pending && !document.rows.some((row) => row.id === model.pending?.rowId)
        ? h.button
            .disabled(model.busy)
            .on('click', CollectionMessage.ClickedRemove({ id: model.pending.rowId }))
            .children('Retry pending removal')
        : undefined,
    )
  },
})

export const DashboardCollection = DashboardCollectionNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(
      Layer.provide(DashboardServiceLive),
    ),
  ),
)
